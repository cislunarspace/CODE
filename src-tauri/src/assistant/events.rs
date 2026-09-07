//! ACP 事件到前端事件模型（`AssistantEventPayload`）的单一转换层。
//!
//! 所有 `session/update` 只在这里转换一次，再经 `assistant-event` 发给前端
//! （前端不再解析 OpenAI 消息 JSONL，回放与会话恢复复用同一事件流）。
//!
//! 映射表（omp 18.1.11 实测契约）：
//! - `agent_message_chunk` → `delta`；`agent_thought_chunk` → `thinking`
//! - `user_message_chunk`（session/load 回放）→ `user_message`
//! - `tool_call`（pending）：挂起审批（elicitation）关联成功 → 静默（卡片
//!   已由 tool_proposed 建立）；否则为免确认直跑 → `tool_started`
//! - `tool_call_update`：in_progress → `tool_started`；completed →
//!   `tool_done(ok=true)`；failed → `tool_done(ok=false)`；摘要从 content
//!   文本里解析 e2m2e 信封（status/record_id/family_id/scenario_file/error）
//! - 工具审批走 omp 的 `elicitation/create`（"Allow tool" 表单）：解析出
//!   工具与参数 → `tool_proposed`，用户确认/拒绝经 oneshot 决定回
//!   Approve/Deny；`session/request_permission` 若出现走同一 pending 决定，
//!   回 selected allow_once/reject_once
//! - 其余 update（plan/usage_update/session_info_update/
//!   available_commands_update/config_option_update/…）与本层无关：记调试
//!   日志后忽略（由调用方过滤），不进前端

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};

/// 工具卡片摘要（与前端 ToolCardData.summary 契约一致）。
fn card_summary(envelope_text: &str) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(envelope_text) else {
        return json!({"status": "unknown"});
    };
    let status = v.get("status").cloned().unwrap_or(json!("unknown"));
    let data = v.get("data").cloned().unwrap_or(Value::Null);
    let mut out = json!({ "status": status });
    for (key, field) in [
        ("recordId", data.get("record_id")),
        ("familyId", data.get("family_id")),
        ("scenarioFile", data.get("scenario_file")),
        ("error", v.get("error")),
    ] {
        if let Some(x) = field.filter(|x| !x.is_null()) {
            out[key] = x.clone();
        }
    }
    out
}

/// omp 审批配置里免确认（allow）的只读工具白名单（原 READ_ONLY_TOOLS，
/// ADR 0022 决策 4）：经桥接服务器（名 tod）暴露给 omp 后的 xd 工具名。
pub const BRIDGE_SERVER_NAME: &str = "tod";

/// 只读免确认工具（桥接层原样转发的名字，无数字不受 omp 改名影响）。
pub const READ_ONLY_TOOLS: &[&str] = &["catalog_query", "catalog_get", "scenario_list"];

/// omp 对 MCP 工具名的消毒规则（实测：数字→下划线，如 e2m2e→e_m_e）。
/// 桥接工具名里凡有数字都会被改写；白名单恰好不含数字，原样可用。
pub fn mcp_tool_name(tool: &str) -> String {
    format!("mcp__{BRIDGE_SERVER_NAME}_{tool}")
}

/// 一次挂起的审批（elicitation 或 request_permission）。卡片参数在
/// tool_proposed 事件里已外发，这里只留应答所需状态。
pub struct PendingApproval {
    /// omp 侧工具标识（xd 设备路径，如 `xd://mcp__tod_catalog_query`）；
    /// tool_call 到达时按它关联。
    pub path: String,
    /// 是否按 request_permission 语义应答（否则 elicitation 语义）。
    permission_style: bool,
}

/// 事件发射器（mod.rs 注入 AppHandle 包装；测试注入收集器）。
pub type EventSink = Arc<dyn Fn(&Value) + Send + Sync>;

/// ACP update → 前端事件的转换器（有跨事件状态：审批↔工具调用的关联）。
pub struct UpdateConverter {
    sink: EventSink,
    /// elicitation 请求 id（字符串化）→ 挂起审批。
    pending: parking_lot::Mutex<HashMap<String, Arc<PendingApproval>>>,
    /// omp toolCallId → 审批键（elicitation 请求 id），用于把后续
    /// tool_call_update 路由回已建立的卡片。
    call_links: parking_lot::Mutex<HashMap<String, String>>,
    /// omp toolCallId → 展示工具名（tool_call 记录，tool_call_update 里
    /// 名字不再出现，终态事件需回填供前端产物登记）。
    tool_names: parking_lot::Mutex<HashMap<String, String>>,
}

