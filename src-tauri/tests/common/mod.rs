//! Rust 集成测试的共享设施。
//!
//! catalog 环境变量：本仓集成测试直接 spawn e2m2e CLI，不经 Tauri app setup 的
//! `configure_catalog_env`（#498），拿不到 Rust 壳注入的库目录与入库开关。e2m2e
//! 5.9.5 起二者都无隐式默认（ADR 0047）：未配置时 `record_id` / `family_id`
//! 静默为 None、库操作报 `CATALOG_NOT_CONFIGURED`，入库断言必红。各测试二进制
//! 因此自行注入同一组环境。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 安装 catalog 环境变量并返回临时库目录。
///
/// 装的是 `E2M2E_CATALOG_DIR=<系统临时目录>/<dir_name>` 与
/// `E2M2E_CATALOG_ENABLED=1`，与 Rust 壳生产注入同口径。
///
/// 每个测试二进制调用一次即可：同一进程内的测试并行跑，环境变量是进程全局的，
/// 装一次就够（`OnceLock` 保证初始化互斥，先到者的 `dir_name` 生效），也避免
/// 各测试各自 `set_var` 相互竞争。`dir_name` 各二进制必须不同——它们是独立
/// 进程、并行执行，共用同一个临时子目录会互相删除。
pub fn install_catalog_env(dir_name: &str) -> &'static Path {
    // 初始化依赖运行期入参（各二进制不同的临时目录名），故用 OnceLock 而非
    // LazyLock：后者要求初始化器在声明处闭合。
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::temp_dir().join(dir_name);
        // 清掉上一轮运行的残留（测试进程退出不回收临时目录）
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("E2M2E_CATALOG_DIR", &dir);
        std::env::set_var("E2M2E_CATALOG_ENABLED", "1");
        dir
    })
}
