//! design_orbit（live）与 catalog_get（记录）双通道的真实进程集成测试。
//!
//! 背景：#476 手动测试发现"星历段只剩 1 点"。分层排查（sidecar stdio、
//! 前端解析单测、组件 mock）均绿，此测试补上从未覆盖的 Rust 段：
//! JobResult 帧解码 → artifact_from_catalog_get 映射 → 前端实际收到的
//! ArtifactData JSON 形状。
//!
//! 依赖：本仓库 uv 环境（`uv run e2m2e serve-stdio` 可用）。

use serde_json::json;
use cislunar_code_lib::cmd::artifact_from_catalog_get;
use cislunar_code_lib::sidecar::SidecarHandle;

mod common;

async fn spawn() -> SidecarHandle {
    // 未显式配置 catalog 时 e2m2e 5.9.7 让 record_id 静默为 None（ADR 0047）
    common::install_catalog_env("tod-design-eph-catalog");
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    SidecarHandle::spawn(&["uv", "run", "e2m2e", "serve-stdio"], Some(repo_root))
        .expect("拉起 sidecar 失败（uv 环境可用？）")
}

#[tokio::test]
async fn design_orbit_live_then_catalog_get_ephemeris_shape() {
    let handle = spawn().await;

    // 1) live design_orbit：30 天 Halo，验证 Rust 端收到的 ephemeris 形状
    //    （此前只在 Python 侧验证过）。
    let live = handle
        .request(
            "design_orbit",
            &json!({
                "orbit_type": "HALO", "collinear_point": 1, "amplitude": 10000.0,
                "duration": 2592000.0, "output_step": 3600.0
            }),
            None,
        )
        .await
        .expect("design_orbit 请求失败");
    assert_eq!(live.status, "ok", "错误：{:#?}", live.error);
    let syn = live.data["ephemeris"]["synodic_position"].as_array().expect("synodic_position");
    // 嵌套 (721,3)：首元素仍是数组（平铺会被前端 rows3 拒收或错切）
    assert_eq!(syn.len(), 721, "synodic_position 行数");
    assert!(
        syn[0].as_array().map(|r| r.len() == 3).unwrap_or(false),
        "synodic_position 应为 (n,3) 嵌套，首元素：{:?}",
        syn[0]
    );
    let record_id = live.data["record_id"].as_str().expect("record_id").to_string();

    // 2) catalog_get：该记录经帧通道取回，映射成前端 ArtifactData。
    let got = handle
        .request("catalog_get", &json!({"record_id": record_id}), Some("f32"))
        .await
        .expect("catalog_get 请求失败");
    assert_eq!(got.status, "ok", "错误：{:#?}", got.error);
    let artifact = artifact_from_catalog_get(record_id.clone(), got);

    // CR3BP 段：1000×6 平铺（前端 chunksOf 6000/6 → 1000 点）
    assert_eq!(artifact.family_members.len(), 1, "单条轨道记录成员数");
    assert_eq!(artifact.family_members[0].states.len(), 6000, "cr3bp/states 元素数");

    // 星历段：七键齐全、长度对齐（n=721，synodic 平铺 2163=3n）。
    let eph = artifact.ephemeris.as_ref().expect("星历段应携带");
    let n = eph.year.len();
    assert_eq!(n, 721, "UTC 分量长度");
    assert_eq!(eph.synodic_position.len(), 3 * n, "synodic_position = 3n");
    assert_eq!(eph.position_km.as_ref().map(|p| p.len()), Some(3 * n), "position_km = 3n");
    for (name, comp) in [
        ("month", &eph.month),
        ("day", &eph.day),
        ("hour", &eph.hour),
        ("minute", &eph.minute),
        ("second", &eph.second),
    ] {
        assert_eq!(comp.len(), n, "{name} 长度");
    }

    // 3) 前端实际收到的 JSON 形状：synodic_position 平铺数组（数字元素，
    //    非 1 点）。
    let js = serde_json::to_value(&artifact).unwrap();
    let sp = js["ephemeris"]["synodic_position"].as_array().unwrap();
    assert_eq!(sp.len(), 2163);
    assert!(sp[0].as_f64().is_some(), "平铺数字，首元素：{:?}", sp[0]);

    handle.shutdown().await.unwrap();
}
