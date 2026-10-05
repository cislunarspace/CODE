//! Tauri commands - 前端经 IPC 调用的函数。

use serde::Serialize;
use tauri::{Manager, State};

/// 星历内核状态：目录/文件清单/可用性（前端设置面板展示）。
/// 文件名单与 e2m2e kernel_dir_usable 保持一致（任一 .bsp + 任一 .tls）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EphemerisStatus {
    pub kernel_dir: Option<String>,
    pub files: Vec<String>,
    pub ephemeris_ready: bool,
    pub leapsecond_ready: bool,
    pub usable: bool,
}

const EPHEMERIS_KERNELS: [&str; 5] = ["de440.bsp", "de440s.bsp", "de435.bsp", "de438.bsp", "de430.bsp"];
const LEAPSECOND_KERNELS: [&str; 2] = ["naif0011.tls", "naif0012.tls"];

fn build_ephemeris_status(dir: Option<std::path::PathBuf>) -> EphemerisStatus {
    let Some(dir) = dir else {
        return EphemerisStatus { kernel_dir: None, files: vec![], ephemeris_ready: false, leapsecond_ready: false, usable: false };
    };
    let files: Vec<String> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| !n.starts_with('.'))
                .collect()
        })
        .unwrap_or_default();
    let ephemeris_ready = EPHEMERIS_KERNELS.iter().any(|k| files.iter().any(|f| f == k));
    let leapsecond_ready = LEAPSECOND_KERNELS.iter().any(|k| files.iter().any(|f| f == k));
    EphemerisStatus {
        kernel_dir: Some(dir.to_string_lossy().into_owned()),
        usable: ephemeris_ready && leapsecond_ready,
        files,
        ephemeris_ready,
        leapsecond_ready,
    }
}

/// 星历配置状态（自动配置：数据随 git/安装包分发，正常情况永远就绪）。
#[tauri::command]
pub async fn ephemeris_status(app: tauri::AppHandle) -> Result<EphemerisStatus, String> {
    let resource_dir = app.path().resource_dir().ok();
    let dir = if cfg!(debug_assertions) {
        crate::resolve_kernel_dir(None)
    } else {
        crate::resolve_kernel_dir(resource_dir.as_deref())
    };
    Ok(build_ephemeris_status(dir))
}

use crate::project::{ArtifactSummary, ProjectState};
use crate::state::{request_with_retry, SidecarState};

/// 进度事件名（前端 listen 用）。
pub const PROGRESS_EVENT: &str = "sidecar-progress";

