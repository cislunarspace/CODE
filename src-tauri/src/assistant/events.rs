//! pi RPC 事件到前端事件模型（`AssistantEventPayload`）的单一转换层。
//!
//! 所有 pi 会话事件只在这里转换一次，再经 `assistant-event` 发给前端
//! （前端不再解析任何消息/历史格式，回放与实时流复用同一事件流）。
//!
//! 映射表（pi v1.0.0 实测契约，ADR 0032）：
//! - `message_update.assistantMessageEvent`：`text_delta.delta` → `delta`；
//!   `thinking_delta.delta` → `thinking`
//! - `message_end`（assistant）：`stopReason=="aborted"` → `interrupted`；
//!   `"error"` → `error`（errorMessage）；其余 → `message_done`
//!   （usage.totalTokens → total_tokens）
//! - `tool_execution_start{toolCallId,toolName,args}` → `tool_started`
//!   （免确认直跑与审批通过后的执行都走这里）
//! - `tool_execution_end{toolCallId,toolName,result,isError}` →
//!   `tool_done(ok=!isError)`；摘要从 result.content 文本解析 e2m2e 信封
//!   （status/record_id/family_id/scenario_file/error）
//! - `extension_error` → `error`；其余（agent_start/turn_*/queue_update/
//!   compaction_*/auto_retry_*/session_info_changed/…）与本层无关，静默忽略
//!
//! 审批（extension_ui_request 子协议，方法 select）：桥接扩展（tod-bridge.ts）
//! 在 `tool_call` 拦截里出卡——title 为 `TOD_TOOL_APPROVAL {json}` 信封
//!（toolCallId/tool/arguments），本层解析出工具与参数 → `tool_proposed`
//!（callId = pi 的 toolCallId，与后续 tool_execution_* 同键）。用户确认/拒绝
//! 由 mod.rs 回 `extension_ui_response`（value 批准/拒绝）。

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

/// 桥接 MCP 服务器名（ADR 0032；扩展 tod-bridge.ts 的 registerMcpServer 名）。
pub const BRIDGE_SERVER_NAME: &str = "tod";

/// 只读免确认工具（扩展层白名单同款：ADR 0022 决策 4，valid_ranges 为纯读
/// 查询的扩展）。Rust 侧不二次判定（白名单在扩展，fail-closed 单点），
/// 此表供文档与测试对照。
pub const READ_ONLY_TOOLS: &[&str] = &["catalog_query", "catalog_get", "scenario_list", "valid_ranges"];

/// 审批卡信封前缀（扩展 tod-bridge.ts 与本层的约定，成对维护）。
pub const APPROVAL_PREFIX: &str = "TOD_TOOL_APPROVAL ";

/// pi 对 MCP 工具的命名规则（双下划线，无 omp 时代的数字消毒）。
pub fn mcp_tool_name(tool: &str) -> String {
    format!("mcp__{BRIDGE_SERVER_NAME}__{tool}")
}

/// 工具名 → 展示名：桥接工具还原短名（mcp__tod__catalog_query →
/// catalog_query）；其余（扩展自定义工具等）原样。
pub fn display_tool_name(name: &str) -> String {
    let prefix = format!("mcp__{BRIDGE_SERVER_NAME}__");
    name.strip_prefix(&prefix).unwrap_or(name).to_string()
}

/// 事件发射器（mod.rs 注入 AppHandle 包装；测试注入收集器）。
pub type EventSink = Arc<dyn Fn(&Value) + Send + Sync>;

/// pi 会话事件 → 前端事件的转换器（无跨事件状态：工具名随事件携带，
/// 审批关联经 toolCallId 天然对齐）。
pub struct UpdateConverter {
    sink: EventSink,
}

impl UpdateConverter {
    pub fn new(sink: EventSink) -> Self {
        Self { sink }
    }

