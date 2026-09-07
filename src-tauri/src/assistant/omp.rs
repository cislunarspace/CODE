//! omp 运行时适配：可执行文件解析、审批配置覆盖文件与 ACP 进程生命周期。
//!
//! 拓扑（一次 ACP 进程服务多个 ACP session，不为每个会话起独立 omp）：
//! - app 进程懒启动一个 `omp acp --config <overlay>` 子进程；
//! - omp 在 session/new 时按 ACP mcpServers 拉起本应用二进制的
//!   `--assistant-mcp-bridge` 模式（见 bridge.rs），工具经桥接抵达
//!   mcp-serve 与宿主情景工具；
//! - omp 崩溃/退出后由 [`OmpState::get_or_spawn`] 在下次使用时重拉，
//!   会话 id 在 omp 侧落盘，重拉后 session/load 续上。
//!
//! omp 可执行文件解析（计划约定）：
//! - 分发构建：资源目录 `binaries/omp`（随安装包分发的固定版本）；
//! - 开发构建：仓库配置（`TOD_OMP_BIN` 环境变量）优先；
//! - 两者之后都回落 PATH 查找；都没有 → 助手空态报“未安装”。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use serde_json::json;
use tokio::process::{Child, Command};

use super::acp::{AcpConn, AcpHandlers};
use super::events;

#[cfg(windows)]
use crate::job;

/// 兜底查找名（Windows 带后缀）。
#[cfg(windows)]
pub const OMP_EXE: &str = "omp.exe";
#[cfg(not(windows))]
pub const OMP_EXE: &str = "omp";

/// 解析 omp 可执行命令。返回 None = 未安装（空态依据）。
pub fn resolve_omp_command(resource_dir: Option<&Path>) -> Option<Vec<String>> {
    // 1) 显式指定（开发/排障逃生口，两种构建都认）
    if let Some(path) = std::env::var_os("TOD_OMP_BIN") {
        let p = PathBuf::from(&path);
        if p.is_file() {
            return Some(vec![p.to_string_lossy().into_owned()]);
        }
    }
    // 2) 分发：资源目录内打包的固定版本
    if !cfg!(debug_assertions) {
        if let Some(rd) = resource_dir {
            let p = rd.join("binaries").join(OMP_EXE);
            if p.is_file() {
                return Some(vec![p.to_string_lossy().into_owned()]);
            }
        }
    }
    // 3) PATH 查找
    find_in_path(OMP_EXE).map(|p| vec![p.to_string_lossy().into_owned()])
}

fn find_in_path(exe: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|d| d.join(exe))
        .find(|p| p.is_file())
        .filter(|p| is_executable(p))
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(_p: &Path) -> bool {
    true // Windows 上存在即可执行（OMP_EXE 已带 .exe 后缀）
}

/// 审批配置覆盖文件内容：只读白名单免确认（原 READ_ONLY_TOOLS 语义），
/// 其余一律审批（fail-closed）。键是 omp 消毒后的 xd 工具名。
pub fn overlay_yaml() -> String {
    let mut allows: Vec<String> = events::READ_ONLY_TOOLS
        .iter()
        .map(|t| format!("    {}: allow", events::mcp_tool_name(t)))
        .collect();
    allows.sort();
    format!(
        "# 由 transfer-orbit-design 生成：AI 助手工具审批策略（勿手改）\ntools:\n  approvalMode: always-ask\n  approval:\n{}\n",
        allows.join("\n")
    )
}

/// 把覆盖文件写到配置目录（每次拉起 omp 前刷新，内容幂等）。
pub fn write_overlay(config_dir: &Path) -> Result<PathBuf> {
    let path = config_dir.join("omp-approval-overlay.yaml");
    std::fs::create_dir_all(config_dir).context("创建应用配置目录失败")?;
    std::fs::write(&path, overlay_yaml())
        .with_context(|| format!("写入 {}", path.display()))?;
    Ok(path)
}

/// 全局唯一的 omp 拉起配置（setup 时写入一次；运行期输入，保留 OnceLock）。
static SPAWN_CONFIG: std::sync::OnceLock<(Vec<String>, std::path::PathBuf)> =
    std::sync::OnceLock::new();

/// omp 进程状态：懒启动 + 崩溃重建（与 SidecarState/McpState 同型）。
pub struct OmpState {
    conn: tokio::sync::Mutex<Option<AcpConn>>,
    /// 进程退出收割 + 换代关停（与 mcp.rs 同策略）。
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
}

impl Default for OmpState {
    fn default() -> Self {
        Self::new()
    }
}

