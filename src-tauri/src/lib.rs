//! transfer-orbit-design Tauri 应用：sidecar 状态 + 命令注册。

pub mod assistant;
pub mod assistant_cmd;
pub mod cmd;
pub mod job;
pub mod mcp;
pub mod project;
pub mod sidecar;
pub mod state;
pub mod update;

use project::ProjectState;
use state::SidecarState;
use tauri::{Emitter, Manager};

/// 星历自动配置：内核目录解析（dev=仓库 kernels/，打包=resource kernels/）。
/// 目录不存在时返回 None（状态命令报缺失，不阻塞启动）。
pub fn resolve_kernel_dir(resource_dir: Option<&std::path::Path>) -> Option<std::path::PathBuf> {
    let base = match resource_dir {
        Some(rd) => rd.to_path_buf(),
        None => std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent()?.to_path_buf(),
    };
    let dir = base.join("kernels");
    dir.is_dir().then_some(dir)
}

/// 分发期 sidecar 可执行文件名（resources/binaries/ 下，Windows 带后缀）。
#[cfg(windows)]
pub const SIDECAR_EXE: &str = "transfer-orbit-design-sidecar.exe";
#[cfg(not(windows))]
pub const SIDECAR_EXE: &str = "transfer-orbit-design-sidecar";

/// 开发期拉起配置：仓库根下 uv 拉起 e2m2e CLI（serve-stdio）。
pub fn dev_sidecar_command(repo_root: &std::path::Path) -> (Vec<String>, Option<String>) {
    (
        vec!["uv".into(), "run".into(), "e2m2e".into(), "serve-stdio".into()],
        Some(repo_root.to_string_lossy().into_owned()),
    )
}

/// AI 助手的 mcp-serve 拉起配置（本仓 ADR 0023）：与 sidecar 同一可执行
/// 入口，仅子命令不同（sidecar_main.py 透传 argv）。
pub fn dev_mcp_command(repo_root: &std::path::Path) -> (Vec<String>, Option<String>) {
    (
        vec!["uv".into(), "run".into(), "e2m2e".into(), "mcp-serve".into()],
        Some(repo_root.to_string_lossy().into_owned()),
    )
}

pub fn packaged_mcp_command(resource_dir: &std::path::Path) -> (Vec<String>, Option<String>) {
    let exe = resource_dir.join("binaries").join(SIDECAR_EXE);
    (
        vec![exe.to_string_lossy().into_owned(), "mcp-serve".into()],
        Some(resource_dir.to_string_lossy().into_owned()),
    )
}