    /// 处理一条 pi 会话事件记录。
    pub fn on_event(&self, record: &Value) {
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "message_update" => self.on_message_update(record),
            "message_end" => self.on_message_end(record),
            "tool_execution_start" => self.on_tool_start(record),
            "tool_execution_end" => self.on_tool_end(record),
            "extension_error" => {
                let error = record.get("error").and_then(Value::as_str).unwrap_or("扩展错误");
                let path = record.get("extensionPath").and_then(Value::as_str).unwrap_or("");
                (self.sink)(&json!({
                    "kind": "error",
                    "message": format!("扩展错误（{path}）：{error}")
                }));
            }
            // agent_start/turn_*/queue_update/compaction_*/auto_retry_*/
            // session_info_changed/message_start 及未知：静默忽略
            _ => {}
        }
    }

    fn on_message_update(&self, record: &Value) {
        let Some(ev) = record.get("assistantMessageEvent") else { return };
        let delta = ev.get("delta").and_then(Value::as_str).unwrap_or("");
        if delta.is_empty() {
            return;
        }
        match ev.get("type").and_then(Value::as_str).unwrap_or("") {
            "text_delta" => {
                (self.sink)(&json!({"kind": "delta", "text": delta}));
            }
            "thinking_delta" => {
                (self.sink)(&json!({"kind": "thinking", "text": delta}));
            }
            _ => {}
        }
    }

    fn on_message_end(&self, record: &Value) {
        let Some(message) = record.get("message") else { return };
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            return; // user/toolResult 消息：用户气泡由 run_prompt 发布，工具走 execution 事件
        }
        let stop = message.get("stopReason").and_then(Value::as_str).unwrap_or("");
        match stop {
            "aborted" => {
                (self.sink)(&json!({"kind": "interrupted"}));
            }
            "error" => {
                let err = message
                    .get("errorMessage")
                    .and_then(Value::as_str)
                    .unwrap_or("模型调用失败");
                (self.sink)(&json!({"kind": "error", "message": err}));
            }
            // length：输出被 token 上限截断——如实报错，不当正常完成
            //（stop/toolUse 是轮内正常流转，deferred 由 pi 自行取回）
            "length" => {
                (self.sink)(&json!({"kind": "error", "message": "回复因长度上限被截断"}));
            }
            _ => {
                let total = message
                    .get("usage")
                    .and_then(|u| u.get("totalTokens"))
                    .and_then(Value::as_u64);
                (self.sink)(&json!({"kind": "message_done", "usage": {"total_tokens": total}}));
            }
        }
    }

    fn on_tool_start(&self, record: &Value) {
        let Some(call_id) = record.get("toolCallId").and_then(Value::as_str) else { return };
        let tool = record
            .get("toolName")
            .and_then(Value::as_str)
            .map(display_tool_name)
            .unwrap_or_default();
        let args = record.get("args").cloned().unwrap_or(Value::Null);
        (self.sink)(&json!({
            "kind": "tool_started", "callId": call_id, "tool": tool, "arguments": args
        }));
    }

    fn on_tool_end(&self, record: &Value) {
        let Some(call_id) = record.get("toolCallId").and_then(Value::as_str) else { return };
        let tool = record
            .get("toolName")
            .and_then(Value::as_str)
            .map(display_tool_name)
            .unwrap_or_default();
        let ok = record.get("isError") != Some(&json!(true));
        let summary = result_summary(record.get("result"), ok);
        (self.sink)(&json!({
            "kind": "tool_done", "callId": call_id, "tool": tool, "ok": ok, "summary": summary
        }));
    }

    /// 处理一条 extension_ui_request：select 且 title 带审批信封前缀时解析
    /// 出工具与参数并出卡。返回 true 表示已识别为审批请求（应挂起等用户）。
    pub fn on_approval_request(&self, req: &Value) -> Option<(String, String, Value)> {
        if req.get("method").and_then(Value::as_str) != Some("select") {
            return None; // notify/setStatus 等 fire-and-forget：忽略
        }
        let title = req.get("title").and_then(Value::as_str)?;
        let payload = title.strip_prefix(APPROVAL_PREFIX)?;
        let envelope: Value = serde_json::from_str(payload).ok()?;
        let call_id = envelope
            .get("toolCallId")
            .and_then(Value::as_str)?
            .to_string();
        let tool = envelope
            .get("tool")
            .and_then(Value::as_str)
            .map(display_tool_name)
            .unwrap_or_default();
        let arguments = envelope.get("arguments").cloned().unwrap_or(Value::Null);
        (self.sink)(&json!({
            "kind": "tool_proposed", "callId": call_id, "tool": tool, "arguments": arguments
        }));
        Some((call_id, tool, arguments))
    }

    /// 回放构建：get_messages 的消息数组 → 前端事件序列（与实时流同一
    /// 契约；经 sink 发射，mod.rs 捕获进回放缓存）。
    pub fn replay_from_messages(&self, messages: &[Value]) {
        for message in messages {
            let role = message.get("role").and_then(Value::as_str).unwrap_or("");
            match role {
                "user" => {
                    let text = message_text(message);
                    if !text.is_empty() {
                        // 存的是 prompt 全文（含领域指令与画布选择信封），
                        // 剥出用户可见消息再进气泡（build_prompt_text 的逆）
                        let visible = super::user_visible_message(&text).to_string();
                        (self.sink)(&json!({"kind": "user_message", "text": visible}));
                    }
                }
                "assistant" => {
                    self.replay_assistant(message);
                }
                "toolResult" => {
                    // 与 assistant 消息里的 ToolCall 按出现顺序天然配对
                    let ev = replay_toolresult_event(message);
                    (self.sink)(&ev);
                }
                // system/branchSummary/compactionSummary/bashExecution/custom：跳过
                _ => {}
            }
        }
    }

    fn replay_assistant(&self, message: &Value) {
        if let Some(blocks) = message.get("content").and_then(Value::as_array) {
            for block in blocks {
                match block.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text" => {
                        let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                        if !text.is_empty() {
                            (self.sink)(&json!({"kind": "delta", "text": text}));
                        }
                    }
                    "thinking" => {
                        let text = block.get("thinking").and_then(Value::as_str).unwrap_or("");
                        if !text.is_empty() {
                            (self.sink)(&json!({"kind": "thinking", "text": text}));
                        }
                    }
                    "toolCall" => {
                        let call_id = block.get("id").and_then(Value::as_str).unwrap_or("");
                        let tool = block
                            .get("name")
                            .and_then(Value::as_str)
                            .map(display_tool_name)
                            .unwrap_or_default();
                        let arguments = block.get("arguments").cloned().unwrap_or(Value::Null);
                        (self.sink)(&json!({
                            "kind": "tool_proposed", "callId": call_id, "tool": tool,
                            "arguments": arguments
                        }));
                    }
                    _ => {}
                }
            }
        }
        match message.get("stopReason").and_then(Value::as_str).unwrap_or("") {
            "aborted" => (self.sink)(&json!({"kind": "interrupted"})),
            "error" => {
                let err = message
                    .get("errorMessage")
                    .and_then(Value::as_str)
                    .unwrap_or("模型调用失败");
                (self.sink)(&json!({"kind": "error", "message": err}));
            }
            "length" => {
                (self.sink)(&json!({"kind": "error", "message": "回复因长度上限被截断"}));
            }
            _ => {
                let total = message
                    .get("usage")
                    .and_then(|u| u.get("totalTokens"))
                    .and_then(Value::as_u64);
                (self.sink)(&json!({"kind": "message_done", "usage": {"total_tokens": total}}));
            }
        }
    }
}