impl OmpState {
    pub fn new() -> Self {
        Self {
            conn: tokio::sync::Mutex::new(None),
            child: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    /// 注册拉起配置（app setup 阶段调用一次）。cwd 是 ACP 会话工作目录
    /// （应用配置目录：会话索引按它过滤，避免混入用户 CLI 会话）。
    pub fn configure(command: Vec<String>, cwd: std::path::PathBuf) {
        let _ = SPAWN_CONFIG.set((command, cwd));
    }

    /// 已配置的会话工作目录（session/list 过滤与 session/new cwd 共用）。
    pub fn session_cwd() -> Option<std::path::PathBuf> {
        SPAWN_CONFIG.get().map(|(_, cwd)| cwd.clone())
    }

    /// setup 阶段解析并注册的 omp 命令（发布构建含资源目录内打包 omp）。
    /// 状态面（空态判定/omp 路径展示/setup 按钮）以此为准；未注册时回落
    /// 一次实时解析，保住设置面板"安装后刷新"的语义。
    pub fn configured_command() -> Option<Vec<String>> {
        SPAWN_CONFIG
            .get()
            .map(|(cmd, _)| cmd.clone())
            .or_else(|| resolve_omp_command(None))
    }

    /// 取活跃连接；没有或已死则重拉 omp 并完成 ACP initialize。
    /// 返回 (连接, 是否新拉)。
    pub async fn get_or_spawn(&self, handlers: Arc<dyn AcpHandlers>) -> Result<(AcpConn, bool)> {
        let mut guard = self.conn.lock().await;
        if let Some(conn) = guard.as_ref() {
            if conn.is_alive() {
                return Ok((conn.clone(), false));
            }
        }
        let (command, cwd) = SPAWN_CONFIG
            .get()
            .ok_or_else(|| anyhow!("omp 拉起配置未注册（setup 未执行）"))?;
        let conn = self.spawn(command, cwd, handlers).await?;
        *guard = Some(conn.clone());
        Ok((conn, true))
    }

    /// 当前连接（不重拉；None = 尚未启动或已死）。
    pub async fn current(&self) -> Option<AcpConn> {
        self.conn
            .lock()
            .await
            .as_ref()
            .filter(|c| c.is_alive())
            .cloned()
    }

    async fn spawn(
        &self,
        command: &[String],
        cwd: &Path,
        handlers: Arc<dyn AcpHandlers>,
    ) -> Result<AcpConn> {
        let overlay = write_overlay(cwd)?;
        let mut cmd = Command::new(&command[0]);
        cmd.args(&command[1..])
            .arg("acp")
            .arg("--config")
            .arg(&overlay)
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        // 桥接进程由 omp 按 ACP mcpServers 拉起，mcp-serve 命令经环境
        // 传递（不含任何密钥；见 bridge.rs）
        cmd.env("TOD_MCP_COMMAND_JSON", serde_json::to_string(&mcp_argv())?);
        if let Some(mcp_cwd) = mcp_cwd() {
            cmd.env("TOD_MCP_CWD", mcp_cwd);
        }
        let mut child = cmd
            .spawn()
            .with_context(|| format!("拉起 {} 失败", command[0]))?;
        #[cfg(windows)]
        let _job = job::assign_tree_to_kill_on_close_job(&mut child);
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let conn = AcpConn::spawn_on(stdout, stdin, handlers);
        // 换代：收割旧进程
        if let Some(mut old) = self.child.lock().await.take() {
            let _ = old.start_kill();
            let _ = old.wait().await;
        }
        *self.child.lock().await = Some(child);
        // ACP 握手（omp 未配置 provider 时握手也成功；模型错误在 prompt 时暴露）
        conn.request(
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": {
                    // elicitation.form 是 omp 审批表单（Allow tool）的触发
                    // 条件，实测不声明则工具审批被静默拒绝
                    "elicitation": {"form": {}}
                }
            }),
        )
        .await
        .context("omp ACP initialize 失败")?;
        Ok(conn)
    }
}

/// mcp-serve 拉起 argv（dev：仓库根 uv；分发：TOD_RESOURCE_DIR 指向的
/// 资源目录内打包 sidecar——app setup 在启动时写入该环境变量，经 omp
/// 继承给桥接进程）。
pub fn mcp_argv() -> Vec<String> {
    mcp_command().0
}

/// mcp-serve 的工作目录（dev=仓库根：星历/轨道库按仓相对解析；分发=
/// 资源根）。与会话目录（session cwd）是两回事，勿混。
pub fn mcp_cwd() -> Option<PathBuf> {
    mcp_command().1.map(PathBuf::from)
}

fn mcp_command() -> (Vec<String>, Option<String>) {
    if cfg!(debug_assertions) {
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        crate::dev_mcp_command(repo_root)
    } else {
        let rd = std::env::var_os("TOD_RESOURCE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        crate::packaged_mcp_command(&rd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_marks_readonly_tools_allow_and_rest_ask() {
        let yaml = overlay_yaml();
        assert!(yaml.contains("approvalMode: always-ask"));
        for tool in events::READ_ONLY_TOOLS {
            assert!(yaml.contains(&format!("{}: allow", events::mcp_tool_name(tool))));
        }
        // 写工具不在白名单：始终走审批
        assert!(!yaml.contains("scenario_write"));
        assert!(!yaml.contains("cr3bp_compute"));
    }

    #[test]
    fn resolve_omp_command_returns_shape_or_none() {
        // 本机（开发环境）PATH 里应有 omp；剥离 PATH 的环境允许 None
        if let Some(cmd) = resolve_omp_command(None) {
            assert!(!cmd[0].is_empty());
        }
    }
}
