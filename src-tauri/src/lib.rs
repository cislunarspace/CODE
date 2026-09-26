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
/// 根，e2m2e Config 的 kernels/ 按 cwd 相对解析（安装目录内 resources 已
/// 带 kernels/；可被 SPICE_KERNEL_DIR 覆盖）。轨道库不依赖 cwd：目录由
/// setup 显式注入用户配置目录（见 `configure_catalog_env`），否则打包形态
/// 的库会落安装目录、应用升级即丢。
pub fn packaged_sidecar_command(resource_dir: &std::path::Path) -> (Vec<String>, Option<String>) {
    let exe = resource_dir.join("binaries").join(SIDECAR_EXE);
    (
        vec![exe.to_string_lossy().into_owned()],
        Some(resource_dir.to_string_lossy().into_owned()),
    )
}

/// 轨道库显式配置（#491）：给出要注入的环境变量计划，用户已显式设置的
/// 变量不出现在计划里（它们优先）。
///
/// 为什么必须显式注入：e2m2e 钉住的 5.9.4 里 `catalog_enabled` 硬编码为真、
/// `catalog_dir` 缺省 `"catalog"` 相对 cwd（dev 落仓库根、打包落安装目录，
/// 升级丢库）；上游 ADR 0047（v5.9.5）把两者默认翻转为关闭/None，未指定
/// 时入库请求报 `CATALOG_NOT_CONFIGURED`，而本仓 `cmd.rs` 只在 `record_id`
/// 非空时入项目树、无 else 分支——静默丢记录比显式报错更坏。
///
/// `enabled` 与 `user_dir` 解耦：取不到用户目录时仍注入 `enabled=1`。无
/// HOME/APPDATA（`config_dir()` 返回 None）时，5.9.4 下维持原 cwd 行为，
/// ≥5.9.5 下由 e2m2e 如实报 `CATALOG_NOT_CONFIGURED`——比静默丢记录好。
///
/// 不在 Rust 侧建目录或猜路径：库由 e2m2e 在指定目录上创建，目录不可写也
/// 由它如实报错。
pub fn catalog_env_plan(
    existing_dir: Option<&std::ffi::OsStr>,
    existing_enabled: Option<&std::ffi::OsStr>,
    user_dir: Option<&std::path::Path>,
) -> Vec<(&'static str, std::ffi::OsString)> {
    let mut plan = Vec::new();
    if existing_dir.is_none() {
        if let Some(dir) = user_dir {
            plan.push(("E2M2E_CATALOG_DIR", dir.join("catalog").into_os_string()));
        }
    }
    if existing_enabled.is_none() {
        plan.push(("E2M2E_CATALOG_ENABLED", std::ffi::OsString::from("1")));
    }
    plan
}

/// 应用 `catalog_env_plan`：库目录取用户配置目录下的 catalog/，与
/// scenarios/ 同级。进程级 set_var 即够——sidecar 惰性 spawn、助手链经
/// app → omp → bridge → mcp-serve 全部继承本进程环境（`TOD_RESOURCE_DIR`
/// 走同一条路径，全仓无 env_clear）。
fn configure_catalog_env() {
    let user_dir = assistant::host_tools::config_dir();
    for (key, value) in catalog_env_plan(
        std::env::var_os("E2M2E_CATALOG_DIR").as_deref(),
        std::env::var_os("E2M2E_CATALOG_ENABLED").as_deref(),
        user_dir.as_deref(),
    ) {
        std::env::set_var(key, value);
    }
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
            // 轨道库自动配置（#491）：目录钉到用户配置目录下的 catalog/，
            // 不随 cwd（dev 仓库根 / 打包安装目录）漂移。同样子进程继承，
            // 用户显式设置的环境优先。
            configure_catalog_env();
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
            assistant_cmd::assistant_set_config_option,
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

    #[test]
    fn catalog_env_plan_injects_dir_and_enabled_when_unset() {
        let plan = catalog_env_plan(None, None, Some(std::path::Path::new("/cfg")));
        let expected_dir = std::path::Path::new("/cfg").join("catalog").into_os_string();
        assert_eq!(
            plan,
            vec![
                ("E2M2E_CATALOG_DIR", expected_dir),
                ("E2M2E_CATALOG_ENABLED", std::ffi::OsString::from("1")),
            ]
        );
    }

    #[test]
    fn catalog_env_plan_respects_preset_env() {
        let dir = std::ffi::OsStr::new("/mine");
        let on = std::ffi::OsStr::new("1");
        let cfg = std::path::Path::new("/cfg");
        assert!(catalog_env_plan(Some(dir), Some(on), Some(cfg)).is_empty());
        // 仅 dir 预设：只补 enabled，不覆盖用户目录
        assert_eq!(
            catalog_env_plan(Some(dir), None, Some(cfg)),
            vec![("E2M2E_CATALOG_ENABLED", std::ffi::OsString::from("1"))]
        );
    }

    #[test]
    fn catalog_env_plan_without_user_dir_injects_only_enabled() {
        // 无 HOME/APPDATA：不猜路径，只保证入库开关打开（#491 fail-loud 取舍）
        assert_eq!(
            catalog_env_plan(None, None, None),
            vec![("E2M2E_CATALOG_ENABLED", std::ffi::OsString::from("1"))]
        );
    }
}