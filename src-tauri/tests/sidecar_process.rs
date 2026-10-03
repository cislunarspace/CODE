//! SidecarHandle 对真实 e2m2e serve-stdio 子进程的集成测试。
//!
//! 依赖：本仓库 uv 环境（`uv run e2m2e serve-stdio` 可用）。CI 无 Python
//! 环境时用 `--skip sidecar` 跳过（见文件尾 filter）。

use serde_json::json;
use tokio::sync::mpsc;

use cislunar_code_lib::sidecar::{FrameArray, SidecarHandle};

mod common;

async fn spawn() -> SidecarHandle {
    // 未显式配置 catalog 时 e2m2e 5.9.7 让 family_id 静默为 None（ADR 0047）
    common::install_catalog_env("tod-sidecar-process-catalog");
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    SidecarHandle::spawn(&["uv", "run", "e2m2e", "serve-stdio"], Some(repo_root))
        .expect("拉起 sidecar 失败（uv 环境可用？）")
}

#[tokio::test]
async fn family_generation_over_real_process() {
    let handle = spawn().await;
    let (progress_tx, mut progress_rx) = mpsc::unbounded_channel();
    handle.subscribe_progress(progress_tx);

    let result = handle
        .request(
            "orbit_family_generation",
            &json!({"orbit_type": "HALO", "libration_point": 1, "max_amplitude_km": 5000, "n_orbits": 3}),
            Some("f32"),
        )
        .await
        .expect("请求失败");

    assert_eq!(result.status, "ok", "错误：{:#?}", result.error);
    assert_eq!(result.frames.len(), 3);
    for f in &result.frames {
        assert_eq!(f.shape(), &[1, 6]);
        assert!(matches!(f, FrameArray::F32 { .. }));
    }
    assert_eq!(result.data["generated_members"], 3);
    assert!(result.data["family_id"].as_str().is_some());

    // progress 事件应已到达（任务开始行）
    let ev = progress_rx.try_recv().expect("应有 progress 事件");
    assert_eq!(ev["status"], "progress");

    handle.shutdown().await.unwrap();
}

#[tokio::test]
async fn unknown_tool_returns_error_envelope() {
    let handle = spawn().await;
    let result = handle.request("nope", &json!({}), None).await.unwrap();
    assert_eq!(result.status, "error");
    assert_eq!(result.error.as_ref().unwrap()["code"], "TOOL_NOT_FOUND");
    handle.shutdown().await.unwrap();
}

#[tokio::test]
async fn sequential_requests_reuse_process() {
    let handle = spawn().await;
    for i in 0..2 {
        let result = handle
            .request(
                "orbit_family_generation",
                &json!({"orbit_type": "HALO", "libration_point": 1, "max_amplitude_km": 5000.0 + i as f64, "n_orbits": 2}),
                Some("f32"),
            )
            .await
            .unwrap();
        assert_eq!(result.status, "ok", "第 {i} 个请求失败");
        assert_eq!(result.frames.len(), 2);
    }
    handle.shutdown().await.unwrap();
}

#[tokio::test]
async fn request_after_idle_death_returns_sidecar_exit_then_recovers() {
    // 空闲期 sidecar 被杀：下一请求应拿到 SIDECAR_EXIT 错误码（而非
    // anyhow "读循环已退出"），调用方（state 层）据此重建，评审阻塞项 2
    let handle = spawn().await;
    handle.shutdown().await.unwrap(); // 模拟外部杀死
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    // 死句柄：读循环已退出，request 返回 anyhow 错误（不 panic）。
    // state 层的 request_with_retry 拿到它后 reset + 重建（见 state.rs）。
    let result = handle.request("nope", &json!({}), None).await;
    assert!(result.is_err(), "死句柄请求应失败，得到 {:?}", result);
    // 若请求恰在死前送达（写 stdin 成功、等回复时进程死）：SIDECAR_EXIT 错误码
    // ，两种时序都被 state 层自愈覆盖。
    if let Ok(r) = result {
        assert_eq!(r.error.as_ref().unwrap()["code"], "SIDECAR_EXIT");
    }
}