impl UpdateConverter {
    pub fn new(sink: EventSink) -> Self {
        Self {
            sink,
            pending: parking_lot::Mutex::new(HashMap::new()),
            call_links: parking_lot::Mutex::new(HashMap::new()),
            tool_names: parking_lot::Mutex::new(HashMap::new()),
        }
    }

    /// 是否存在未决审批（会话结构操作的 busy 门禁依据之一）。
    pub fn has_pending(&self) -> bool {
        !self.pending.lock().is_empty()
    }

    /// 取一次挂起审批的副本并移除（确认/拒绝/取消时调用）。
    pub fn take_pending(&self, key: &str) -> Option<Arc<PendingApproval>> {
        self.pending.lock().remove(key)
    }

    /// 处理服务端 → 客户端请求（elicitation/create 或
    /// session/request_permission）。返回 true 表示已识别为审批请求。
    pub fn on_request(&self, method: &str, params: &Value) -> bool {
        match method {
            "elicitation/create" => self.on_elicitation(params),
            "session/request_permission" => self.on_permission(params),
            _ => false,
        }
    }

    /// omp 的审批表单：message 形如
    /// `Allow tool: write\nPath: xd://mcp__tod_catalog_query\nContent: {...}`。
    fn on_elicitation(&self, params: &Value) -> bool {
        let Some(id) = params.get("id") else { return false };
        let key = id.to_string();
        let message = params
            .get("params")
            .and_then(|p| p.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let Some((path, args)) = parse_allow_message(message) else {
            return false;
        };
        let tool = display_tool_name(&path);
        let call_id = key.clone();
        self.pending.lock().insert(
            key.clone(),
            Arc::new(PendingApproval { path, permission_style: false }),
        );
        (self.sink)(&json!({"kind": "tool_proposed", "callId": call_id, "tool": tool, "arguments": args}));
        true
    }

    /// ACP 标准 permission 请求（omp 18.1.11 的 MCP 工具走 elicitation，
    /// 此路径为协议完备性实现）。
    fn on_permission(&self, params: &Value) -> bool {
        let Some(id) = params.get("id") else { return false };
        let key = id.to_string();
        let p = params.get("params").cloned().unwrap_or(Value::Null);
        let call = p.get("toolCall").cloned().unwrap_or(Value::Null);
        let tool = call
            .get("toolName")
            .and_then(Value::as_str)
            .or_else(|| call.get("title").and_then(Value::as_str))
            .unwrap_or("tool")
            .to_string();
        let args = call.get("rawInput").cloned().unwrap_or(Value::Null);
        self.pending.lock().insert(
            key.clone(),
            Arc::new(PendingApproval {
                path: String::new(),
                permission_style: true,
            }),
        );
        (self.sink)(&json!({"kind": "tool_proposed", "callId": key, "tool": tool, "arguments": args}));
        true
    }

    /// 用户决定落地：回给 omp 的响应体。None = 没有该键的挂起审批。
    pub fn decision_response(&self, key: &str, approved: bool) -> Option<Value> {
        let pending = self.take_pending(key)?;
        Some(if pending.permission_style {
            let option = if approved { "allow_once" } else { "reject_once" };
            json!({"outcome": {"outcome": "selected", "optionId": option}})
        } else if approved {
            json!({"action": "accept", "content": {"value": "Approve"}})
        } else {
            json!({"action": "accept", "content": {"value": "Deny"}})
        })
    }

    /// 处理一条 `session/update` 的 update 载荷。
    pub fn on_update(&self, update: &Value) {
        let kind = update.get("sessionUpdate").and_then(Value::as_str).unwrap_or("");
        match kind {
            "agent_message_chunk" => {
                let text = chunk_text(update);
                if !text.is_empty() {
                    (self.sink)(&json!({"kind": "delta", "text": text}));
                }
            }
            "agent_thought_chunk" => {
                let text = chunk_text(update);
                if !text.is_empty() {
                    (self.sink)(&json!({"kind": "thinking", "text": text}));
                }
            }
            "user_message_chunk" => {
                let text = chunk_text(update);
                if !text.is_empty() {
                    // omp 回放的是 prompt 全文（含领域指令与画布选择信封），
                    // 剥出用户可见消息再进气泡（build_prompt_text 的逆）
                    let visible = super::user_visible_message(&text).to_string();
                    (self.sink)(&json!({"kind": "user_message", "text": visible}));
                }
            }
            "tool_call" => self.on_tool_call(update),
            "tool_call_update" => self.on_tool_call_update(update),
            // plan/usage_update/session_info_update/available_commands_update/
            // config_option_update 及未知：与本层无关，静默忽略（mod.rs 记调试日志）
            _ => {}
        }
    }

    fn on_tool_call(&self, update: &Value) {
        let Some(call_id) = update.get("toolCallId").and_then(Value::as_str) else { return };
        let raw_input = update.get("rawInput").cloned().unwrap_or(Value::Null);
        let path = raw_input.get("path").and_then(Value::as_str).unwrap_or("");
        let args = tool_args(&raw_input);
        let tool = display_tool_name(path);
        // 工具名在此记录一次：后续 tool_call_update 不再携带，终态事件回填
        self.tool_names
            .lock()
            .insert(call_id.to_string(), tool.clone());
        // 与挂起审批按 xd 设备路径关联（同一工具调用的审批先于 tool_call 到达）
        if let Some((key, _)) = self
            .pending
            .lock()
            .iter()
            .find(|(_, p)| !p.path.is_empty() && p.path == path)
            .map(|(k, v)| (k.clone(), v.clone()))
        {
            self.call_links.lock().insert(call_id.to_string(), key);
            // 卡片已由 tool_proposed 建立；参数以 tool_call 的 rawInput 为准再补一次
            (self.sink)(&json!({
                "kind": "tool_proposed", "callId": linked_id(self, call_id), "tool": tool, "arguments": args
            }));
            return;
        }
        // 免确认直跑：直接进入 running
        (self.sink)(&json!({"kind": "tool_started", "callId": call_id, "tool": tool, "arguments": args}));
    }

    fn on_tool_call_update(&self, update: &Value) {
        let Some(call_id) = update.get("toolCallId").and_then(Value::as_str) else { return };
        let status = update.get("status").and_then(Value::as_str).unwrap_or("");
        let card_id = linked_id(self, call_id);
        // 终态/进度事件里 omp 不再带工具名：按 call_id 回填（产物登记与
        // 卡片兜底需要；查不到为空串，前端保留卡片上已有的名字）
        let tool = self
            .tool_names
            .lock()
            .get(call_id)
            .cloned()
            .unwrap_or_default();
        match status {
            "in_progress" | "pending" => {
                (self.sink)(&json!({"kind": "tool_started", "callId": card_id, "tool": tool, "arguments": null}));
            }
            "completed" => {
                let summary = update_summary(update);
                (self.sink)(&json!({"kind": "tool_done", "callId": card_id, "tool": tool, "ok": true, "summary": summary}));
            }
            "failed" => {
                let summary = update_summary(update);
                (self.sink)(&json!({"kind": "tool_done", "callId": card_id, "tool": tool, "ok": false, "summary": summary}));
            }
            _ => {}
        }
    }

    /// 回放/重连清理：丢弃全部挂起审批与关联（挂起的 tool_proposed 卡片由
    /// 前端 reset 重建，不残留）。
    pub fn clear(&self) {
        self.pending.lock().clear();
        self.call_links.lock().clear();
        self.tool_names.lock().clear();
    }
}

/// tool_call_update 里 tool 名未知（in_progress 分支）：前端按 callId 更新
/// 已有卡片，tool 空串表示不覆盖卡片上的名字。
fn linked_id(conv: &UpdateConverter, call_id: &str) -> String {
    conv.call_links
        .lock()
        .get(call_id)
        .cloned()
        .unwrap_or_else(|| call_id.to_string())
}

fn chunk_text(update: &Value) -> String {
    update
        .get("content")
        .and_then(|c| c.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// rawInput → 工具参数：xd 设备写形态 {path, content(json 文本)}。
fn tool_args(raw_input: &Value) -> Value {
    match raw_input.get("content").and_then(Value::as_str) {
        Some(text) => serde_json::from_str(text).unwrap_or(Value::Null),
        None => raw_input.clone(),
    }
}

/// 解析 omp 审批消息：返回 (xd 设备路径, 参数 JSON)。非审批表单返回 None。
fn parse_allow_message(message: &str) -> Option<(String, Value)> {
    let mut path = None;
    let mut args = Value::Null;
    for line in message.lines() {
        if let Some(rest) = line.strip_prefix("Path: ") {
            path = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("Content:") {
            let text = rest.trim();
            args = if text.is_empty() {
                Value::Null
            } else {
                serde_json::from_str(text).unwrap_or(Value::Null)
            };
        }
    }
    path.map(|p| (p, args))
}

/// xd 设备路径 → 展示工具名：桥接工具还原原名（mcp__tod_catalog_query →
/// catalog_query），其余取设备名尾段（read/write/…）。
fn display_tool_name(path: &str) -> String {
    let Some(rest) = path.strip_prefix("xd://mcp__") else {
        return path.trim_start_matches("xd://").to_string();
    };
    match rest.strip_prefix(&format!("{BRIDGE_SERVER_NAME}_")) {
        Some(tool) => tool.to_string(),
        None => rest.to_string(),
    }
}

/// tool_call_update → 卡片摘要：先试 update.content（嵌套 {type:"content",
/// content:{type:"text", text}}），再试 rawOutput.content（直接 text 项）。
fn update_summary(update: &Value) -> Value {
    for text in content_texts(update.get("content")) {
        if let Some(v) = envelope_from_text(&text) {
            return v;
        }
    }
    for text in content_texts(update.get("rawOutput").and_then(|r| r.get("content"))) {
        if let Some(v) = envelope_from_text(&text) {
            return v;
        }
    }
    // 都不是信封：失败态带原文摘要，成功态不伪造
    let texts = content_texts(update.get("rawOutput").and_then(|r| r.get("content")));
    if let Some(first) = texts.first() {
        json!({"status": "info", "text": first.chars().take(200).collect::<String>()})
    } else {
        json!({"status": "unknown"})
    }
}

fn envelope_from_text(text: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(text).ok()?;
    if v.get("status").is_some() {
        Some(card_summary(text))
    } else {
        None
    }
}

/// 两种 content 形态的文本提取：桥接结果为 {type:"content", content:{type:
/// "text", text}} 嵌套；omp 自带工具为 {type:"text", text} 直排。
fn content_texts(content: Option<&Value>) -> Vec<String> {
    let Some(items) = content.and_then(Value::as_array) else { return Vec::new() };
    items
        .iter()
        .filter_map(|item| {
            if item.get("type").and_then(Value::as_str) == Some("text") {
                item.get("text").and_then(Value::as_str).map(String::from)
            } else if item.get("type").and_then(Value::as_str) == Some("content") {
                item.get("content")
                    .and_then(|c| c.get("text"))
                    .and_then(Value::as_str)
                    .map(String::from)
            } else {
                None
            }
        })
        .collect()
}

/// session/prompt 的 stopReason → 终态事件。返回 Some(payload) 表示要发。
pub fn stop_reason_payload(result: &Value) -> Option<Value> {
    let stop = result.get("stopReason").and_then(Value::as_str).unwrap_or("");
    match stop {
        "end_turn" => {
            let usage = result.get("usage").cloned().unwrap_or(Value::Null);
            let total = usage.get("totalTokens").and_then(Value::as_u64);
            Some(json!({"kind": "message_done", "usage": {"total_tokens": total}}))
        }
        "cancelled" => Some(json!({"kind": "interrupted"})),
        // refusal / max_tokens / max_context_length 等：如实报错，不静默
        other => Some(json!({"kind": "error", "message": format!("本轮对话提前结束（stopReason: {other}）")})),
    }
}

/// 用户三档思考等级 → omp thinking 配置值（off/standard/deep →
/// off/medium/high；omp 值域 off/auto/minimal/low/medium/high）。
pub fn thinking_to_omp(level: &str) -> Option<&'static str> {
    match level {
        "off" => Some("off"),
        "standard" => Some("medium"),
        "deep" => Some("high"),
        _ => None,
    }
}

/// omp thinking 当前值 → 用户三档（读取 configOptions 后回填 UI）。
pub fn omp_to_thinking(value: &str) -> Option<&'static str> {
    match value {
        "off" | "minimal" | "low" => Some("off"),
        "medium" | "auto" => Some("standard"),
        "high" | "xhigh" | "max" => Some("deep"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;

    fn collector() -> (Arc<Mutex<Vec<Value>>>, EventSink) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink: EventSink = {
            let seen = Arc::clone(&seen);
            Arc::new(move |v: &Value| seen.lock().push(v.clone()))
        };
        (seen, sink)
    }

    fn kinds(seen: &Mutex<Vec<Value>>) -> Vec<(String, String)> {
        seen.lock()
            .iter()
            .map(|v| {
                let kind = v["kind"].as_str().unwrap_or("").to_string();
                let extra = v.get("text").and_then(Value::as_str).unwrap_or("").to_string();
                (kind, extra)
            })
            .collect()
    }

    #[test]
    fn message_chunks_map_to_delta_and_thinking() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_update(&json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "你好"}}));
        conv.on_update(&json!({"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "想想"}}));
        conv.on_update(&json!({"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": "问题"}}));
        let got = kinds(&seen);
        assert_eq!(got, vec![
            ("delta".into(), "你好".into()),
            ("thinking".into(), "想想".into()),
            ("user_message".into(), "问题".into()),
        ]);
    }

    #[test]
    fn unknown_updates_are_ignored() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_update(&json!({"sessionUpdate": "usage_update", "used": 1}));
        conv.on_update(&json!({"sessionUpdate": "plan", "entries": []}));
        conv.on_update(&json!({"sessionUpdate": "future_thing", "x": 1}));
        conv.on_update(&json!({}));
        assert!(seen.lock().is_empty());
    }

