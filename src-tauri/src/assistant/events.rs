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
    /// omp 侧工具标识：直接形态为 xd 设备路径（xd://mcp__tod_catalog_query），
    /// eval 包装形态（omp ≥18.1.12 的 ACP 会话）为合成路径 eval://<工具名>；
    /// tool_call 到达时按它关联。
    pub path: String,
    /// 是否按 request_permission 语义应答（否则 elicitation 语义）。
    permission_style: bool,
    /// 只读白名单工具（eval 包装下 overlay 键失效）：客户端直接批准，
    /// 不出审批卡片。仅当已成功解析出工具名时置位。
    auto: bool,
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
    /// omp 的审批表单，两种形态（omp 版本漂移实测）：
    /// 直接（≤18.1.11）：`Allow tool: write\nPath: xd://mcp__tod_catalog_query\nContent: {...}`；
    /// eval 包装（18.1.12+）：`Allow tool: eval\nLanguage: python\nCode:\nresult = await tool.catalog_query({...})`。
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
        let auto = path.starts_with("eval://")
            && READ_ONLY_TOOLS.contains(&tool.as_str())
            && eval_code_of_message(message).is_some_and(|c| is_pure_single_call(c, &tool));
        self.pending.lock().insert(
            key.clone(),
            Arc::new(PendingApproval { path, permission_style: false, auto }),
        );
        // 白名单工具不打扰用户：不出卡片，由 mod.rs 直接批准
        if !auto {
            (self.sink)(&json!({"kind": "tool_proposed", "callId": call_id, "tool": tool, "arguments": args}));
        }
        true
    }

    /// 白名单自动批准：返回 Some(true) 表示该键可立即 Approve（不入用户卡片）。
    pub fn auto_decision(&self, key: &str) -> Option<bool> {
        self.pending
            .lock()
            .get(key)
            .filter(|p| p.auto)
            .map(|_| true)
    }

    /// ACP 标准 permission 请求。eval 包装形态下 rawInput.code 里是
    /// `tool.<name>(<args>)`，同样解析真实工具并走白名单自动批准。
    fn on_permission(&self, params: &Value) -> bool {
        let Some(id) = params.get("id") else { return false };
        let key = id.to_string();
        let p = params.get("params").cloned().unwrap_or(Value::Null);
        let call = p.get("toolCall").cloned().unwrap_or(Value::Null);
        let raw = call.get("rawInput").cloned().unwrap_or(Value::Null);
        let code = raw.get("code").and_then(Value::as_str).map(str::to_string);
        let (tool, args, path) = code
            .as_deref()
            .and_then(parse_eval_tool_call)
            .map(|(name, args)| {
                // 非纯单次调用：不解析出首个调用冒充，展示原始代码
                let c = code.clone().unwrap_or_default();
                if is_pure_single_call(&c, &name) {
                    (name.clone(), args, format!("eval://{name}"))
                } else {
                    ("eval".to_string(), json!(c), "eval://".to_string())
                }
            })
            .unwrap_or_else(|| {
                (
                    call.get("toolName")
                        .and_then(Value::as_str)
                        .or_else(|| call.get("title").and_then(Value::as_str))
                        .unwrap_or("tool")
                        .to_string(),
                    raw,
                    String::new(),
                )
            });
        let auto = path.starts_with("eval://")
            && READ_ONLY_TOOLS.contains(&tool.as_str())
            && code.as_deref().is_some_and(|c| is_pure_single_call(c, &tool));
        self.pending.lock().insert(
            key.clone(),
            Arc::new(PendingApproval { path, permission_style: true, auto }),
        );
        if !auto {
            (self.sink)(&json!({"kind": "tool_proposed", "callId": key, "tool": tool, "arguments": args}));
        }
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
        // 两种形态：直接（rawInput.path = xd://…）或 eval 包装（rawInput.code
        // 里是 tool.<name>(<args>)，path 为空）。eval 形态合成路径关联审批。
        let (path, args, tool) = match raw_input.get("path").and_then(Value::as_str) {
            Some(p) if !p.is_empty() => {
                (p.to_string(), tool_args(&raw_input), display_tool_name(p))
            }
            _ => {
                let code = raw_input.get("code").and_then(Value::as_str).unwrap_or("");
                match parse_eval_tool_call(code) {
                    Some((name, args)) => (format!("eval://{name}"), args, name.clone()),
                    None => ("eval://".to_string(), json!(code), "eval".to_string()),
                }
            }
        };
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

/// omp 的审批关联：tool_call 的 call_id → 审批键。无关联（免确认直跑）
/// 时原样返回 call_id，卡片按 callId 对上。
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

/// 解析 omp 审批消息：返回 (工具路径, 参数 JSON)。非审批表单返回 None。
/// 两种形态（omp 版本漂移实测）：
/// - 直接：`Allow tool: <x>\nPath: xd://…\nContent: {json}`
/// - eval 包装：`Allow tool: eval\nLanguage: <lang>\nCode:\n… tool.<name>({json}) …`
///   → 合成路径 eval://<name>
fn parse_allow_message(message: &str) -> Option<(String, Value)> {
    if message.starts_with("Allow tool: eval\n") || message.starts_with("Allow tool: eval\r") {
        let code = message
            .split_once("\nCode:\n")
            .or_else(|| message.split_once("\nCode:"))
            .map(|(_, rest)| rest.trim_start())
            .unwrap_or("");
        return match parse_eval_tool_call(code) {
            // 非纯单次调用（夹杂其它语句）：不解析出首个调用冒充，卡片
            // 展示原始代码，让用户在完整信息下审批
            Some((name, args)) if is_pure_single_call(code, &name) => {
                Some((format!("eval://{name}"), args))
            }
            _ if !code.is_empty() => Some(("eval://".to_string(), json!(code))),
            _ => None,
        };
    }
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

/// 工具路径 → 展示名：桥接工具还原原名（mcp__tod_catalog_query →
/// catalog_query）；eval 合成路径取工具名（eval://catalog_query →
/// catalog_query，空名为 eval 本体）；其余取设备名尾段（read/write/…）。
fn display_tool_name(path: &str) -> String {
    if let Some(name) = path.strip_prefix("eval://") {
        return if name.is_empty() { "eval".to_string() } else { name.to_string() };
    }
    let Some(rest) = path.strip_prefix("xd://mcp__") else {
        return path.trim_start_matches("xd://").to_string();
    };
    match rest.strip_prefix(&format!("{BRIDGE_SERVER_NAME}_")) {
        Some(tool) => tool.to_string(),
        None => rest.to_string(),
    }
}

/// 审批消息里的 eval 代码段（Code: 之后的全文）。
fn eval_code_of_message(message: &str) -> Option<&str> {
    message
        .split_once("\nCode:\n")
        .or_else(|| message.split_once("\nCode:"))
        .map(|(_, rest)| rest.trim())
}

/// eval 代码是否就是「一次 tool.<name>(args) 调用」本身。eval 是任意代码
/// 执行，自动批准仅限纯单次调用：前缀整体只允许 空 / `await` /
/// `[const|let|var] <标识符> = [await]` 全形；后缀只允许 `;` 或一个
/// `display(result)` 收尾（分号可有可无）。夹杂任何其它语句或表达式一律人工审批。
fn is_pure_single_call(code: &str, name: &str) -> bool {
    if parse_eval_tool_call(code).is_none() {
        return false;
    }
    let Some((start, end)) = find_call_span(code, name) else { return false };
    let prefix = code[..start].trim();
    let prefix_ok = prefix.is_empty() || prefix == "await" || is_pure_decl_prefix(prefix);
    let suffix_ws: String = code[end + 1..].split_whitespace().collect();
    let suffix_ok = matches!(
        suffix_ws.as_str(),
        "" | ";" | "display(result)" | "display(result);" | ";display(result)" | ";display(result);"
    );
    prefix_ok && suffix_ok
}

/// 前缀整体形如 `const|let|var <标识符> = [await]`（不多不少）。
/// 判全形而非尾形：`fs.rm('/tmp/x'); r = await`、`const a = danger(), b =`
fn is_pure_decl_prefix(prefix: &str) -> bool {
    let p = prefix.strip_suffix("await").map(str::trim_end).unwrap_or(prefix);
    let Some(decl) = p.strip_suffix('=').map(str::trim_end) else { return false };
    let toks: Vec<&str> = decl.split_whitespace().collect();
    // 全形：`[const|let|var] <标识符>`（关键字可选，如 `result = await …`）
    let ident = match toks.as_slice() {
        [ident] => *ident,
        [kw, ident] if matches!(*kw, "const" | "let" | "var") => *ident,
        _ => return false,
    };
    !ident.is_empty()
        && ident
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// 定位 `tool.<name>(` 的调用区间（`tool.` 起点到收尾 ')' 的字节位置）。
fn find_call_span(code: &str, name: &str) -> Option<(usize, usize)> {
    let needle = format!("tool.{name}(");
    let start = code.find(&needle)?; // `tool.` 起点（前缀判定用）
    let body_start = start + needle.len();
    let body = &code[body_start..];
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escape = false;
    for (i, c) in body.char_indices() {
        if in_str {
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '(' | '{' | '[' => depth += 1,
            '}' | ']' => depth -= 1,
            ')' if depth == 0 => return Some((start, body_start + i)),
            ')' => depth -= 1,
            _ => {}
        }
    }
    None
}
/// 从 eval 代码里解析 `tool.<name>(<args-json>)`：返回 (工具名, 参数)。
fn parse_eval_tool_call(code: &str) -> Option<(String, Value)> {
    let marker = code.find("tool.")?;
    let after = &code[marker + 5..];
    let name_end = after.find('(')?;
    let name = after[..name_end].trim();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    let body = &after[name_end + 1..];
    // 找第一个深度 0 的 ')'：它是调用的收尾括号（参数 JSON 内括号已平衡）
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escape = false;
    let mut end = None;
    for (i, c) in body.char_indices() {
        if in_str {
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '(' | '{' | '[' => depth += 1,
            '}' | ']' => depth -= 1,
            ')' => {
                if depth == 0 {
                    end = Some(i);
                    break;
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    let end = end?;
    // 参数必须是 JSON 字面量：parse 失败不解析出工具（调用方回退展示原始
    // 代码；白名单自动批准也因此拒绝 fetch(...) 之类的表达式参数）
    let args: Value = serde_json::from_str(body[..end].trim()).ok()?;
    Some((name.to_string(), args))
}

/// rawInput → 工具参数：xd 设备写形态 {path, content(json 文本)}。
fn tool_args(raw_input: &Value) -> Value {
    match raw_input.get("content").and_then(Value::as_str) {
        Some(text) => serde_json::from_str(text).unwrap_or(Value::Null),
        None => raw_input.clone(),
    }
}

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

/// 文本 → 卡片摘要：直接是 JSON 信封；否则找第一个 '{' 起解析
///（eval 包装输出形如 display[1]:\n{...}）。含 status 才算信封。
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
    fn mcp_tool_names_for_whitelist_unchanged_by_sanitizer() {
        // 白名单工具名不含数字：omp 消毒不改名，配置键稳定
        for tool in READ_ONLY_TOOLS {
            assert_eq!(mcp_tool_name(tool), format!("mcp__tod_{tool}"));
            assert!(!tool.chars().any(|c| c.is_ascii_digit()));
        }
    }

    /// 自动批准仅限纯单次只读调用：夹杂其它语句的 eval 必须出卡片。
    #[test]
    fn eval_auto_approve_requires_pure_single_call() {
        // 纯调用（含赋值/display 收尾）：自动批准
        assert!(is_pure_single_call("await tool.catalog_query({})", "catalog_query"));
        assert!(is_pure_single_call(
            "const result = await tool.catalog_query({});\ndisplay(result);",
            "catalog_query"
        ));
        // 夹杂其它语句/表达式（评审坐实的绕过串）：一律人工审批
        for evil in [
            "fs.rm('/tmp/x'); r = await tool.catalog_query({})",
            "const a = danger(), b = tool.catalog_query({})",
            "console.log(await tool.scenario_write({})); r = await tool.catalog_query({})",
            "await tool.catalog_query(fetch('http://x'))",
            "await tool.catalog_query({});\nfs.rm('/tmp/x')",
            "let x = 1;\ntool.catalog_query({})",
        ] {
            assert!(!is_pure_single_call(evil, "catalog_query"), "应拒绝：{evil}");
        }
    }

    /// 非纯单次调用的 eval 审批：卡片展示原始代码（tool=eval），不以首个
    /// 解析出的调用冒充（用户须在完整信息下审批任意代码执行）。
    #[test]
    fn eval_impure_code_card_shows_raw_code() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        let msg = "Allow tool: eval\nLanguage: js\nCode:\nawait tool.scenario_write({\"filename\":\"demo\"});\nfs.rm('/tmp/x')";
        assert!(conv.on_request("elicitation/create", &json!({"id": 9, "params": {"message": msg}})));
        assert_eq!(conv.auto_decision("9"), None, "非纯调用不得自动批准");
        let cards: Vec<Value> = seen.lock().iter().filter(|v| v["kind"] == "tool_proposed").cloned().collect();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0]["tool"], "eval");
        assert!(cards[0]["arguments"].as_str().unwrap().contains("fs.rm"), "卡片应含完整代码");
    }

    /// eval 包装形态（omp ≥18.1.12）：审批消息解析出真实工具与参数。
    #[test]
    fn eval_allow_message_parses_wrapped_tool() {
        let msg = "Allow tool: eval\nLanguage: python\nCode:\nresult = await tool.scenario_write({\n    \"filename\": \"demo\",\n    \"records\": []\n})\ndisplay(result)";
        let (path, args) = parse_allow_message(msg).expect("eval 表单应可解析");
        assert_eq!(path, "eval://scenario_write");
        assert_eq!(args["filename"], "demo");
        assert_eq!(display_tool_name(&path), "scenario_write");
    }

    /// eval 解析失败兜底为 eval 本体（展示原始代码，必然审批）。
    #[test]
    fn eval_unparseable_falls_back_to_eval_itself() {
        let msg = "Allow tool: eval\nLanguage: python\nCode:\nprint(1)";
        let (path, args) = parse_allow_message(msg).expect("eval 兜底");
        assert_eq!(path, "eval://");
        assert_eq!(display_tool_name(&path), "eval");
        assert!(args.as_str().unwrap().contains("print(1)"));
    }

    /// 白名单工具经 eval 包装时标记自动批准；非白名单正常出卡片。
    #[test]
    fn eval_whitelist_tool_auto_approves() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        let params = json!({"id": 42, "params": {"message":
            "Allow tool: eval\nLanguage: python\nCode:\nresult = await tool.catalog_query({})"}});
        assert!(conv.on_request("elicitation/create", &params));
        assert_eq!(conv.auto_decision("42"), Some(true));
        assert!(seen.lock().is_empty(), "白名单自动批准不出卡片");

        let params = json!({"id": 43, "params": {"message":
            "Allow tool: eval\nLanguage: python\nCode:\nawait tool.scenario_write({\"filename\":\"demo\"})"}});
        assert!(conv.on_request("elicitation/create", &params));
        assert_eq!(conv.auto_decision("43"), None);
        let cards: Vec<Value> = seen.lock().iter().filter(|v| v["kind"] == "tool_proposed").cloned().collect();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0]["tool"], "scenario_write");
        assert_eq!(cards[0]["arguments"]["filename"], "demo");
    }

    /// eval 的 tool_call（path 为空、code 含 tool.<name>(…)）关联审批键。
    #[test]
    fn eval_tool_call_links_pending_approval() {
        let (seen, sink) = collector();
        let conv = UpdateConverter::new(sink);
        let params = json!({"id": 7, "params": {"message":
            "Allow tool: eval\nLanguage: js\nCode:\nawait tool.scenario_write({\"filename\":\"demo\"})"}});
        assert!(conv.on_request("elicitation/create", &params));
        conv.on_update(&json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "t-9",
            "status": "pending",
            "rawInput": {"language": "js", "code": "await tool.scenario_write({\"filename\":\"demo\"})"}
        }));
        let cards: Vec<Value> = seen.lock().iter().filter(|v| v["kind"] == "tool_proposed").cloned().collect();
        // 审批卡片（callId=7）+ tool_call 的补发（callId 关联回 7）
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[1]["callId"], "7");
        assert_eq!(cards[1]["tool"], "scenario_write");
    }

    /// eval 显示文本里的信封提取：display[1]:\n{…} 形态。
    #[test]
    fn envelope_extracted_from_eval_display_text() {
        let text = "display[1]:\n{\"status\":\"ok\",\"data\":{\"record_id\":\"rec-7\"}}";
        let v = envelope_from_text(text).expect("应提取信封");
        assert_eq!(v["recordId"], "rec-7");
    }
}