/// 生成轨道族命令已随 #415 删除（族生成统一走 run_tool 通道）；FamilyMember
/// 保留——get_artifact 的 catalog_get 映射用它携带成员状态与 period/jacobi
/// 元数据。v1 族束记录的 period/jacobi 在 members 元数据表；5.9.3 成员记录
/// （一轨一记录）period 在 scalars，由映射层回退读取。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyMember {
    /// 成员状态（一维 n×6：xyz vx vy vz），前端传播整条轨迹需要完整状态。
    pub states: Vec<f32>,
    pub times: Vec<f64>,
    pub period: Option<f64>,
    /// 成员 Jacobi 常数（v1 族束 members 元数据通道，#435）；无值为 None。
    pub jacobi: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameResponse {
    pub dtype: &'static str,
    pub shape: Vec<u32>,
    pub data: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResponse {
    pub data: serde_json::Value,
    pub frames: Vec<FrameResponse>,
    pub error: Option<serde_json::Value>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactMetadata {
    pub artifact_type: String,
    pub label: String,
    #[serde(default)]
    pub orbit_type: String,
}

/// 通用工具执行通道。sidecar 负责工具分派；Rust 只做协议校验和会话产物登记。
#[tauri::command]
pub async fn run_tool(
    state: State<'_, SidecarState>,
    project: State<'_, ProjectState>,
    tool: String,
    arguments: serde_json::Value,
    binary_dtype: Option<String>,
    artifact: Option<ArtifactMetadata>,
) -> Result<ToolResponse, String> {
    let dtype = binary_dtype.as_deref().map(|v| match v {
        "f32" => Ok("f32"),
        "f64" => Ok("f64"),
        _ => Err(anyhow::anyhow!("binary_dtype 必须是 f32 或 f64")),
    }).transpose().map_err(|e: anyhow::Error| e.to_string())?;
    let result = request_with_retry(&state, &tool, arguments, dtype)
        .await.map_err(|e| e.to_string())?;
    if result.status != "ok" {
        return Ok(ToolResponse { data: result.data, frames: vec![], error: result.error });
    }
    let frames: Vec<FrameResponse> = result.frames.iter().map(|frame| match frame {
        crate::sidecar::FrameArray::F32 { shape, data } => FrameResponse {
            dtype: "f32", shape: shape.clone(), data: serde_json::json!(data),
        },
        crate::sidecar::FrameArray::F64 { shape, data } => FrameResponse {
            dtype: "f64", shape: shape.clone(), data: serde_json::json!(data),
        },
    }).collect();
    if let Some(expected) = dtype {
        let mismatch = frames.iter().any(|f| f.dtype != expected);
        if mismatch {
            return Ok(ToolResponse {
                data: serde_json::Value::Null,
                frames: vec![],
                error: Some(serde_json::json!({
                    "code": "PROTOCOL_VIOLATION",
                    "message": format!("binary_dtype={expected} 请求收到不同 dtype 帧"),
                })),
            });
        }
    }
    if let (Some(meta), Some(record_id)) = (artifact, result.data.get("record_id").and_then(|v| v.as_str())) {
        if !record_id.is_empty() {
            project.add(ArtifactSummary {
                artifact_id: String::new(), artifact_type: meta.artifact_type,
                label: meta.label, orbit_type: meta.orbit_type, source_tool: tool,
                record_id: Some(record_id.to_string()), created_at: unix_seconds_now(),
            }).await;
        }
    }
    Ok(ToolResponse { data: result.data, frames, error: None })
}

/// build_ephemeris_status：任一 .bsp + 任一 .tls 即可用；缺/空目录不可用。
#[cfg(test)]
mod ephemeris_tests {
    use super::*;

    #[test]
    fn status_detects_complete_kernel_dir() {
        let dir = std::env::temp_dir().join("tod-eph-test-complete");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("de440s.bsp"), b"x").unwrap();
        std::fs::write(dir.join("naif0012.tls"), b"x").unwrap();
        let s = build_ephemeris_status(Some(dir.clone()));
        assert!(s.ephemeris_ready && s.leapsecond_ready && s.usable);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_missing_bsp_is_not_usable() {
        let dir = std::env::temp_dir().join("tod-eph-test-missing");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("naif0012.tls"), b"x").unwrap();
        let s = build_ephemeris_status(Some(dir.clone()));
        assert!(s.leapsecond_ready && !s.ephemeris_ready && !s.usable);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_none_dir_is_not_usable() {
        let s = build_ephemeris_status(None);
        assert!(!s.usable && s.kernel_dir.is_none() && s.files.is_empty());
    }
}

fn unix_seconds_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}

/// 情景固定目录（ADR 0027）：助手 scenario_write 的落盘目录，也供手动
/// 打开情景对话框默认定位。目录可能尚不存在（首个情景写入时创建）。
#[tauri::command]
pub fn scenarios_dir() -> Option<String> {
    crate::assistant::host_tools::scenarios_dir().map(|p| p.to_string_lossy().into_owned())
}

/// 情景文件写盘（#429）：前端经 dialog 插件取路径，本命令只负责落盘
/// （路径由对话框来，不做额外校验；内容是前端序列化好的 JSON 文本）。
#[tauri::command]
pub async fn save_scenario(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入情景文件失败：{e}"))
}

/// 情景文件读取（#429）：路径来自 dialog 插件，内容交前端解析校验
/// （版本拒绝等语义在前端 scenario 模块）。
#[tauri::command]
pub async fn open_scenario(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取情景文件失败：{e}"))
}

/// save/open_scenario 的纯 io 对（可测面）：写后读回逐字节一致。
#[cfg(test)]
mod scenario_io_tests {
    use super::*;

    #[test]
    fn save_then_open_round_trips_verbatim() {
        let dir = std::env::temp_dir().join("tod-scenario-roundtrip");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.json");
        let content = "{\"format\":\"tod-scenario\",\"version\":1}";
        drive_save_open(path.to_string_lossy().into_owned(), content.into()).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 在临时 tokio runtime 上直接驱动命令体（跳过 tauri runtime），同一
    /// 函数体，避免测试里复制实现导致漂移。
    fn drive_save_open(path: String, content: String) -> Result<(), String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(async {
            save_scenario(path.clone(), content).await?;
            let read_back = open_scenario(path).await?;
            assert_eq!(read_back, "{\"format\":\"tod-scenario\",\"version\":1}");
            Ok(())
        })
    }

    #[test]
    fn open_missing_file_errors_with_path_context() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let err = rt
            .block_on(open_scenario("Z:/definitely/not/here.json".into()))
            .unwrap_err();
        assert!(err.contains("读取情景文件失败"));
    }
}

