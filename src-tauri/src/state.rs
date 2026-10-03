//! CODE（cislunar-code）的 Tauri 状态：sidecar 句柄的懒初始化与共享。
//!
//! 拉起命令（uv vs 打包产物）在 setup 时注入，本模块不猜解释器策略。

use std::sync::OnceLock;

use serde_json::Value;
use tokio::sync::Mutex;
use crate::sidecar::{JobResult, SidecarHandle};

/// 进度事件发射器（setup 时注入 AppHandle 包装；测试注入 fake）。
pub type ProgressEmitter = std::sync::Arc<dyn Fn(&Value) + Send + Sync>;
static EMITTER: OnceLock<ProgressEmitter> = OnceLock::new();

pub fn set_progress_emitter(e: ProgressEmitter) {
    let _ = EMITTER.set(e);
}

/// 全局唯一的 sidecar 拉起配置（setup 时写入一次）。
static SPAWN_CONFIG: OnceLock<(Vec<String>, Option<String>)> = OnceLock::new();

pub struct SidecarState {
    handle: Mutex<Option<SidecarHandle>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self { handle: Mutex::new(None) }
    }

    /// 注册拉起配置（app setup 阶段调用一次；重复调用保持首次值）。
    pub fn configure(command: Vec<String>, cwd: Option<String>) {
        let _ = SPAWN_CONFIG.set((command, cwd));
    }

    /// 取当前 sidecar，没有则拉起。死亡判定与自愈不在此处：由
    /// [`request_with_retry`] 承担（覆盖死句柄的 anyhow 错误与请求中
    /// 崩溃的 SIDECAR_EXIT 两种时序，均先 reset 再重拉）；此处仅复用
    /// 既有句柄。
    /// Fetch the current sidecar, spawning one when absent. Death detection
    /// and self-healing are not done here — [`request_with_retry`] owns them
    /// (covering both the dead-handle anyhow error and the mid-request
    /// SIDECAR_EXIT, each resetting before respawning); this only reuses the
    /// existing handle.
    pub async fn get_or_spawn(&self) -> anyhow::Result<SidecarHandle> {
        let mut guard = self.handle.lock().await;
        if let Some(h) = guard.as_ref() {
            return Ok(h.clone());
        }
        let (cmd, cwd) = SPAWN_CONFIG
            .get()
            .expect("setup 未注册 sidecar 拉起配置");
        let cmd_refs: Vec<&str> = cmd.iter().map(String::as_str).collect();
        let cwd_ref = cwd.as_deref();
        let h = SidecarHandle::spawn(&cmd_refs, cwd_ref.map(std::path::Path::new))?;
        // 进度行 → 前端事件（emitter 由 setup 注入；无注入则丢弃）
        if let Some(emit) = EMITTER.get() {
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
            h.subscribe_progress(tx);
            let emit = emit.clone();
            tokio::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    emit(&ev);
                }
            });
        }
        *guard = Some(h.clone());
        Ok(h)
    }

    /// 丢弃当前句柄（崩溃后重建用）。
    pub async fn reset(&self) {
        *self.handle.lock().await = None;
    }
}

/// 请求 + 崩溃自愈重试一次。覆盖三种死亡时序：请求中崩溃（SIDECAR_EXIT
/// 错误码）、空闲期崩溃/坏帧后（读循环退出 → anyhow 错误 + 死句柄残留）。
/// 两条路径都先 reset 再重拉 sidecar；再失败则上抛（连续两次崩溃不是
/// 瞬态问题）。
pub async fn request_with_retry(
    state: &SidecarState,
    tool: &str,
    arguments: serde_json::Value,
    binary_dtype: Option<&'static str>,
) -> anyhow::Result<JobResult> {
    let result = match try_request(state, tool, &arguments, binary_dtype).await {
        Ok(r) => r,
        Err(_) => {
            // anyhow 错误 = 读循环已退出（死句柄），重建后重试
            state.reset().await;
            return try_request(state, tool, &arguments, binary_dtype).await;
        }
    };
    if result.error.as_ref().and_then(|e| e.get("code"))
        == Some(&serde_json::json!("SIDECAR_EXIT"))
    {
        state.reset().await;
        return try_request(state, tool, &arguments, binary_dtype).await;
    }
    Ok(result)
}

async fn try_request(
    state: &SidecarState,
    tool: &str,
    arguments: &serde_json::Value,
    binary_dtype: Option<&'static str>,
) -> anyhow::Result<JobResult> {
    let handle = state.get_or_spawn().await?;
    handle.request(tool, arguments, binary_dtype).await
}