    #[test]
    fn elicitation_approval_flow_builds_card_and_responds() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        let handled = conv.on_request(
            "elicitation/create",
            &json!({
                "id": 12,
                "params": {
                    "mode": "form",
                    "message": "Allow tool: write\nPath: xd://mcp__tod_cr3bp_compute\nContent: {\"mu\": 0.012}",
                    "requestedSchema": {"type": "object"}
                }
            }),
        );
        assert!(handled);
        let proposed = seen.lock()[0].clone();
        assert_eq!(proposed["kind"], "tool_proposed");
        assert_eq!(proposed["tool"], "cr3bp_compute");
        assert_eq!(proposed["callId"], "12");
        assert_eq!(proposed["arguments"]["mu"], 0.012);
        assert!(conv.has_pending());

        // 同一调用的 tool_call（pending）到达：关联 + 参数补齐，不进 running
        conv.on_update(&json!({
            "sessionUpdate": "tool_call", "toolCallId": "call_abc", "kind": "execute",
            "status": "pending", "rawInput": {"path": "xd://mcp__tod_cr3bp_compute", "content": "{\"mu\": 0.012}"}
        }));
        assert_eq!(seen.lock()[1]["kind"], "tool_proposed");
        assert_eq!(seen.lock()[1]["callId"], "12");