/// 记录的星历段（eph/ 前缀数组）：会合系无量纲位置 (n,3) 平铺 + UTC 时间
/// 分量（各 (n,)）。键名与 e2m2e EphemerisTable 字段一致（不加 camelCase
/// 改名，与设计响应的 ephemeris dict 同形，前端共用同一解析函数）。
#[derive(Serialize)]
pub struct EphemerisSegment {
    pub synodic_position: Vec<f32>,
    /// GCRS 惯性位置 (n,3) 平铺（eph-fig）：行数对齐才携带；旧记录缺键
    /// 或不对齐为 None（前端惯性视图降级灰显，与 transfer gcrs 段同口径）。
    pub position_km: Option<Vec<f32>>,
    pub year: Vec<f32>,
    pub month: Vec<f32>,
    pub day: Vec<f32>,
    pub hour: Vec<f32>,
    pub minute: Vec<f32>,
    pub second: Vec<f32>,
}

/// 记录的转移段（transfer/ 前缀数组，e2m2e #574/#584）：states 为会合系
/// 物理 km/km/s (n,6)、times 为 TLI 起算秒 (n,)；states_gcrs_km 为惯性段
/// （#428 第二步，缺位不落键）。行形状（每行 6 元）保留，前端与 live
/// 响应共用同一解析函数（位置 ÷DU_KM 归一）。scalars 携带 tli_epoch
/// （UTC 字符串或 JD_TDB 浮点，原样透传）与 delta_v_km_s/transfer_type。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSegment {
    pub states: Vec<Vec<f32>>,
    pub times: Vec<f32>,
    /// 惯性段 (n,6)：与 states 同行才携带（否则 None，降级口径）
    pub gcrs_states: Option<Vec<Vec<f32>>>,
    pub tli_epoch: Option<serde_json::Value>,
    pub transfer_type: Option<String>,
    pub delta_v_km_s: Option<f64>,
}

