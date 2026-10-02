//! pi 运行时适配：可执行文件解析、桥接扩展定位与 RPC 进程生命周期。
//!
//! 拓扑（一次 RPC 进程服务多个会话，不为每个会话起独立 pi）：
//! - app 进程懒启动一个 `pi --mode rpc` 子进程，扩展层加载桥接扩展
//!   （tod-bridge.ts）——扩展内 `registerMcpServer` 拉起本应用二进制的
//!   `--assistant-mcp-bridge` 模式（见 bridge.rs），工具经桥接抵达
//!   mcp-serve 与宿主情景工具；审批闸也在扩展内（ADR 0032）；
//! - pi 崩溃/退出后由 [`PiState::get_or_spawn`] 在下次使用时重拉，
//!   会话文件落在 `PI_CODING_AGENT_SESSION_DIR` 指定的应用目录，
//!   重拉后 switch_session 续上。
//!
//! pi 可执行文件解析（与 omp 时代同序）：
//! - 开发/排障：`TOD_PI_BIN` 环境变量优先（两种构建都认）；
//! - 分发构建：资源目录 `binaries/pi`（Windows `pi.exe`，随安装包分发的
//!   固定版本；Linux aarch64 为自解包壳）；
//! - 之后回落 PATH 查找；都没有 → 助手空态报“未安装”。
//!
//! 桥接扩展路径解析：
//! - `TOD_PI_EXTENSION` env（开发/排障逃生口）；
//! - `<resource_dir>/resources/assistant/tod-bridge.ts`（分发）；
//! - repo 相对 `src-tauri/resources/assistant/tod-bridge.ts`（dev）。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use tokio::process::{Child, Command};

use super::rpc::{RpcConn, RpcHandlers};

#[cfg(windows)]
use crate::job;

/// 兜底查找名（Windows 带后缀）。
#[cfg(windows)]
pub const PI_EXE: &str = "pi.exe";
#[cfg(not(windows))]
pub const PI_EXE: &str = "pi";

/// 桥接扩展文件名（resources/assistant/ 下）。
pub const BRIDGE_EXTENSION: &str = "tod-bridge.ts";

/// 解析 pi 可执行命令。返回 None = 未安装（空态依据）。
pub fn resolve_pi_command(resource_dir: Option<&Path>) -> Option<Vec<String>> {
    // 1) 显式指定（开发/排障逃生口，两种构建都认）
    if let Some(path) = std::env::var_os("TOD_PI_BIN") {
        let p = PathBuf::from(&path);
        if p.is_file() {
            return Some(vec![p.to_string_lossy().into_owned()]);
        }
    }
    // 2) 分发：资源目录内打包的固定版本
    if !cfg!(debug_assertions) {
        if let Some(rd) = resource_dir {
            let p = rd.join("binaries").join(PI_EXE);
            if p.is_file() {
                return Some(vec![p.to_string_lossy().into_owned()]);
            }
        }
    }
    // 3) PATH 查找
    find_in_path(PI_EXE).map(|p| vec![p.to_string_lossy().into_owned()])
}