/// 消息文本提取：字符串直排；TextContent 数组拼接。
fn message_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                (item.get("type").and_then(Value::as_str) == Some("text"))
                    .then(|| item.get("text").and_then(Value::as_str))
                    .flatten()
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// tool_execution_end 的 result（或回放的 toolResult 消息）→ 卡片摘要：
/// content 文本解析 e2m2e 信封；都不是信封时失败态带原文摘要、成功态不伪造。
fn result_summary(result: Option<&Value>, ok: bool) -> Value {
    if let Some(text) = result.and_then(|r| r.get("content")).and_then(content_first_text) {
        if let Some(v) = envelope_from_text(&text) {
            return v;
        }
        if !ok {
            return json!({"status": "info", "text": text.chars().take(200).collect::<String>()});
        }
    }
    json!({"status": "unknown"})
}

/// 回放路径的 toolResult 消息摘要（content 直排数组）。
fn toolresult_summary(message: &Value, ok: bool) -> Value {
    result_summary(Some(message), ok)
}

/// 文本 → 卡片摘要：直接是 JSON 信封；否则找第一个 '{' 起解析。
/// 含 status 才算信封。
fn envelope_from_text(text: &str) -> Option<Value> {
    let direct: Option<Value> = serde_json::from_str(text).ok();
    let v = direct.or_else(|| {
        text.find('{')
            .and_then(|i| serde_json::from_str(&text[i..]).ok())
    })?;
    if v.get("status").is_some() {
        Some(card_summary(&serde_json::to_string(&v).unwrap_or_default()))
    } else {
        None
    }
}

/// MCP 结果 content 的首个文本块（桥接结果为 [{type:"text", text}]）。
fn content_first_text(content: &Value) -> Option<String> {
    content
        .as_array()?
        .iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .map(String::from)
}

