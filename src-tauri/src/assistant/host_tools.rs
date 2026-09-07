//! 助手宿主内置工具（ADR 0027）：工具来源 = e2m2e MCP + 本地实现。
//!
//! tod-scenario 是本仓前端契约（前端 scenario 模块为权威），e2m2e 不认识
//! 它、且「应用」是前端画布状态操作——宿主内置让契约留在本仓、闭环不分
//! 居两仓。两个工具，均以 MCP 信封形状返回（`{status, data}` /
//! `{status: "error", error}`），对 LLM 与工具卡片与 MCP 工具无差别：
//! - `scenario_write`（走确认链）：结构化参数按 v1 规则序列化（缺省字段
//!   补默认值）写固定目录 `%APPDATA%/transfer-orbit-design/scenarios/`，
//!   同名直接覆盖；文件名做路径逃逸校验。
//! - `scenario_list`（只读白名单）：列固定目录情景文件并返回原文
//!   （情景文件是 KB 级整块 JSON，全文直接进上下文）。

use serde_json::{json, Value};
use std::path::PathBuf;

/// 用户配置目录（原 store.rs 的 config_dir；store 删除后由宿主工具自持，
/// 与 Python 侧 user_config_dir() 同路径）。取不到 HOME/APPDATA 时返回
/// None——调用方按"无持久化"降级。
pub fn config_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    base.map(|b| b.join("transfer-orbit-design"))
}

/// 情景固定目录：与配置目录同级下的 scenarios/。
pub fn scenarios_dir() -> Option<PathBuf> {
    config_dir().map(|d| d.join("scenarios"))
}

/// 宿主工具保留前缀（ADR 0027）：拦截分发的判据，冲突命名权归宿主。
pub const HOST_TOOL_PREFIX: &str = "scenario_";
pub fn is_host_tool(name: &str) -> bool {
    name.starts_with(HOST_TOOL_PREFIX)
}

/// 两个宿主工具的 OpenAI function 定义（与 MCP 工具同格式注入清单）。
pub fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "scenario_write",
                "description": "生成/修改情景文件（tod-scenario v1：固定层记录集 + 参考历元 + 播放配置）。records 是 catalog record_id 列表；参考历元给 et 秒或 UTC 字符串二选一；playback 缺省字段按默认值补齐。同名文件直接覆盖；修改已有情景先用 scenario_list 读原文再整体重写。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filename": {"type": "string", "description": "情景文件名（不含扩展名，宿主自动补 .json）"},
                        "records": {"type": "array", "items": {"type": "string"}, "description": "固定层记录引用（catalog record_id）列表"},
                        "reference_epoch": {
                            "type": "object",
                            "properties": {
                                "et": {"type": "number", "description": "参考历元（J2000 起算 et 秒）"},
                                "utc": {"type": "string", "description": "参考历元（ISO UTC 字符串）"}
                            },
                            "additionalProperties": false
                        },
                        "playback": {
                            "type": "object",
                            "properties": {
                                "rate": {"type": "number", "description": "播放速率（物理秒/真实秒），默认 86400"},
                                "loop": {"type": "boolean", "description": "循环播放，默认 true"},
                                "start_offset_et": {"type": "number", "description": "播放起点相对参考历元偏移（et 秒），默认 0"}
                            },
                            "additionalProperties": false
                        }
                    },
                    "required": ["filename", "records", "reference_epoch"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "scenario_list",
                "description": "列出情景目录中的全部情景文件，返回文件名与文件原文（tod-scenario v1 JSON）。修改情景前先用它读原文。",
                "parameters": {"type": "object", "properties": {}}
            }
        }),
    ]
}

/// 执行一个宿主工具：返回 MCP 信封形状的 JSON 文本（进 LLM 上下文与
/// 工具卡片摘要的口径与 MCP 结果一致）。
pub fn execute(name: &str, args: &Value) -> String {
    let envelope = match name {
        "scenario_write" => scenario_write(args),
        "scenario_list" => list_scenarios(),
        _ => error_envelope(format!("未知宿主工具 {name}")),
    };
    serde_json::to_string(&envelope).unwrap_or_else(|_| {
        r#"{"status":"error","error":{"message":"宿主工具结果序列化失败"}}"#.into()
    })
}

fn ok_envelope(data: Value) -> Value {
    json!({"status": "ok", "data": data})
}

fn error_envelope(message: impl std::fmt::Display) -> Value {
    json!({"status": "error", "error": {"message": message.to_string()}})
}

/// 文件名清洗：拒路径分隔符与 `..`（宿主目录封闭）；自动补 .json 后缀。
fn sanitize_filename(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("文件名不能为空".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("文件名不能含路径分隔符或 ..：{name}"));
    }
    let name = if name.to_ascii_lowercase().ends_with(".json") {
        name.to_string()
    } else {
        format!("{name}.json")
    };
    if name.len() > 120 {
        return Err("文件名过长（≤120 字符）".into());
    }
    Ok(name)
}