/// 分发期拉起配置：resources/binaries 内的打包 sidecar，cwd 指 resource
/// 根，e2m2e Config 的 kernels/、catalog/ 按 cwd 相对解析（安装目录内
/// resources 已带 kernels/，catalog/ 运行时创建；两个路径均可被
/// SPICE_KERNEL_DIR / E2M2E_CATALOG_DIR 环境变量覆盖）。
pub fn packaged_sidecar_command(resource_dir: &std::path::Path) -> (Vec<String>, Option<String>) {
    let exe = resource_dir.join("binaries").join(SIDECAR_EXE);
    (
        vec![exe.to_string_lossy().into_owned()],
        Some(resource_dir.to_string_lossy().into_owned()),
    )
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 开发期（cargo tauri dev，debug 构建）：仓库根下 uv 拉起；
            // 分发期（release 构建）：resources/binaries 内的打包 sidecar。
            let resource_dir_handle = app.path().resource_dir().ok();
            let (command, cwd) = if cfg!(debug_assertions) {
                let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
                dev_sidecar_command(repo_root)
            } else {
                let resource_dir = resource_dir_handle.as_deref().unwrap();
                packaged_sidecar_command(resource_dir)
            };
            // 星历自动配置：内核随 git（LFS）与安装包分发，启动时把内核
            // 目录钉进 SPICE_KERNEL_DIR——e2m2e pip 安装布局下闰秒内核自动
            // 搜索路径错位（detect_kernel_dir 注释），必须显式指定；子进程
            // 自动继承。用户显式设置的环境优先，不被覆盖。
            if std::env::var_os("SPICE_KERNEL_DIR").is_none() {
                let kernel_dir = if cfg!(debug_assertions) {
                    resolve_kernel_dir(None)
                } else {
                    resolve_kernel_dir(resource_dir_handle.as_deref())
                };
                if let Some(dir) = kernel_dir {
                    std::env::set_var("SPICE_KERNEL_DIR", &dir);
                }
            }
            SidecarState::configure(command, cwd);
            // AI 助手（omp ACP 基座）：dev 用 TOD_OMP_BIN/PATH 的 omp，
            // 分发用资源目录内打包的固定版本 omp；ACP 会话工作目录取
            // 应用配置目录（会话索引按它过滤，不混入用户 CLI 会话）。
            // mcp-serve 不再由本进程管理——omp 经桥接子进程拉起（ADR 更新）。
            if let Some(resource_dir) = resource_dir_handle.as_deref() {
                if !cfg!(debug_assertions) {
                    // 桥接进程按它定位打包 mcp-serve（经 omp 环境继承）
                    std::env::set_var("TOD_RESOURCE_DIR", resource_dir);
                }
            }
            if let Some(omp_command) =
                assistant::omp::resolve_omp_command(resource_dir_handle.as_deref())
            {
                if let Some(cwd) = assistant::host_tools::config_dir() {
                    assistant::omp::OmpState::configure(omp_command, cwd);
                }
            }
            // 进度事件 → 前端窗口
            let handle = app.handle().clone();
            state::set_progress_emitter(std::sync::Arc::new(move |ev: &serde_json::Value| {
                let _ = handle.emit(cmd::PROGRESS_EVENT, ev);
            }));
            // AI 助手事件 → 前端窗口
            let assistant_handle = app.handle().clone();
            assistant::set_emitter(std::sync::Arc::new(move |ev: &serde_json::Value| {
                let _ = assistant_handle.emit(assistant::ASSISTANT_EVENT, ev);
            }));
            app.manage(SidecarState::new());
            app.manage(ProjectState::new());
            app.manage(assistant::AssistantState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd::run_tool,
            cmd::list_artifacts,
            cmd::remove_artifact,
            cmd::get_artifact,
            cmd::catalog_query,
            cmd::register_artifact,
            cmd::ephemeris_status,
            cmd::bundle_type,
            update::update_check_latest,
            update::update_download,
            update::update_install,
            cmd::save_scenario,
            cmd::scenarios_dir,
            cmd::open_scenario,
            assistant_cmd::assistant_get_state,
            assistant_cmd::assistant_send,
            assistant_cmd::assistant_confirm_tool,
            assistant_cmd::assistant_cancel,
            assistant_cmd::assistant_clear_history,
            assistant_cmd::assistant_new_session,
            assistant_cmd::assistant_switch_session,
            assistant_cmd::assistant_set_thinking_level,
            assistant_cmd::assistant_open_omp_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_command_points_at_resource_binaries_with_resource_cwd() {
        let root = std::path::Path::new("/opt/transfer-orbit-design");
        let (cmd, cwd) = packaged_sidecar_command(root);
        let expected = root.join("binaries").join(SIDECAR_EXE);
        assert_eq!(cmd, vec![expected.to_string_lossy().into_owned()]);
        assert_eq!(cwd.as_deref(), Some("/opt/transfer-orbit-design"));
    }

    #[test]
    fn dev_command_spawns_uv_with_repo_cwd() {
        let root = std::path::Path::new("/repo");
        let (cmd, cwd) = dev_sidecar_command(root);
        assert_eq!(cmd, vec!["uv", "run", "e2m2e", "serve-stdio"]);
        assert_eq!(cwd.as_deref(), Some("/repo"));
    }
}