/// 回放序列里 toolResult 消息 → tool_done 事件（与 tool_execution_end 同形）。
/// 独立函数便于 mod.rs 的回放循环配对调用。
pub fn replay_toolresult_event(message: &Value) -> Value {
    let call_id = message.get("toolCallId").and_then(Value::as_str).unwrap_or("");
    let tool = message
        .get("toolName")
        .and_then(Value::as_str)
        .map(display_tool_name)
        .unwrap_or_default();
    let ok = message.get("isError") != Some(&json!(true));
    let summary = toolresult_summary(message, ok);
    json!({
        "kind": "tool_done", "callId": call_id, "tool": tool, "ok": ok, "summary": summary
    })
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
    fn message_updates_map_to_delta_and_thinking() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_event(&json!({
            "type": "message_update", "usage": {},
            "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": "你好"}
        }));
        conv.on_event(&json!({
            "type": "message_update", "usage": {},
            "assistantMessageEvent": {"type": "thinking_delta", "contentIndex": 1, "delta": "想想"}
        }));
        // text_end（权威内容回放）与其它事件类型：忽略
        conv.on_event(&json!({
            "type": "message_update", "usage": {},
            "assistantMessageEvent": {"type": "text_end", "contentIndex": 0, "content": "你好"}
        }));
        conv.on_event(&json!({"type": "queue_update", "steering": []}));
        conv.on_event(&json!({"type": "agent_settled"}));
        let got = kinds(&seen);
        assert_eq!(
            got,
            vec![
                ("delta".into(), "你好".into()),
                ("thinking".into(), "想想".into()),
            ]
        );
    }

    #[test]
    fn assistant_message_end_maps_terminal_events() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_event(&json!({
            "type": "message_end",
            "message": {"role": "assistant", "stopReason": "stop",
                        "usage": {"totalTokens": 42}}
        }));
        conv.on_event(&json!({
            "type": "message_end",
            "message": {"role": "assistant", "stopReason": "aborted"}
        }));
        conv.on_event(&json!({
            "type": "message_end",
            "message": {"role": "assistant", "stopReason": "error", "errorMessage": "529 overloaded"}
        }));
        conv.on_event(&json!({
            "type": "message_end",
            "message": {"role": "assistant", "stopReason": "length"}
        }));
        // user 消息的 message_end：忽略（用户气泡由 run_prompt 发布）
        conv.on_event(&json!({
            "type": "message_end", "message": {"role": "user", "content": "hi"}
        }));
        let got = kinds(&seen);
        assert_eq!(got.len(), 4);
        assert_eq!(seen.lock()[0], json!({"kind": "message_done", "usage": {"total_tokens": 42}}));
        assert_eq!(seen.lock()[1]["kind"], "interrupted");
        assert_eq!(seen.lock()[2], json!({"kind": "error", "message": "529 overloaded"}));
        // length：截断如实报错，不当正常完成
        assert_eq!(
            seen.lock()[3],
            json!({"kind": "error", "message": "回复因长度上限被截断"})
        );
    }

    #[test]
    fn tool_execution_events_map_to_cards() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_event(&json!({
            "type": "tool_execution_start", "toolCallId": "call_1",
            "toolName": "mcp__tod__catalog_query", "args": {"q": 1}
        }));
        conv.on_event(&json!({
            "type": "tool_execution_end", "toolCallId": "call_1",
            "toolName": "mcp__tod__catalog_query",
            "result": {"content": [{"type": "text",
                "text": "{\"status\":\"ok\",\"data\":{\"record_id\":\"rec-7\"}}"}]},
            "isError": false
        }));
        assert_eq!(seen.lock()[0]["kind"], "tool_started");
        assert_eq!(seen.lock()[0]["tool"], "catalog_query");
        assert_eq!(seen.lock()[0]["arguments"]["q"], 1);
        let done = seen.lock()[1].clone();
        assert_eq!(done["kind"], "tool_done");
        assert_eq!(done["ok"], true);
        assert_eq!(done["summary"]["recordId"], "rec-7");
    }

    #[test]
    fn failed_tool_result_extracts_error_envelope() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_event(&json!({
            "type": "tool_execution_end", "toolCallId": "c8",
            "toolName": "mcp__tod__design_orbit",
            "result": {"content": [{"type": "text",
                "text": "{\"status\":\"error\",\"error\":{\"message\":\"参数越界\"}}"}]},
            "isError": true
        }));
        let done = seen.lock()[0].clone();
        assert_eq!(done["ok"], false);
        assert_eq!(done["summary"]["error"]["message"], "参数越界");
    }

    #[test]
    fn approval_request_parses_envelope_and_emits_card() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        let envelope = json!({
            "toolCallId": "call_9", "tool": "mcp__tod__scenario_write",
            "arguments": {"filename": "demo"}
        });
        let req = json!({
            "type": "extension_ui_request", "id": "ui-7", "method": "select",
            "title": format!("{APPROVAL_PREFIX}{envelope}"),
            "options": ["批准", "拒绝"]
        });
        let parsed = conv.on_approval_request(&req);
        let (call_id, tool, args) = parsed.expect("审批请求应可解析");
        assert_eq!(call_id, "call_9");
        assert_eq!(tool, "scenario_write");
        assert_eq!(args["filename"], "demo");
        let card = seen.lock()[0].clone();
        assert_eq!(card["kind"], "tool_proposed");
        assert_eq!(card["callId"], "call_9", "卡片 callId 必须是 toolCallId（与后续 execution 事件对齐）");
        assert_eq!(card["tool"], "scenario_write");

        // 非 select / 无前缀：忽略
        assert!(conv
            .on_approval_request(&json!({"method": "notify", "message": "x"}))
            .is_none());
        assert!(conv
            .on_approval_request(&json!({"method": "select", "title": "普通选择"}))
            .is_none());
    }

    #[test]
    fn extension_error_maps_to_error_event() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.on_event(&json!({
            "type": "extension_error", "extensionPath": "/x/tod-bridge.ts",
            "event": "tool_call", "error": "boom"
        }));
        assert_eq!(seen.lock()[0]["kind"], "error");
        assert!(seen.lock()[0]["message"].as_str().unwrap().contains("boom"));
    }

    #[test]
    fn mcp_tool_names_use_double_underscore() {
        for tool in READ_ONLY_TOOLS {
            assert_eq!(mcp_tool_name(tool), format!("mcp__tod__{tool}"));
            assert_eq!(display_tool_name(&mcp_tool_name(tool)), *tool);
        }
        // 非桥接工具原样展示
        assert_eq!(display_tool_name("bash"), "bash");
    }

    /// 回放构建：user/assistant 文本/thinking/工具配对完整折叠。
    #[test]
    fn replay_from_messages_builds_event_sequence() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        conv.replay_from_messages(&[
            json!({"role": "system", "content": ""}),
            json!({"role": "user", "content": "回放：最早的问题"}),
            json!({"role": "assistant", "content": [
                {"type": "thinking", "thinking": "想一想"},
                {"type": "text", "text": "回放：最早的回答"},
                {"type": "toolCall", "id": "call_r", "name": "mcp__tod__catalog_query",
                 "arguments": {"q": 2}}
            ], "usage": {"totalTokens": 7}, "stopReason": "stop"}),
            json!({"role": "toolResult", "toolCallId": "call_r",
                   "toolName": "mcp__tod__catalog_query",
                   "content": [{"type": "text",
                     "text": "{\"status\":\"ok\",\"data\":{\"record_id\":\"rec-replay\"}}"}],
                   "isError": false}),
            json!({"role": "branchSummary", "summary": "旧分支"}),
        ]);
        let got = kinds(&seen);
        assert_eq!(
            got,
            vec![
                ("user_message".into(), "回放：最早的问题".into()),
                ("thinking".into(), "想一想".into()),
                ("delta".into(), "回放：最早的回答".into()),
                ("tool_proposed".into(), "".into()),
                ("message_done".into(), "".into()),
                ("tool_done".into(), "".into()),
            ]
        );
        assert_eq!(seen.lock()[5]["summary"]["recordId"], "rec-replay");
        // toolResult 事件形状与实时 tool_execution_end 折出的 tool_done 同构
        let done = replay_toolresult_event(&json!({
            "role": "toolResult", "toolCallId": "call_r",
            "toolName": "mcp__tod__catalog_query",
            "content": [{"type": "text",
              "text": "{\"status\":\"ok\",\"data\":{\"record_id\":\"rec-replay\"}}"}],
            "isError": false
        }));
        assert_eq!(done["kind"], "tool_done");
        assert_eq!(done["summary"]["recordId"], "rec-replay");
        assert_eq!(done["tool"], "catalog_query");
    }
}