/// 情景正文三块（records / referenceEpoch / playback）按 v1 规则组装：
/// et 优先于 utc；playback 缺省字段补前端 scenario 模块的默认值。
/// 校验规则与前端 parseScenario 同口径（块级严格、字段级宽容），坏输入
/// 明确报错不静默。
fn scenario_write(args: &Value) -> Value {
    let Some(obj) = args.as_object() else {
        return error_envelope("工具参数必须是 JSON 对象");
    };
    let Some(filename) = obj.get("filename").and_then(Value::as_str) else {
        return error_envelope("缺少 filename（情景文件名，不含扩展名）");
    };
    let filename = match sanitize_filename(filename) {
        Ok(f) => f,
        Err(reason) => return error_envelope(reason),
    };
    let Some(records) = obj.get("records").and_then(Value::as_array) else {
        return error_envelope("缺少 records（记录 id 字符串数组）");
    };
    if !records.iter().all(|r| r.is_string()) {
        return error_envelope("records 应为记录 id 字符串数组");
    }
    let epoch = match obj.get("reference_epoch") {
        Some(e) if e.get("et").and_then(Value::as_f64).is_some_and(f64::is_finite) => {
            json!({"et": e["et"].as_f64()})
        }
        Some(e) if e.get("utc").and_then(Value::as_str).is_some_and(|s| !s.is_empty()) => {
            json!({"utc": e["utc"].as_str()})
        }
        _ => return error_envelope("reference_epoch 需要 et（秒）或 utc（ISO 字符串）二选一"),
    };
    let playback_in = obj.get("playback").unwrap_or(&Value::Null);
    let pget = |k: &str| playback_in.get(k).cloned().unwrap_or(Value::Null);
    let rate = match pget("rate") {
        Value::Null => 86400.0,
        v => match v.as_f64() {
            Some(r) if r.is_finite() && r > 0.0 => r,
            _ => return error_envelope("播放速率 rate 应为正数（物理秒/真实秒）"),
        },
    };
    let r#loop = match pget("loop") {
        Value::Null => true,
        Value::Bool(b) => b,
        _ => return error_envelope("循环开关 loop 应为布尔值"),
    };
    let start_offset = match pget("start_offset_et") {
        Value::Null => 0.0,
        v => match v.as_f64() {
            Some(r) if r.is_finite() => r,
            _ => return error_envelope("播放起点偏移 start_offset_et 应为有限数（et 秒）"),
        },
    };

    let body = json!({
        "format": "tod-scenario",
        "version": 1,
        "records": records,
        "referenceEpoch": epoch,
        "playback": {"rate": rate, "loop": r#loop, "startOffsetEt": start_offset},
    });
    let Some(dir) = scenarios_dir() else {
        return error_envelope("用户配置目录不可用（无法定位情景目录）");
    };
    let path = dir.join(&filename);
    let content = serde_json::to_string_pretty(&body).unwrap_or_default();
    if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&path, content.as_bytes())) {
        return error_envelope(format!("情景文件写入失败：{e}"));
    }
    ok_envelope(json!({
        "scenario_file": path.to_string_lossy(),
        "filename": filename,
        "records": records.len(),
        "record_id": null,
    }))
}

