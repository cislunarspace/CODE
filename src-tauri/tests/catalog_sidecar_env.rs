//! 显式 catalog 环境变量对真实 sidecar 的行为验证（#491）。
//!
//! 独立测试二进制：本文件内的 env 变异不与 sidecar_process.rs 的并行测试
//! 互相污染。验证的是 app 注入的环境（E2M2E_CATALOG_DIR/ENABLED）经子进程
//! 继承后，e2m2e 真的把产物写进指定目录并回执 record_id——而非只看 Config
//! 读没读到变量。
//!
//! 依赖：本仓库 uv 环境（`uv run e2m2e serve-stdio` 可用）。CI 无 Python
//! 环境时用 `--skip sidecar` 跳过（测试名含 sidecar）。

use serde_json::json;

use transfer_orbit_design_lib::sidecar::SidecarHandle;

/// 库目录环境变量的临时沙盒：构造时改写进程环境，Drop 时还原原值。
///
/// 基线导入显式关闭（`E2M2E_CATALOG_BASELINE_IMPORT=0`）：否则首次打开空库
/// 会从包内展开整个基线数据集，慢且与本测试断言无关。
struct EnvGuard {
    dir: std::path::PathBuf,
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl EnvGuard {
    fn install() -> Self {
        let dir = std::env::temp_dir().join("tod-catalog-env-test");
        let _ = std::fs::remove_dir_all(&dir);
        let saved = [
            "E2M2E_CATALOG_DIR",
            "E2M2E_CATALOG_ENABLED",
            "E2M2E_CATALOG_BASELINE_IMPORT",
        ]
        .into_iter()
        .map(|key| (key, std::env::var_os(key)))
        .collect();
        std::env::set_var("E2M2E_CATALOG_DIR", &dir);
        std::env::set_var("E2M2E_CATALOG_ENABLED", "1");
        std::env::set_var("E2M2E_CATALOG_BASELINE_IMPORT", "0");
        Self { dir, saved }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.saved.drain(..) {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[tokio::test]
async fn sidecar_design_orbit_with_explicit_catalog_env_yields_record_id() {
    let guard = EnvGuard::install();
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let handle = SidecarHandle::spawn(&["uv", "run", "e2m2e", "serve-stdio"], Some(repo_root))
        .expect("拉起 sidecar 失败（uv 环境可用？）");

    // DRO + amplitude 60000 km + 1 个月：真路径上已验证收敛的最轻量组合
    // （tests/engine/test_facade_bridge_e2m2e_smoke.py 的同族参数，duration
    // 在协议层是秒）。
    let result = handle
        .request(
            "design_orbit",
            &json!({"orbit_type": "DRO", "amplitude": 60000.0, "duration": 2629800.0}),
            None,
        )
        .await
        .expect("请求失败");
    assert_eq!(result.status, "ok", "错误：{:#?}", result.error);
    assert!(
        result.data["record_id"].as_str().is_some_and(|id| !id.is_empty()),
        "入库未回执 record_id：{:#?}",
        result.data
    );

    // 注入的库目录被采用：记录真的落在显式指定的目录下
    let records = guard.dir.join("records");
    let json_count = std::fs::read_dir(&records)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().extension().is_some_and(|ext| ext == "json"))
                .count()
        })
        .unwrap_or(0);
    assert!(json_count >= 1, "{} 下没有记录 JSON", records.display());

    handle.shutdown().await.unwrap();
}