/// 项目树选中 → 画布联动：按 record_id 从 catalog 拉取产物。
///
/// 帧序 = `data.arrays` 里 None 占位键的顺序（e2m2e ADR 0035）。5.9.3 起
/// 一轨一记录：族成员记录的 CR3BP 段在顶层 `cr3bp/states`（单成员，周期
/// 成员为 (1, 6) 初态 + scalars.period）；v1 族束记录仍是
/// `cr3bp/members/NNNN/states|times` 交替（旧库数据）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactData {
    pub record_id: String,
    pub orbit_family: String,
    /// v1 族束的成员数；5.9.3 成员记录无该字段（单成员，取 0）
    pub member_count: u64,
    pub mu: Option<f64>,
    /// 每成员完整的状态与元数据（包含 (1, 6) 或 (n, 6) 的 states, period 等）
    pub family_members: Vec<FamilyMember>,
    /// 兼容旧版：每成员提取的 xyz
    pub members: Vec<Vec<f32>>,
    /// 记录级 Jacobi 常数：catalog_get 顶层 jacobi 包络 [min, max] 取首元素
    /// （单轨道/成员记录两端同值即该轨道 Jacobi，#435）；v1 族束记录为包络
    /// 下限（逐成员值在 family_members，前端成员值优先、缺值时回退本字段）；
    /// 无 CR3BP 段记录为 None。
    pub jacobi: Option<f64>,
    /// 星历段（设计/预报类产物；会合系原生直画，UTC 分量 → et）
    pub ephemeris: Option<EphemerisSegment>,
    /// 转移段（#428 第二步）：states/times/gcrs_states + scalars 元数据；
    /// 非转移记录为 None
    pub transfer: Option<TransferSegment>,
    pub error: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn get_artifact(
    state: State<'_, SidecarState>,
    record_id: String,
) -> Result<ArtifactData, String> {
    let result = request_with_retry(
        &state,
        "catalog_get",
        serde_json::json!({"record_id": record_id}),
        Some("f32"),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(artifact_from_catalog_get(record_id, result))
}

/// catalog_get 结果 → ArtifactData 的映射（纯函数，jacobi 透传等映射
/// 逻辑的可测面；get_artifact 只剩 io）。集成测试（tests/）直接调用。
pub fn artifact_from_catalog_get(record_id: String, result: crate::sidecar::JobResult) -> ArtifactData {
    if result.status != "ok" {
        return ArtifactData {
            record_id,
            orbit_family: String::new(),
            member_count: 0,
            mu: None,
            family_members: vec![],
            members: vec![],
            jacobi: None,
            ephemeris: None,
            transfer: None,
            error: result.error,
        };
    }
    // 帧序 = arrays 中 None 占位键顺序；states 键配对同序 times 键，
    // transfer/ 前缀除外（走下方转移段通道，不进族成员路径）。
    let arrays = result.data["arrays"].as_object().cloned().unwrap_or_default();
    let state_keys: Vec<&String> = arrays
        .iter()
        .filter(|(k, v)| v.is_null() && k.ends_with("/states") && !k.starts_with("transfer/"))
        .map(|(k, _)| k)
        .collect();
    let member_meta_list = result.data["members"].as_array().cloned().unwrap_or_default();
    let mu = result.data["scalars"]["mu"].as_f64();

    let mut members = Vec::with_capacity(state_keys.len());
    let mut family_members = Vec::with_capacity(state_keys.len());

    // 帧游标：frames 全序列表里找对应的 states 帧。占位键顺序即帧序，
    // 用索引直接算：states 键在全部 None 键里的位置 = 对应帧下标。
    let none_keys: Vec<&String> = arrays.iter().filter(|(_, v)| v.is_null()).map(|(k, _)| k).collect();
    for (i, key) in state_keys.iter().enumerate() {
        let idx = none_keys.iter().position(|k| **k == **key).expect("占位键必在序列");
        let frame = &result.frames[idx];
        if let crate::sidecar::FrameArray::F32 { data, .. } = frame {
            members.push(data.chunks_exact(6).flat_map(|s| [s[0], s[1], s[2]]).collect());
            let meta = member_meta_list.get(i);
            // v1 族束：period/jacobi 随 members 元数据表；5.9.3 成员记录
            // （一轨一记录）：无该表，period 在 scalars，记录级 jacobi 单点
            // 两端同值（由前端回退记录级通道，#435 口径不变）
            let scalars_period = result.data["scalars"]["period"].as_f64();
            let period = meta
                .and_then(|m| m["period"].as_f64())
                .or(scalars_period);
            family_members.push(FamilyMember {
                states: data.clone(),
                times: vec![],
                period,
                jacobi: meta.and_then(|m| m["jacobi"].as_f64()),
            });
        }
    }
    // 星历段：eph/ 前缀键（会合系位置 + UTC 分量，dtype 契约同为 f32）。
    // 七键齐全且长度对齐才携带——半截数据宁可不上（前端按无星历段处理）。
    let eph_frame = |key: &str| -> Option<Vec<f32>> {
        let idx = none_keys.iter().position(|k| k.as_str() == key)?;
        match result.frames.get(idx) {
            Some(crate::sidecar::FrameArray::F32 { data, .. }) => Some(data.clone()),
            _ => None,
        }
    };
    let ephemeris = (|| {
        let year = eph_frame("eph/year")?;
        let month = eph_frame("eph/month")?;
        let day = eph_frame("eph/day")?;
        let hour = eph_frame("eph/hour")?;
        let minute = eph_frame("eph/minute")?;
        let second = eph_frame("eph/second")?;
        let synodic_position = eph_frame("eph/synodic_position")?;
        let n = year.len();
        if n == 0
            || synodic_position.len() != 3 * n
            || month.len() != n
            || day.len() != n
            || hour.len() != n
            || minute.len() != n
            || second.len() != n
        {
            return None;
        }
        Some(EphemerisSegment {
            // GCRS 惯性位置（eph-fig）：行数对齐才携带，缺键/不对齐 → None。
            position_km: eph_frame("eph/position_km").filter(|p| p.len() == 3 * n),
            synodic_position,
            year,
            month,
            day,
            hour,
            minute,
            second,
        })
    })();
    // 转移段（#428 第二步）：states/times 行齐才上；gcrs 惯性段同行才携
    // 带（#584 之前旧记录缺键 → None，前端惯性视图降级灰显）。
    let rows6 = |flat: &[f32]| -> Vec<Vec<f32>> {
        flat.chunks_exact(6).map(<[f32]>::to_vec).collect()
    };
    let transfer = (|| {
        let states = eph_frame("transfer/states")?;
        let times = eph_frame("transfer/times")?;
        if states.is_empty() || states.len() != 6 * times.len() {
            return None;
        }
        let gcrs_states = eph_frame("transfer/states_gcrs_km")
            .filter(|g| g.len() == states.len())
            .map(|g| rows6(&g));
        let scalars = &result.data["scalars"];
        Some(TransferSegment {
            states: rows6(&states),
            times,
            gcrs_states,
            tli_epoch: scalars
                .get("tli_epoch")
                .cloned()
                .filter(|v| !v.is_null()),
            transfer_type: scalars["transfer_type"].as_str().map(String::from),
            delta_v_km_s: scalars["delta_v_km_s"].as_f64(),
        })
    })();
    ArtifactData {
        record_id: result.data["record_id"].as_str().unwrap_or("").to_string(),
        orbit_family: result.data["orbit_family"].as_str().unwrap_or("").to_string(),
        member_count: result.data["member_count"].as_u64().unwrap_or(0),
        mu,
        family_members,
        members,
        // 顶层 jacobi 是记录包络 [min, max]（catalog 分类字段）：单轨道记录
        // 两端同值，取首元素即该轨道 Jacobi；族记录此处是包络下限，前端
        // 逐成员值优先、成员缺值时回退本值（#435）
        jacobi: result.data["jacobi"].as_array()
            .and_then(|v| v.first()).and_then(|v| v.as_f64()),
        ephemeris,
        transfer,
        error: None,
    }
}

#[tauri::command]
pub async fn catalog_query(
    state: State<'_, SidecarState>,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let result = request_with_retry(&state, "catalog_query", arguments, None)
        .await
        .map_err(|e| e.to_string())?;
    if result.status != "ok" {
        return Ok(serde_json::json!({"records": [], "message": result.error
            .and_then(|e| e.get("message").cloned()).unwrap_or_default()}));
    }
    Ok(serde_json::json!({
        "records": result.data["records"].clone(),
        "message": result.data["message"].clone(),
    }))
}

/// 当前运行的打包形态（appimage/deb/rpm/msi/nsis/app；开发态未打包为 None）。
/// 值由 tauri-build 在构建期二进制补丁决定。前端据此判定应用内更新可用性：
/// updater 的清单平台键无安装格式维度，Linux 产物只有 AppImage，deb/rpm
/// 运行时按自身格式验型必败，需引导手动下载。
#[tauri::command]
pub fn bundle_type() -> Option<String> {
    tauri::utils::platform::bundle_type().map(|b| b.to_string())
}

/// 项目内 Artifact 摘要列表（项目树数据源）。
#[tauri::command]
pub async fn list_artifacts(
    state: State<'_, ProjectState>,
) -> Result<Vec<ArtifactSummary>, String> {
    Ok(state.list().await)
}

/// 从项目中移除一个 Artifact。
#[tauri::command]
pub async fn remove_artifact(
    state: State<'_, ProjectState>,
    artifact_id: String,
) -> Result<bool, String> {
    Ok(state.remove(&artifact_id).await)
}

/// 登记 AI 助手经 MCP 运行产出的产物（ADR 0022：AI 产物与手动运行语义
/// 一致，同一项目树）。run_tool 之外的登记入口——MCP
/// 链路不过 run_tool，产物 record_id 由前端从工具卡片事件带回。
#[tauri::command]
pub async fn register_artifact(
    state: State<'_, ProjectState>,
    artifact_type: String,
    label: String,
    orbit_type: Option<String>,
    source_tool: String,
    record_id: String,
) -> Result<ArtifactSummary, String> {
    if record_id.is_empty() {
        return Err("record_id 不能为空".into());
    }
    Ok(state.add(ArtifactSummary {
        artifact_id: String::new(),
        artifact_type,
        label,
        orbit_type: orbit_type.unwrap_or_default(),
        source_tool,
        record_id: Some(record_id),
        created_at: unix_seconds_now(),
    }).await)
}
/// get_artifact 的 catalog_get 映射（artifact_from_catalog_get）：帧序配对
/// 之外的元数据透传——本模块覆盖 #435 的 jacobi 双通道（族成员逐条 /
/// 单条轨道记录级）。
#[cfg(test)]
mod get_artifact_tests {
    use super::*;
    use crate::sidecar::{FrameArray, JobResult};

    fn f32_frame(shape: &[u32], data: &[f32]) -> FrameArray {
        FrameArray::F32 { shape: shape.to_vec(), data: data.to_vec() }
    }

    /// 浮点按标准容差比较（AGENTS.md Testing & QA：f32 容差 1e-6；按量值
    /// 放缩以覆盖 km 级大数，其 f32 ULP 大于绝对 1e-6）。
    fn assert_close_f32(actual: f32, expected: f32) {
        assert!(
            (actual - expected).abs() <= 1e-6 * expected.abs().max(1.0),
            "{actual} != {expected}"
        );
    }

    /// 族记录响应：两成员（states 帧 + members 元数据），成员 1 带 jacobi、
    /// 成员 2 不带；顶层 jacobi 包络 [2.9, 3.1]。
    fn family_record_result() -> JobResult {
        JobResult {
            status: "ok".into(),
            data: serde_json::json!({
                "record_id": "fam-1",
                "orbit_family": "lyapunov",
                "member_count": 2,
                "scalars": {"mu": 0.0121505856},
                "jacobi": [2.9, 3.1],
                "members": [
                    {"index": 0, "period": 2.16, "jacobi": 3.1},
                    {"index": 1, "period": 2.30}
                ],
                "arrays": {
                    "cr3bp/members/0000/states": null,
                    "cr3bp/members/0000/times": [0.0, 1.0],
                    "cr3bp/members/0001/states": null
                }
            }),
            error: None,
            frames: vec![
                f32_frame(&[1, 6], &[0.5, 0.8, 0.0, -0.8, 0.5, 0.0]),
                f32_frame(&[1, 6], &[0.6, 0.9, 0.0, -0.9, 0.6, 0.0]),
            ],
        }
    }

    #[test]
    fn family_member_jacobi_passed_through_per_member() {
        let artifact = artifact_from_catalog_get("fam-1".into(), family_record_result());
        assert_eq!(artifact.family_members.len(), 2);
        assert!(matches!(artifact.family_members[0].jacobi, Some(v) if (v - 3.1).abs() < 1e-6));
        assert_eq!(artifact.family_members[1].jacobi, None);
    }

    #[test]
    fn family_record_carries_envelope_floor_as_record_jacobi() {
        let artifact = artifact_from_catalog_get("fam-1".into(), family_record_result());
        // 顶层包络下限原样透传；族记录逐成员值优先，成员缺值时回退本值
        assert!(matches!(artifact.jacobi, Some(v) if (v - 2.9).abs() < 1e-6));
    }

    /// 成员记录响应（5.9.3 一轨一记录）：顶层 cr3bp/states（周期成员单点
    /// 初态）+ scalars.period，无 members 元数据表——period 回退 scalars。
    fn member_record_result() -> JobResult {
        JobResult {
            status: "ok".into(),
            data: serde_json::json!({
                "record_id": "mem-1",
                "orbit_family": "nrho",
                "family_id": "fam-a1",
                "member_index": 7,
                "scalars": {"mu": 0.0121505856, "period": 2.16},
                "jacobi": [3.1, 3.1],
                "members": [],
                "arrays": {
                    "cr3bp/states": null,
                    "cr3bp/times": [0.0]
                }
            }),
            error: None,
            frames: vec![f32_frame(&[1, 6], &[0.9, 0.0, 0.1, 0.0, 0.0, 0.0])],
        }
    }

    #[test]
    fn member_record_period_falls_back_to_scalars() {
        let artifact = artifact_from_catalog_get("mem-1".into(), member_record_result());
        // 单成员携带 period：前端传播器才能重建整条轨迹（缺则成员被跳过）
        assert_eq!(artifact.family_members.len(), 1);
        assert!(matches!(artifact.family_members[0].period, Some(v) if (v - 2.16).abs() < 1e-6));
        // 成员级 jacobi 无 v2 通道（回退记录级单点值，#435 口径）
        assert_eq!(artifact.family_members[0].jacobi, None);
        assert!(matches!(artifact.jacobi, Some(v) if (v - 3.1).abs() < 1e-6));
    }

    /// 设计轨道记录响应：members 空（非族），顶层 jacobi 包络单轨道两端同值。
    fn design_record_result() -> JobResult {
        JobResult {
            status: "ok".into(),
            data: serde_json::json!({
                "record_id": "design-1",
                "orbit_family": "halo",
                "member_count": 1,
                "scalars": {"mu": 0.0121505856},
                "jacobi": [3.006, 3.006],
                "members": [],
                "arrays": {
                    "cr3bp/states": null,
                    "cr3bp/times": [0.0, 1.0, 2.0]
                }
            }),
            error: None,
            frames: vec![f32_frame(
                &[3, 6],
                &[0.5, 0.8, 0.0, -0.8, 0.5, 0.0, 0.6, 0.9, 0.1, -0.9, 0.6, 0.1, 0.5, 0.8, 0.0, -0.8, 0.5, 0.0],
            )],
        }
    }

    #[test]
    fn design_orbit_record_jacobi_at_record_level() {
        let artifact = artifact_from_catalog_get("design-1".into(), design_record_result());
        assert!(matches!(artifact.jacobi, Some(v) if (v - 3.006).abs() < 1e-6));
        // 单条记录没有成员元数据表：成员级 jacobi 为 None，由记录级兜底
        assert_eq!(artifact.family_members.len(), 1);
        assert_eq!(artifact.family_members[0].jacobi, None);
    }

    #[test]
    fn record_without_jacobi_is_none() {
        let mut result = design_record_result();
        result.data["jacobi"] = serde_json::Value::Null;
        let artifact = artifact_from_catalog_get("design-1".into(), result);
        assert_eq!(artifact.jacobi, None);
    }

    /// 转移记录响应（e2m2e #574/#584）：transfer/ 段 + scalars 元数据。
    fn transfer_record_result() -> JobResult {
        JobResult {
            status: "ok".into(),
            data: serde_json::json!({
                "record_id": "tr-1",
                "orbit_family": null,
                "member_count": 0,
                "scalars": {
                    "transfer_type": "HMN",
                    "delta_v_km_s": 3.95,
                    "tli_epoch": "2026-09-01T00:00:00",
                    "state_frame": "synodic_barycentric_km"
                },
                "members": [],
                "arrays": {
                    "transfer/states": null,
                    "transfer/times": null,
                    "transfer/states_gcrs_km": null
                }
            }),
            error: None,
            frames: vec![
                // (2,6) 会合系物理 km/km/s：两行足够分辨行序
                f32_frame(&[2, 6], &[
                    -4670.9, 6578.0, 0.0, 0.0, 7.8, 0.0,
                    380000.0, 0.0, 0.0, 0.0, 0.5, 0.0,
                ]),
                f32_frame(&[2], &[0.0, 200.0]),
                f32_frame(&[2, 6], &[
                    7000.0, 0.0, 100.0, 0.0, 7.0, 1.0,
                    -384400.0, 0.0, 0.0, 0.0, 1.0, 0.0,
                ]),
            ],
        }
    }

    #[test]
    fn transfer_record_maps_to_transfer_segment_not_family_members() {
        let artifact = artifact_from_catalog_get("tr-1".into(), transfer_record_result());
        // transfer/ 段不进族成员通道（曾是误画：km 值不归一直当无量纲画）
        assert!(artifact.family_members.is_empty());
        assert!(artifact.members.is_empty());
        let seg = artifact.transfer.as_ref().expect("转移段应存在");
        assert_eq!(seg.states.len(), 2);
        let want_row0 = [-4670.9, 6578.0, 0.0, 0.0, 7.8, 0.0];
        for (g, w) in seg.states[0].iter().zip(want_row0) {
            assert_close_f32(*g, w);
        }
        assert_close_f32(seg.states[1][0], 380000.0);
        let want_times = [0.0, 200.0];
        for (g, w) in seg.times.iter().zip(want_times) {
            assert_close_f32(*g, w);
        }
        let want_gcrs1 = [-384400.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        for (g, w) in seg
            .gcrs_states
            .as_ref()
            .expect("gcrs 段应存在")[1]
            .iter()
            .zip(want_gcrs1)
        {
            assert_close_f32(*g, w);
        }
        assert_eq!(seg.transfer_type.as_deref(), Some("HMN"));
        assert!(matches!(seg.delta_v_km_s, Some(v) if (v - 3.95).abs() < 1e-6));
        assert_eq!(
            seg.tli_epoch.as_ref().and_then(|v| v.as_str()),
            Some("2026-09-01T00:00:00")
        );
    }

    #[test]
    fn transfer_record_without_gcrs_segment_degrades_to_none() {
        let mut result = transfer_record_result();
        // 旧记录（#584 之前）：states_gcrs_km 键不落
        result.data["arrays"].as_object_mut().unwrap().remove("transfer/states_gcrs_km");
        result.frames.truncate(2);
        let artifact = artifact_from_catalog_get("tr-1".into(), result);
        let seg = artifact.transfer.as_ref().expect("转移段应存在");
        assert_eq!(seg.gcrs_states, None);
        assert_eq!(seg.states.len(), 2);
    }

    #[test]
    fn transfer_states_times_mismatch_drops_segment() {
        let mut result = transfer_record_result();
        result.data["arrays"]["transfer/states_gcrs_km"] = serde_json::Value::Null;
        // times 只有 1 行：与 states 2 行不齐，整段不上（宁缺毋错）
        result.frames[1] = f32_frame(&[1], &[0.0]);
        let artifact = artifact_from_catalog_get("tr-1".into(), result);
        assert!(artifact.transfer.is_none());
    }

    /// 设计轨道记录 + 星历段（eph/ 七键 + position_km，eph-fig）；帧序与
    /// arrays 里 None 占位键序一致。
    fn ephemeris_record_result() -> JobResult {
        JobResult {
            status: "ok".into(),
            data: serde_json::json!({
                "record_id": "eph-1",
                "orbit_family": "halo",
                "member_count": 1,
                "scalars": {"mu": 0.0121505856},
                "members": [],
                "arrays": {
                    "cr3bp/states": null,
                    "cr3bp/times": [0.0, 1.0],
                    "eph/year": null,
                    "eph/month": null,
                    "eph/day": null,
                    "eph/hour": null,
                    "eph/minute": null,
                    "eph/second": null,
                    "eph/synodic_position": null,
                    "eph/position_km": null
                }
            }),
            error: None,
            frames: vec![
                f32_frame(&[2, 6], &[0.9, 0.0, 0.1, 0.0, 0.0, 0.0, 1.1, 0.0, -0.1, 0.0, 0.0, 0.0]),
                f32_frame(&[2], &[2024.0, 2024.0]),
                f32_frame(&[2], &[1.0, 1.0]),
                f32_frame(&[2], &[1.0, 1.0]),
                f32_frame(&[2], &[0.0, 1.0]),
                f32_frame(&[2], &[0.0, 0.0]),
                f32_frame(&[2], &[0.0, 0.0]),
                f32_frame(&[2, 3], &[1.1, 0.2, -0.3, 1.2, 0.3, -0.4]),
                f32_frame(&[2, 3], &[384400.0, 0.0, 0.0, 400000.0, 0.0, 0.0]),
            ],
        }
    }

    #[test]
    fn ephemeris_segment_position_km_passed_through() {
        let artifact = artifact_from_catalog_get("eph-1".into(), ephemeris_record_result());
        let eph = artifact.ephemeris.as_ref().expect("星历段应存在");
        assert_eq!(eph.synodic_position.len(), 6);
        // GCRS 惯性位置 (n,3) 平铺原样透传（eph-fig）
        assert_eq!(
            eph.position_km.as_ref().expect("惯性位置应存在"),
            &vec![384400.0f32, 0.0, 0.0, 400000.0, 0.0, 0.0]
        );
    }

    #[test]
    fn ephemeris_segment_without_position_km_degrades_to_none() {
        let mut result = ephemeris_record_result();
        // 旧记录：eph/position_km 键不落——星历段其余部分照常携带
        result.data["arrays"].as_object_mut().unwrap().remove("eph/position_km");
        result.frames.pop();
        let artifact = artifact_from_catalog_get("eph-1".into(), result);
        let eph = artifact.ephemeris.as_ref().expect("星历段应存在");
        assert_eq!(eph.position_km, None);
        assert_eq!(eph.synodic_position.len(), 6);
    }

    #[test]
    fn ephemeris_position_km_row_mismatch_carries_none() {
        let mut result = ephemeris_record_result();
        // position_km 只有 1 行：与 synodic_position 2 行不齐 → None
        *result.frames.last_mut().unwrap() = f32_frame(&[1, 3], &[384400.0, 0.0, 0.0]);
        let artifact = artifact_from_catalog_get("eph-1".into(), result);
        assert_eq!(artifact.ephemeris.as_ref().unwrap().position_km, None);
    }
}