/// 列情景目录：文件名升序；返回每个文件的原文（KB 级整块 JSON 直接
/// 全文给上下文）。目录缺失或为空返回空列表，不报错。
fn list_scenarios() -> Value {
    let Some(dir) = scenarios_dir() else {
        return error_envelope("用户配置目录不可用（无法定位情景目录）");
    };
    let mut names: Vec<String> = match std::fs::read_dir(&dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .collect(),
        Err(_) => vec![],
    };
    names.sort();
    let scenarios: Vec<Value> = names
        .iter()
        .map(|name| {
            let content = std::fs::read_to_string(dir.join(name))
                .unwrap_or_else(|e| format!("（读取失败：{e}）"));
            json!({"name": name, "content": content})
        })
        .collect();
    ok_envelope(json!({"scenarios": scenarios, "count": scenarios.len()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 环境变量是进程全局的：本模块测试串行（cargo 默认并行线程内互斥）。
    /// Environment variables are process-global: these tests serialize (a
    /// mutex against cargo's default parallel test threads).
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// 测试目录隔离：scenario 工具写固定目录，测试经 scenarios_dir 的
    /// APPDATA 依赖注入到临时目录（Windows APPDATA / 其他 XDG_CONFIG_HOME）。
    /// scenario tools write the fixed dir; tests redirect it via the APPDATA /
    /// XDG_CONFIG_HOME environment into a temp directory.
    struct TempDirGuard(std::path::PathBuf, std::ffi::OsString, Option<std::sync::MutexGuard<'static, ()>>);
    impl TempDirGuard {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("tod-host-tools-{tag}"));
            let _ = std::fs::remove_dir_all(&dir);
            let key = if cfg!(windows) { "APPDATA" } else { "XDG_CONFIG_HOME" };
            let guard = TempDirGuard(dir.clone(), std::env::var_os(key).unwrap_or_default(), Some(ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())));
            if cfg!(windows) {
                // Windows：APPDATA 指向 dir 本身（config_dir 直接 join）
                // Windows: APPDATA points at dir itself (config_dir joins directly).
                std::env::set_var(key, &dir);
            } else {
                std::fs::create_dir_all(&dir).unwrap();
                std::env::set_var(key, &dir);
            }
            guard
        }
    }
    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let key = if cfg!(windows) { "APPDATA" } else { "XDG_CONFIG_HOME" };
            std::env::set_var(key, &self.1);
            let _ = std::fs::remove_dir_all(&self.0);
            self.2.take();
        }
    }

    fn parse_envelope(text: &str) -> Value {
        serde_json::from_str(text).expect("信封应为合法 JSON")
    }

    #[test]
    fn write_then_list_roundtrip_with_defaults() {
        let _g = TempDirGuard::new("roundtrip");
        let out = parse_envelope(&execute(
            "scenario_write",
            &json!({"filename": "nrho-set", "records": ["r1", "r2"], "reference_epoch": {"et": 1.2e9}}),
        ));
        assert_eq!(out["status"], "ok");
        // 缺省 playback 补默认值（86400/true/0）
        let path = std::path::PathBuf::from(out["data"]["scenario_file"].as_str().unwrap());
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["format"], "tod-scenario");
        assert_eq!(written["version"], 1);
        assert_eq!(written["records"], json!(["r1", "r2"]));
        assert_eq!(written["referenceEpoch"], json!({"et": 1.2e9}));
        assert_eq!(written["playback"], json!({"rate": 86400.0, "loop": true, "startOffsetEt": 0.0}));

        let listed = parse_envelope(&execute("scenario_list", &json!({})));
        assert_eq!(listed["status"], "ok");
        assert_eq!(listed["data"]["count"], 1);
        assert_eq!(listed["data"]["scenarios"][0]["name"], "nrho-set.json");
        let content: Value =
            serde_json::from_str(listed["data"]["scenarios"][0]["content"].as_str().unwrap()).unwrap();
        assert_eq!(content["records"], json!(["r1", "r2"]));
    }

    #[test]
    fn write_utc_epoch_and_partial_playback() {
        let _g = TempDirGuard::new("utc");
        let out = parse_envelope(&execute(
            "scenario_write",
            &json!({
                "filename": "utc-scenario",
                "records": [],
                "reference_epoch": {"utc": "2026-09-01T00:00:00"},
                "playback": {"rate": 3600.0, "loop": false}
            }),
        ));
        assert_eq!(out["status"], "ok");
        let path = std::path::PathBuf::from(out["data"]["scenario_file"].as_str().unwrap());
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["referenceEpoch"], json!({"utc": "2026-09-01T00:00:00"}));
        // 只给部分 playback 字段：给定的用给定值，缺的补默认
        assert_eq!(written["playback"], json!({"rate": 3600.0, "loop": false, "startOffsetEt": 0.0}));
    }

    #[test]
    fn write_overwrites_same_name() {
        let _g = TempDirGuard::new("overwrite");
        execute("scenario_write", &json!({"filename": "s", "records": ["a"], "reference_epoch": {"et": 1.0}}));
        let out = parse_envelope(&execute(
            "scenario_write",
            &json!({"filename": "s.json", "records": ["b"], "reference_epoch": {"et": 2.0}}),
        ));
        assert_eq!(out["status"], "ok");
        let listed = parse_envelope(&execute("scenario_list", &json!({})));
        assert_eq!(listed["data"]["count"], 1);
        let content: Value = serde_json::from_str(
            listed["data"]["scenarios"][0]["content"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(content["records"], json!(["b"]));
    }

    #[test]
    fn write_rejects_path_traversal_and_bad_epochs() {
        let _g = TempDirGuard::new("reject");
        let out = parse_envelope(&execute(
            "scenario_write",
            &json!({"filename": "../escape", "records": [], "reference_epoch": {"et": 1.0}}),
        ));
        assert_eq!(out["status"], "error");
        assert!(out["error"]["message"].as_str().unwrap().contains("路径分隔符"));

        let no_epoch = parse_envelope(&execute(
            "scenario_write",
            &json!({"filename": "s", "records": [], "reference_epoch": {}}),
        ));
        assert_eq!(no_epoch["status"], "error");

        let bad_rate = parse_envelope(&execute(
            "scenario_write",
            &json!({"filename": "s", "records": [], "reference_epoch": {"et": 1.0}, "playback": {"rate": -5}}),
        ));
        assert_eq!(bad_rate["status"], "error");
    }

    #[test]
    fn unknown_host_tool_errors() {
        assert!(!is_host_tool("catalog_query"));
        assert!(is_host_tool("scenario_write"));
        let out = parse_envelope(&execute("scenario_other", &json!({})));
        assert_eq!(out["status"], "error");
    }
}