        // 确认 → Approve 应答体
        let resp = conv.decision_response("12", true).unwrap();
        assert_eq!(resp, json!({"action": "accept", "content": {"value": "Approve"}}));
        assert!(!conv.has_pending());

        // 后续 update 经关联路由回同一卡片 id
        conv.on_update(&json!({
            "sessionUpdate": "tool_call_update", "toolCallId": "call_abc", "status": "in_progress"
        }));
        assert_eq!(seen.lock()[2]["kind"], "tool_started");
        assert_eq!(seen.lock()[2]["callId"], "12");
    }

    #[test]
    fn elicitation_reject_responds_deny() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_request(
            "elicitation/create",
            &json!({"id": 3, "params": {"mode": "form", "message": "Allow tool: write\nPath: xd://mcp__tod_scenario_write\nContent: {\"filename\": \"a\"}"}}),
        );
        let resp = conv.decision_response("3", false).unwrap();
        assert_eq!(resp, json!({"action": "accept", "content": {"value": "Deny"}}));
        // 未知键（重复点击）无应答
        assert!(conv.decision_response("3", true).is_none());
        let _ = seen;
    }

    #[test]
    fn permission_request_maps_to_allow_once() {
        let (_seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        let handled = conv.on_request(
            "session/request_permission",
            &json!({
                "id": 9,
                "params": {
                    "sessionId": "s",
                    "toolCall": {"toolCallId": "c1", "toolName": "mcp__tod_x", "rawInput": {"a": 1}},
                    "options": [{"optionId": "allow_once", "kind": "allow_once"}]
                }
            }),
        );
        assert!(handled);
        let resp = conv.decision_response("9", true).unwrap();
        assert_eq!(resp["outcome"]["optionId"], "allow_once");
        let resp = conv.decision_response("9", false);
        assert!(resp.is_none(), "已消费");
    }

    #[test]
    fn unapproved_tool_call_starts_directly() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_update(&json!({
            "sessionUpdate": "tool_call", "toolCallId": "call_x", "kind": "read",
            "status": "pending", "rawInput": {"path": "xd://mcp__tod_catalog_query", "content": "{\"q\": 1}"}
        }));
        assert_eq!(seen.lock()[0]["kind"], "tool_started");
        assert_eq!(seen.lock()[0]["tool"], "catalog_query");
        assert_eq!(seen.lock()[0]["arguments"]["q"], 1);
    }

    #[test]
    fn completed_update_extracts_envelope_summary() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_update(&json!({
            "sessionUpdate": "tool_call_update", "toolCallId": "c9", "status": "completed",
            "content": [
                {"type": "content", "content": {"type": "text", "text": "{\"status\":\"ok\",\"data\":{\"record_id\":\"rec-7\",\"family_id\":\"fam-1\",\"scenario_file\":\"/tmp/s.json\"}}"}}
            ]
        }));
        let done = seen.lock()[0].clone();
        assert_eq!(done["kind"], "tool_done");
        assert_eq!(done["ok"], true);
        assert_eq!(done["summary"]["recordId"], "rec-7");
        assert_eq!(done["summary"]["familyId"], "fam-1");
        assert_eq!(done["summary"]["scenarioFile"], "/tmp/s.json");
    }

    #[test]
    fn failed_update_extracts_error_envelope() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_update(&json!({
            "sessionUpdate": "tool_call_update", "toolCallId": "c8", "status": "failed",
            "rawOutput": {"content": [{"type": "text", "text": "{\"status\":\"error\",\"error\":{\"message\":\"参数越界\"}}"}]}
        }));
        let done = seen.lock()[0].clone();
        assert_eq!(done["kind"], "tool_done");
        assert_eq!(done["ok"], false);
        assert_eq!(done["summary"]["error"]["message"], "参数越界");
    }

    #[test]
    fn stop_reasons_map_to_terminal_events() {
        assert_eq!(
            stop_reason_payload(&json!({"stopReason": "end_turn", "usage": {"totalTokens": 42}})),
            Some(json!({"kind": "message_done", "usage": {"total_tokens": 42}}))
        );
        assert_eq!(
            stop_reason_payload(&json!({"stopReason": "cancelled"})),
            Some(json!({"kind": "interrupted"}))
        );
        let err = stop_reason_payload(&json!({"stopReason": "refusal"})).unwrap();
        assert_eq!(err["kind"], "error");
        assert!(err["message"].as_str().unwrap().contains("refusal"));
    }

    #[test]
    fn thinking_level_mapping_is_fixed() {
        assert_eq!(thinking_to_omp("off"), Some("off"));
        assert_eq!(thinking_to_omp("standard"), Some("medium"));
        assert_eq!(thinking_to_omp("deep"), Some("high"));
        assert_eq!(thinking_to_omp("bogus"), None);
        assert_eq!(omp_to_thinking("off"), Some("off"));
        assert_eq!(omp_to_thinking("medium"), Some("standard"));
        assert_eq!(omp_to_thinking("high"), Some("deep"));
    }

    #[test]
    fn mcp_tool_names_for_whitelist_unchanged_by_sanitizer() {
        // 白名单工具名不含数字：omp 消毒不改名，配置键稳定
        for tool in READ_ONLY_TOOLS {
            assert_eq!(mcp_tool_name(tool), format!("mcp__tod_{tool}"));
            assert!(!tool.chars().any(|c| c.is_ascii_digit()));
        }
    }
}