/// 解析桥接扩展绝对路径（加载参数 --extension 用）。
///
/// 解析顺序：TOD_PI_EXTENSION env（开发/排障逃生口）→ TOD_RESOURCE_DIR
/// env 下 `resources/assistant/`（分发：lib.rs setup 在发布构建注入该
/// 变量，spawn 时经环境读取——SPAWN_CONFIG 不存 resource_dir，拉起点与
/// setup 点解耦）→ repo 相对路径（dev 兜底）。
pub fn resolve_bridge_extension() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("TOD_PI_EXTENSION") {
        let p = PathBuf::from(&path);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(rd) = std::env::var_os("TOD_RESOURCE_DIR") {
        let p = Path::new(&rd)
            .join("resources")
            .join("assistant")
            .join(BRIDGE_EXTENSION);
        if p.is_file() {
            return Some(p);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("assistant")
        .join(BRIDGE_EXTENSION);
    dev.is_file().then_some(dev)
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
    true // Windows 上存在即可执行（PI_EXE 已带 .exe 后缀）
}

/// 全局唯一的 pi 拉起配置（setup 时写入一次；运行期输入，保留 OnceLock）：
/// (pi 命令, 应用会话目录)。会话目录注入 PI_CODING_AGENT_SESSION_DIR，
/// 与用户终端 pi 会话隔离；切换器列表扫描它。
static SPAWN_CONFIG: std::sync::OnceLock<(Vec<String>, std::path::PathBuf)> =
    std::sync::OnceLock::new();

/// pi 进程状态：懒启动 + 崩溃重建（与 SidecarState/McpState 同型）。
pub struct PiState {
    conn: tokio::sync::Mutex<Option<RpcConn>>,
    /// 进程退出收割 + 换代关停（与 mcp.rs 同策略）。
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
}

impl Default for PiState {
    fn default() -> Self {
        Self::new()
    }
}

impl PiState {
    pub fn new() -> Self {
        Self {
            conn: tokio::sync::Mutex::new(None),
            child: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }
    /// 注册拉起配置（app setup 阶段调用一次）。session_dir 是应用会话目录
    ///（`PI_CODING_AGENT_SESSION_DIR`，host_tools::config_dir()/pi-sessions）。
    pub fn configure(command: Vec<String>, session_dir: std::path::PathBuf) {
        let _ = SPAWN_CONFIG.set((command, session_dir));
    }

    /// 应用会话目录（setup 注册的拉起配置第二项；索引扫描目标）。
    pub fn session_dir() -> Option<std::path::PathBuf> {
        SPAWN_CONFIG.get().map(|(_, dir)| dir.clone())
    }

    /// setup 阶段解析并注册的 pi 命令（发布构建含资源目录内打包 pi）。
    /// 状态面（空态判定/pi 路径展示/setup 按钮）以此为准；未注册时回落
    /// 一次实时解析，保住设置面板“安装后刷新”的语义。
    pub fn configured_command() -> Option<Vec<String>> {
        SPAWN_CONFIG
            .get()
            .map(|(cmd, _)| cmd.clone())
            .or_else(|| resolve_pi_command(None))
    }

    /// 取活跃连接；没有或已死则重拉 pi。返回 (连接, 是否新拉)。
    pub async fn get_or_spawn(&self, handlers: Arc<dyn RpcHandlers>) -> Result<(RpcConn, bool)> {
        let mut guard = self.conn.lock().await;
        if let Some(conn) = guard.as_ref() {
            if conn.is_alive() {
                return Ok((conn.clone(), false));
            }
        }
        let (command, session_dir) = SPAWN_CONFIG
            .get()
            .ok_or_else(|| anyhow!("pi 拉起配置未注册（setup 未执行）"))?;
        let conn = self.spawn(command, session_dir, handlers).await?;
        *guard = Some(conn.clone());
        Ok((conn, true))
    }

    /// 当前连接（不重拉；None = 尚未启动或已死）。
    pub async fn current(&self) -> Option<RpcConn> {
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
        session_dir: &Path,
        handlers: Arc<dyn RpcHandlers>,
    ) -> Result<RpcConn> {
        let extension = resolve_bridge_extension().ok_or_else(|| {
            anyhow!("桥接扩展 tod-bridge.ts 未找到（resources/assistant/ 或 TOD_PI_EXTENSION）")
        })?;
        // cwd 必须存在（Command 对缺失目录直接报错）；目录由本侧负责创建
        std::fs::create_dir_all(session_dir).with_context(|| {
            format!("创建 pi 会话目录失败：{}", session_dir.display())
        })?;
        let mut cmd = Command::new(&command[0]);
        // command 形如 [pi] 或 [python3, <fixture>]：前置参数先落，pi 旗标在后
        cmd.args(&command[1..]);
        // --no-extensions：不加载用户个人扩展，显式 -e 保住内置 MCP 与桥接。
        cmd.args([
            "--mode",
            "rpc",
            "--no-extensions",
            "--extension",
            "builtin:mcp",
            "--extension",
        ])
        .arg(&extension)
        .arg("--no-builtin-tools")
        .current_dir(session_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);
        // 会话目录隔离：应用会话与用户终端 pi 会话互不可见
        cmd.env("PI_CODING_AGENT_SESSION_DIR", session_dir);
        // 桥接进程（--assistant-mcp-bridge）由扩展拉起，mcp-serve 命令经
        // 环境传递（不含任何密钥；见 bridge.rs 与 ADR 0032 决策 2），扩展
        // 的子进程默认继承本进程环境
        cmd.env("TOD_MCP_COMMAND_JSON", serde_json::to_string(&mcp_argv())?);
        if let Some(mcp_cwd) = mcp_cwd() {
            cmd.env("TOD_MCP_CWD", mcp_cwd);
        }
        cmd.env(
            "TOD_APP_BIN",
            std::env::current_exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
        );
        if let Some(bridge_cwd) = mcp_cwd() {
            cmd.env("TOD_BRIDGE_CWD", bridge_cwd);
        }
        let mut child = cmd
            .spawn()
            .with_context(|| format!("拉起 {} 失败", command[0]))?;
        #[cfg(windows)]
        let _job = job::assign_tree_to_kill_on_close_job(&mut child);
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let conn = RpcConn::spawn_on(stdout, stdin, handlers);
        // 换代：收割旧进程
        if let Some(mut old) = self.child.lock().await.take() {
            let _ = old.start_kill();
            let _ = old.wait().await;
        }
        *self.child.lock().await = Some(child);
        // pi RPC 无握手命令：get_state 即探活（pi 未配置 provider 时也成功；
        // 模型错误在 prompt 时暴露）
        conn.request("get_state", serde_json::json!({})).await?;
        Ok(conn)
    }
}

/// mcp-serve 拉起 argv（dev：仓库根 uv；分发：TOD_RESOURCE_DIR 指向的
/// 资源目录内打包 sidecar——app setup 在启动时写入该环境变量，经 pi
/// 继承给扩展与桥接进程）。
pub fn mcp_argv() -> Vec<String> {
    mcp_command().0
}

/// mcp-serve 的工作目录（dev=仓库根：星历/轨道库按仓相对解析；分发=
/// 资源根）。注入 TOD_BRIDGE_CWD 给桥接扩展。
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
    fn resolve_pi_command_returns_shape_or_none() {
        // 本机（开发环境）PATH 里应有 pi；剥离 PATH 的环境允许 None
        if let Some(cmd) = resolve_pi_command(None) {
            assert!(!cmd[0].is_empty());
        }
    }

    #[test]
    fn bridge_extension_resolves_in_dev_repo() {
        let p = resolve_bridge_extension().expect("dev 仓内应找到扩展");
        assert!(p.to_string_lossy().contains("tod-bridge.ts"));
    }
}
