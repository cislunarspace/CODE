//! AI 助手会话适配器：以随应用分发的 omp 为唯一会话运行时（ACP 客户端）。
//!
//! omp 负责：模型配置与凭据（原生配置，本应用不保存 base URL/model/key）、
//! 会话上下文与持久化（session 目录 JSONL，本应用不解析改写）、模型调用、
//! 思考过程与 agent loop。本模块只保留：
//! - ACP 连接与当前 `session_id`、运行状态、待处理审批与事件路由；
//! - `session/update` → `AssistantEventPayload` 的单一转换（events.rs）；
//! - 会话生命周期：new / load（回放重建 UI）/ cancel（真中断，cancelled
//!   stop reason）/ clear（omp 无 reset 能力，落位为新建，旧会话留作历史）；
//! - 工具审批：omp 的 `elicitation/create` 表单映射为 `tool_proposed`
//!   工具卡片，用户确认/拒绝经 `assistant_confirm_tool` 回 Approve/Deny；
//!   只读工具由 omp 审批配置覆盖文件免确认（omp.rs overlay）；
//! - 思考等级三档映射：off→off、standard→medium、deep→high
//!   （`session/set_config_option`；档位不可用回退 medium 一次并显式报错）。
//!
//! 事件契约（前端 `assistant-event`）：delta/thinking/user_message/tool_*
//! /message_done/interrupted/error/reset。回放（session/load）与实时流走
//! 同一折叠路径，前端不再解析任何历史文件格式。

pub mod acp;
pub mod bridge;
pub mod events;
pub mod host_tools;
pub mod omp;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tokio::sync::oneshot;

use acp::{AcpConn, AcpHandlers, Responder};
use events::{EventSink, UpdateConverter};

/// 前端监听的事件名。
pub const ASSISTANT_EVENT: &str = "assistant-event";

/// 会话结构操作被门禁拦下时的提示。
const BUSY_MSG: &str = "有回复进行中或工具确认未决，请等待完成后再操作会话";

/// 发给 omp 的固定中文领域指令：角色边界、工具纪律、结果与引用规范
///（每轮 prompt 正文前置注入；omp 侧无应用可控的系统提示词接口）。
const DOMAIN_INSTRUCTION: &str = "你是 Transfer Orbit Design 的轨道设计助手。始终使用简体中文回答，专业名词、工具名、字段名和协议名可保留必要的英文缩写。\n你只能协助本项目的轨道库、轨道计算、轨道预报、转移设计、坐标转换、分区分析和情景管理；超出范围时明确说明，不编造结果、记录、参数或工具返回值。\n处理任务时先理解用户目标，再使用已有工具获取事实；需要查询轨道库或情景时优先查询，不凭记忆猜测记录内容。工具参数必须符合工具 schema，缺少关键参数或存在多个合理解释时先向用户说明需要补充的信息。\n只读查询用于确认事实；会改变轨道库或情景的操作必须通过工具审批后执行。工具返回错误时说明错误原因和可行的下一步，不掩盖错误，不把未完成操作说成已完成。\n涉及计算结果时给出使用的输入、关键假设、单位、适用的数据系和结果摘要；引用轨道库记录、产物或情景时优先使用真实 record_id 或 scenario_file。不要输出冗长的内部思考过程，只给出对用户有用的结论、依据和下一步。";

/// 组装发给 omp 的 prompt 正文：领域指令 → 用户消息 → 可选画布选择。
/// 选择 JSON 只进正文不进气泡事件（见 run_prompt）。
fn build_prompt_text(message: &str, selection: Option<&Value>) -> String {
    match selection {
        Some(sel) if !sel.is_null() => format!(
            "{DOMAIN_INSTRUCTION}\n\n{message}\n\n[当前画布选择]\n{}",
            serde_json::to_string(sel).unwrap_or_default()
        ),
        _ => format!("{DOMAIN_INSTRUCTION}\n\n{message}"),
    }
}

/// build_prompt_text 的逆：从 omp 回放的 prompt 全文剥出用户可见消息
///（去掉领域指令前缀与画布选择段；无信封特征时原样返回，兼容任意
/// 回放文本）。实测 omp session/load 以单个 user_message_chunk 原样
/// 回放 prompt 全文，气泡必须在此剥离。
pub(crate) fn user_visible_message(full: &str) -> &str {
    let rest = full.strip_prefix(DOMAIN_INSTRUCTION).unwrap_or(full);
    let rest = rest.strip_prefix("\n\n").unwrap_or(rest);
    match rest.find("\n\n[当前画布选择]") {
        Some(i) => &rest[..i],
        None => rest,
    }
}

/// 会话事件日志上限（条）：超出截头（久远事件不再重放，全文在 omp 会话里）。
const MAX_SESSION_LOG: usize = 5000;

/// 事件发射器（setup 时注入 AppHandle 包装；测试注入收集器）。
pub type AssistantEmitter = EventSink;
static EMITTER: std::sync::OnceLock<AssistantEmitter> = std::sync::OnceLock::new();

pub fn set_emitter(e: AssistantEmitter) {
    let _ = EMITTER.set(e);
}

fn emit(payload: Value) {
    if let Some(sink) = EMITTER.get() {
        sink(&payload);
    }
}

/// 助手状态：ACP 连接（经 OmpState）、当前 session id、运行门禁、待确认
/// 审批与回放缓存。克隆语义：Command 层持 State 引用即可，无需 Clone。
pub struct AssistantState {
    inner: Arc<Inner>,
}

struct Inner {
    omp: omp::OmpState,
    /// 当前会话 id（None = 尚未建立会话，首次发送时懒创建）。
    /// 存活于 omp 进程之外：omp 崩溃重拉后按它 session/load 续上。
    session: parking_lot::Mutex<Option<String>>,
    /// 单并发门禁：一轮 session/prompt 进行中。
    running: AtomicBool,
    /// 静默装载（重连后重开会话：转换器照常维护关联，但不外发事件）。
    quiet: AtomicBool,
    /// 用户三档思考等级（会话建立前缓存，建立/切换时应用）。
    desired_thinking: parking_lot::Mutex<String>,
    /// 会话实际生效的 omp thinking 值（configOptions currentValue）。
    actual_thinking: parking_lot::Mutex<Option<String>>,
    /// 待确认审批：审批键（服务端请求 id 字符串化）→ 用户决定通道。
    confirmations: parking_lot::Mutex<HashMap<String, oneshot::Sender<bool>>>,
    /// 会话事件日志（UI 渲染缓存）：本进程内每条已外发事件的追加记录。
    /// omp 对已打开会话的二次 session/load 不回放，切换回来时按日志重放；
    /// 首次打开的会话由 session/load 回放重建后整体写入。上限截头防膨胀。
    replay_cache: parking_lot::Mutex<HashMap<String, Vec<Value>>>,
    /// 正在捕获的回放事件（session/load 期间置位；sink 内写入）。
    replay_capture: parking_lot::Mutex<Option<Vec<Value>>>,
    /// 会话索引（session/list 按本应用 cwd 过滤）。
    sessions: parking_lot::Mutex<Vec<Value>>,
    /// 当前连接代的转换器（换进程重建，审批挂起随之作废）。
    converter: parking_lot::Mutex<UpdateConverter>,
    /// 统一事件出口：静默丢弃、回放捕获、会话日志追加、全局外发。
    /// 全部事件（转换器产物与状态机自身发布）都必须经它，日志才完整。
    /// OnceLock：构造后立刻注入（闭包持 Weak，需 Inner 先存在）。
    sink: std::sync::OnceLock<EventSink>,
}

impl AssistantState {
    pub fn new() -> Self {
        let inner = Arc::new(Inner {
            omp: omp::OmpState::new(),
            session: parking_lot::Mutex::new(None),
            running: AtomicBool::new(false),
            quiet: AtomicBool::new(false),
            desired_thinking: parking_lot::Mutex::new("standard".into()),
            actual_thinking: parking_lot::Mutex::new(None),
            confirmations: parking_lot::Mutex::new(HashMap::new()),
            replay_cache: parking_lot::Mutex::new(HashMap::new()),
            replay_capture: parking_lot::Mutex::new(None),
            sessions: parking_lot::Mutex::new(Vec::new()),
            converter: parking_lot::Mutex::new(UpdateConverter::new(Arc::new(|_| {}))),
            sink: std::sync::OnceLock::new(),
        });
        let sink = make_sink(Arc::downgrade(&inner));
        let _ = inner.sink.set(sink.clone());
        *inner.converter.lock() = UpdateConverter::new(sink);
        Self { inner }
    }

    /// 当前会话 id（历史内容由回放事件流负责，这里只有索引）。
    pub fn current_session(&self) -> Option<String> {
        self.inner.session.lock().clone()
    }

    /// 会话列表（本应用 cwd 过滤后的 session/list 结果）。
    pub fn sessions(&self) -> Vec<Value> {
        self.inner.sessions.lock().clone()
    }

    /// 是否有回复进行中或未决审批（会话结构操作门禁）。
    pub fn busy(&self) -> bool {
        self.inner.running.load(Ordering::SeqCst) || self.has_pending_confirmations()
    }

    /// 是否存在未决工具审批。
    pub fn has_pending_confirmations(&self) -> bool {
        !self.inner.confirmations.lock().is_empty()
    }

    /// 当前生效的思考等级（用户三档；会话未建立时为期望值）。
    pub fn thinking_level(&self) -> String {
        let actual = self.inner.actual_thinking.lock().clone();
        match actual.as_deref().and_then(events::omp_to_thinking) {
            Some(level) => level.to_string(),
            None => self.inner.desired_thinking.lock().clone(),
        }
    }

    /// ACP 进程是否存活（不为查询而拉起；首次使用才懒启动）。
    pub async fn connected(&self) -> bool {
        self.inner.omp.current().await.is_some()
    }

    /// omp 可执行文件是否可用（空态判定：未安装/不可执行）。以 setup
    /// 注册的命令为准（发布构建解析过资源目录），未注册再回落实时解析。
    pub fn omp_configured(&self) -> bool {
        omp::OmpState::configured_command().is_some()
    }

    /// 确认/拒绝一次工具审批。返回 false = 该键没有挂起的等待（已取消/
    /// 重复点击）。
    pub fn resolve_confirm(&self, key: &str, approved: bool) -> bool {
        match self.inner.confirmations.lock().remove(key) {
            Some(tx) => {
                let _ = tx.send(approved);
                true
            }
            None => false,
        }
    }

    /// 取活跃连接；新拉进程时静默重开当前会话（重连路径）并刷新索引。
    async fn ensure_conn(&self) -> Result<AcpConn> {
        let handlers = Arc::new(ConnHandlers(Arc::clone(&self.inner)));
        let (conn, fresh) = self.inner.omp.get_or_spawn(handlers).await?;
        if !fresh {
            return Ok(conn);
        }
        // 新连接代：审批挂起全部作废（对应工具卡片已无对端等待）
        self.inner.confirmations.lock().clear();
        let sink = self
            .inner
            .sink
            .get()
            .expect("sink 在构造时注入")
            .clone();
        *self.inner.converter.lock() = UpdateConverter::new(sink);
        let current = self.inner.session.lock().clone();
        if let Some(sid) = current {
            let was_quiet = self.inner.quiet.swap(true, Ordering::SeqCst);
            let result = conn
                .request(
                    "session/load",
                    json!({
                        "sessionId": sid,
                        "cwd": session_cwd_json(),
                        "mcpServers": [bridge::bridge_server_entry()]
                    }),
                )
                .await;
            self.inner.quiet.store(was_quiet, Ordering::SeqCst);
            result.map_err(|e| anyhow!("重连后恢复会话失败：{e}"))?;
        }
        self.refresh_sessions(&conn).await;
        Ok(conn)
    }

    /// 刷新会话索引（session/list，按本应用 cwd 过滤，传输形状对齐前端
    /// SessionMeta：id/title/updatedAt/messageCount）。
    async fn refresh_sessions(&self, conn: &AcpConn) {
        let Ok(v) = conn.request("session/list", json!({})).await else {
            return;
        };
        let wanted = omp::OmpState::session_cwd()
            .map(|c| c.to_string_lossy().into_owned())
            .unwrap_or_default();
        let list: Vec<Value> = v
            .get("sessions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|s| {
                s.get("cwd")
                    .and_then(Value::as_str)
                    .is_some_and(|c| c == wanted)
            })
            .map(|s| {
                json!({
                    "id": s.get("sessionId").cloned().unwrap_or(Value::Null),
                    "title": s.get("title").cloned().unwrap_or(Value::Null),
                    "updatedAt": s.get("updatedAt").cloned().unwrap_or(Value::Null),
                    "messageCount": s.get("_meta")
                        .and_then(|m| m.get("messageCount"))
                        .cloned()
                        .unwrap_or(Value::Null),
                })
            })
            .collect();
        *self.inner.sessions.lock() = list;
    }

    /// 发送一条用户消息并等整轮结束（增量经事件流推送）。
    /// 早期错误（omp 未安装/握手失败）经 Err 上抛；运行期错误走 error 事件。
    pub async fn send(&self, message: &str, selection: Option<Value>) -> Result<()> {
        if self.inner.running.swap(true, Ordering::SeqCst) {
            anyhow::bail!("上一轮对话仍在进行");
        }
        let result = self.run_prompt(message, selection).await;
        self.inner.running.store(false, Ordering::SeqCst);
        if let Err(e) = &result {
            self.publish(json!({"kind": "error", "message": e.to_string()}));
        }
        Ok(())
    }

    async fn run_prompt(&self, message: &str, selection: Option<Value>) -> Result<()> {
        let conn = self.ensure_conn().await?;
        // 会话懒创建：首条消息建立会话（不发 reset——用户气泡已在 UI 上）
        let current = self.inner.session.lock().clone();
        let sid = match current {
            Some(sid) => sid,
            None => {
                let sid = self
                    .create_session(&conn, false)
                    .await
                    .map_err(|e| anyhow!("创建会话失败：{e}"))?;
                *self.inner.session.lock() = Some(sid.clone());
                sid
            }
        };
        let prompt_text = build_prompt_text(message, selection.as_ref());
        // 用户气泡统一由事件流渲染（live 与回放同一路径）；选择上下文
        // 只进发给 omp 的正文，不进气泡事件
        self.publish(json!({"kind": "user_message", "text": message}));
        match conn
            .request(
                "session/prompt",
                json!({"sessionId": sid, "prompt": [{"type": "text", "text": prompt_text}]}),
            )
            .await
        {
            Ok(result) => {
                if let Some(payload) = events::stop_reason_payload(&result) {
                    self.publish(payload);
                }
                self.refresh_sessions(&conn).await;
                Ok(())
            }
            // 运行期错误（连接断开/omp 内部错误）：error 事件 + Ok 返回
            //（与旧 agent loop 的错误口径一致）
            Err(e) => {
                self.publish(json!({"kind": "error", "message": e.to_string()}));
                Ok(())
            }
        }
    }

    /// 发布一条事件（统一经 sink：静默/捕获/日志/外发语义一致）。
    fn publish(&self, payload: Value) {
        let sink = self.inner.sink.get().expect("sink 在构造时注入");
        sink(&payload);
    }

    /// 发布 reset（清 UI 标记）：reset 是重建指令而非会话内容，不进日志。
    fn publish_reset(&self) {
        if let Some(sink) = EMITTER.get() {
            sink(&json!({"kind": "reset"}));
        }
    }

    /// 请求中断当前轮（幂等）：发 session/cancel，omp 以 cancelled stop
    /// reason 结束 prompt。返回是否存在进行中轮次。
    pub async fn request_cancel(&self) -> bool {
        let running = self.inner.running.load(Ordering::SeqCst);
        if running {
            let current = self.inner.session.lock().clone();
        if let Some(sid) = current {
                // 通知是尽力而为：连接已死时下轮 ensure_conn 自愈
                if let Some(conn) = self.inner.omp.current().await {
                    let _ = conn.notify("session/cancel", json!({"sessionId": sid}));
                }
            }
        }
        running
    }

    /// 新建会话并切换过去（受门禁）。返回新会话 id。
    pub async fn new_session(&self) -> Result<String> {
        if self.busy() {
            anyhow::bail!(BUSY_MSG);
        }
        let conn = self.ensure_conn().await?;
        let sid = self
            .create_session(&conn, true)
            .await
            .map_err(|e| anyhow!("创建会话失败：{e}"))?;
        *self.inner.session.lock() = Some(sid.clone());
        self.refresh_sessions(&conn).await;
        Ok(sid)
    }

    /// create_session：session/new + 应用思考档位；emit_reset 控制 reset
    /// 事件（send 的懒创建路径不发，避免清掉刚输入的用户气泡）。
    async fn create_session(&self, conn: &AcpConn, emit_reset: bool) -> Result<String> {
        let result = conn
            .request(
                "session/new",
                json!({
                    "cwd": session_cwd_json(),
                    "mcpServers": [bridge::bridge_server_entry()]
                }),
            )
            .await?;
        let sid = result
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("session/new 响应缺少 sessionId"))?
            .to_string();
        capture_config_options(&self.inner, &result);
        self.inner.replay_cache.lock().insert(sid.clone(), Vec::new());
        self.send_thinking(conn, &sid).await;
        if emit_reset {
            self.publish_reset();
        }
        Ok(sid)
    }

    /// 切换会话：session/load 回放重建 UI；已打开过的会话走本地缓存重放。
    /// 失败时恢复原会话的显示（有缓存则重放回原状），session id 不变。
    pub async fn switch_session(&self, session_id: &str) -> Result<()> {
        if self.busy() {
            anyhow::bail!(BUSY_MSG);
        }
        let conn = self.ensure_conn().await?;
        let previous = self.inner.session.lock().clone();
        self.publish_reset();
        let cached = self.inner.replay_cache.lock().get(session_id).cloned();
        if let Some(log) = cached {
            self.replay_cached(session_id, &log);
            self.refresh_sessions(&conn).await;
            return Ok(());
        }
        // 首次打开：捕获回放事件流并缓存
        *self.inner.replay_capture.lock() = Some(Vec::new());
        let result = conn
            .request(
                "session/load",
                json!({
                    "sessionId": session_id,
                    "cwd": session_cwd_json(),
                    "mcpServers": [bridge::bridge_server_entry()]
                }),
            )
            .await;
        let captured = self.inner.replay_capture.lock().take();
        match result {
            Ok(v) => {
                capture_config_options(&self.inner, &v);
                let log = captured.unwrap_or_default();
                self.inner.replay_cache.lock().insert(session_id.to_string(), log);
                *self.inner.session.lock() = Some(session_id.to_string());
                self.refresh_sessions(&conn).await;
                Ok(())
            }
            Err(e) => {
                // UI 已被 reset 清空：重放缓存里的原会话日志恢复显示
                //（原会话无缓存时保持空态，错误信息仍可见）
                if let Some(prev) = previous {
                    if let Some(log) = self.inner.replay_cache.lock().get(&prev).cloned() {
                        self.replay_cached(&prev, &log);
                    }
                }
                anyhow::bail!("切换会话失败：{e}")
            }
        }
    }

    /// 重放一段已缓存的会话日志到事件流：先换会话身份，重放期间经 scratch
    /// 捕获缓冲隔离——既不把重放事件写回该会话缓存（日志会翻倍），也不
    /// 串进此前会话的日志。
    fn replay_cached(&self, session_id: &str, log: &[Value]) {
        *self.inner.session.lock() = Some(session_id.to_string());
        *self.inner.replay_capture.lock() = Some(Vec::new());
        let sink = self.inner.sink.get().expect("sink 在构造时注入").clone();
        for payload in log {
            sink(payload);
        }
        self.inner.replay_capture.lock().take();
    }

    /// 清空当前会话：omp ACP 握手未声明 reset 能力（sessionCapabilities
    /// 仅 list/fork/resume/close），按计划落位为新建会话，旧会话留在 omp
    /// 侧作为历史（不删 omp 原生文件）。
    pub async fn clear_history(&self) -> Result<()> {
        self.new_session().await.map(|_| ())
    }

    /// 设思考等级（用户三档）。会话存在时即时下发 omp 原生配置，否则缓存
    /// 到会话建立。档位不可用回退 medium 一次并显式报错，不静默重试。
    pub async fn set_thinking_level(&self, level: &str) -> Result<()> {
        let mapped = events::thinking_to_omp(level)
            .ok_or_else(|| anyhow!("未知思考等级：{level}"))?;
        *self.inner.desired_thinking.lock() = level.to_string();
        let current = self.inner.session.lock().clone();
        if let Some(sid) = current {
            let conn = self.ensure_conn().await?;
            self.send_thinking_value(&conn, &sid, mapped, level).await;
        }
        Ok(())
    }

    /// 把用户期望档位下发到会话（create_session 与 set_thinking_level 共用）。
    async fn send_thinking(&self, conn: &AcpConn, sid: &str) {
        let level = self.inner.desired_thinking.lock().clone();
        let Some(mapped) = events::thinking_to_omp(&level) else { return };
        self.send_thinking_value(conn, sid, mapped, &level).await;
    }

    async fn send_thinking_value(&self, conn: &AcpConn, sid: &str, mapped: &str, label: &str) {
        let request = |value: &str| {
            conn.request(
                "session/set_config_option",
                json!({"sessionId": sid, "configId": "thinking", "value": value}),
            )
        };
        match request(mapped).await {
            Ok(v) => capture_config_options(&self.inner, &v),
            Err(e) => {
                // 档位不可用：回退 medium 一次并显式报错，不做静默多次重试
                if mapped != "medium" {
                    if let Ok(v) = request("medium").await {
                        capture_config_options(&self.inner, &v);
                    }
                }
                self.publish(json!({
                    "kind": "error",
                    "message": format!("思考等级 {label} 不可用，已回退标准档：{e}")
                }));
            }
        }
    }
}

fn session_cwd_json() -> Value {
    omp::OmpState::session_cwd()
        .map(|c| json!(c.to_string_lossy().into_owned()))
        .unwrap_or(Value::Null)
}

fn capture_config_options(inner: &Inner, result: &Value) {
    if let Some(opts) = result.get("configOptions").and_then(Value::as_array) {
        if let Some(thinking) = opts.iter().find(|o| o.get("id") == Some(&json!("thinking"))) {
            if let Some(current) = thinking.get("currentValue").and_then(Value::as_str) {
                *inner.actual_thinking.lock() = Some(current.to_string());
            }
        }
    }
}

/// 转换器的事件出口：静默期丢弃、捕获期入缓存、正常期外发。
/// Weak 引用打破 Inner → converter → sink → Inner 的环。
fn make_sink(weak: Weak<Inner>) -> EventSink {
    Arc::new(move |payload: &Value| {
        let Some(inner) = weak.upgrade() else { return };
        if inner.quiet.load(Ordering::SeqCst) {
            return;
        }
        if payload["kind"] == "reset" {
            emit(payload.clone());
            return;
        }
        if let Some(buf) = inner.replay_capture.lock().as_mut() {
            buf.push(payload.clone());
        } else if let Some(sid) = inner.session.lock().clone() {
            let mut cache = inner.replay_cache.lock();
            let log = cache.entry(sid).or_default();
            log.push(payload.clone());
            if log.len() > MAX_SESSION_LOG {
                let drop = log.len() - MAX_SESSION_LOG;
                log.drain(..drop);
            }
        }
        emit(payload.clone());
    })
}

/// ACP 事件路由：通知 → events.rs 转换（sink 决定外发）；审批请求 → 挂起
/// 等用户决定；未知请求回标准错误（不静默吞掉需要回复的请求）。
struct ConnHandlers(Arc<Inner>);

impl AcpHandlers for ConnHandlers {
    fn on_notification(&self, method: &str, params: Value) {
        if method != "session/update" {
            // 未知通知：记调试信息后忽略（$/cancel_request 等）
            eprintln!("[assistant] 忽略 ACP 通知：{method}");
            return;
        }
        let Some(update) = params.get("update") else { return };
        self.0.converter.lock().on_update(update);
    }

    fn on_request(&self, method: &str, params: Value, responder: Responder) {
        let inner = &self.0;
        let full = json!({"id": responder.id().clone(), "params": params});
        if inner.converter.lock().on_request(method, &full) {
            // 审批：挂起等用户。无超时——确认是用户动作；中断经
            // session/cancel 触发 omp 侧 abort，挂起应答自动失效。
            let key = responder.id().to_string();
            let (tx, rx) = oneshot::channel::<bool>();
            inner.confirmations.lock().insert(key.clone(), tx);
            let inner = Arc::clone(inner);
            tokio::spawn(async move {
                let approved = rx.await.unwrap_or(false);
                let response = inner.converter.lock().decision_response(&key, approved);
                match response {
                    Some(v) => responder.ok(v),
                    None => responder.err(-32603, "审批已失效（会话已重置）"),
                }
            });
            return;
        }
        match method {
            // fs 能力未声明（initialize 只开 elicitation），omp 不应请求；
            // 显式拒绝而非挂死对端
            "fs/read_text_file" | "fs/write_text_file" => {
                responder.err(-32601, "本客户端未开放文件系统代理");
            }
            _ => {
                eprintln!("[assistant] 未识别的 ACP 请求，已回错：{method}");
                responder.err(-32601, format!("未实现的 ACP 方法：{method}"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 事件出口三态：静默丢弃、捕获入缓存、正常外发。
    #[tokio::test]
    async fn sink_gates_quiet_capture_and_emit() {
        let state = AssistantState::new();
        let sink = make_sink(Arc::downgrade(&state.inner));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        set_emitter(Arc::new(move |v: &Value| {
            let _ = tx.send(v.clone());
        }));

        // 正常：外发
        sink(&json!({"kind": "delta", "text": "a"}));
        assert_eq!(rx.recv().await.unwrap()["kind"], "delta");

        // 捕获：入缓存且外发（回放要一边重建 UI 一边存档）
        *state.inner.replay_capture.lock() = Some(Vec::new());
        sink(&json!({"kind": "user_message", "text": "q"}));
        assert_eq!(rx.recv().await.unwrap()["kind"], "user_message");
        let captured = state.inner.replay_capture.lock().take().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0]["kind"], "user_message");

        // 静默：丢弃
        state.inner.quiet.store(true, Ordering::SeqCst);
        sink(&json!({"kind": "delta", "text": "b"}));
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(rx.try_recv().is_err(), "静默期不应外发");
        state.inner.quiet.store(false, Ordering::SeqCst);
    }

    /// 重复确认返回 false（幂等口径与旧 resolve_confirm 一致）。
    #[tokio::test]
    async fn resolve_confirm_is_once_only() {
        let state = AssistantState::new();
        let (tx, rx) = oneshot::channel();
        state.inner.confirmations.lock().insert("7".into(), tx);
        assert!(state.resolve_confirm("7", true));
        assert!(!state.resolve_confirm("7", true)); // 重复点击
        assert!(rx.await.unwrap());
        assert!(!state.busy());
    }

    /// 门禁：运行中或存在未决审批时 busy。
    #[test]
    fn busy_tracks_running_and_pending() {
        let state = AssistantState::new();
        assert!(!state.busy());
        state.inner.running.store(true, Ordering::SeqCst);
        assert!(state.busy());

        let (tx, _rx) = oneshot::channel();
        state.inner.confirmations.lock().insert("1".into(), tx);
        assert!(state.busy());
    }

    /// configOptions 里 thinking 档位的读取。
    #[test]
    fn captures_thinking_from_config_options() {
        let state = AssistantState::new();
        capture_config_options(
            &state.inner,
            &json!({"configOptions": [
                {"id": "mode", "currentValue": "default"},
                {"id": "thinking", "currentValue": "high"}
            ]}),
        );
        assert_eq!(state.thinking_level(), "deep");
    }

    /// 验证构建发送给 ACP 的 prompt 时，包含固定的中文领域指令与用户输入。
    #[test]
    fn builds_prompt_with_domain_instruction() {
        let prompt_without_selection = build_prompt_text("请生成一族 Halo 轨道", None);
        assert!(prompt_without_selection.starts_with(DOMAIN_INSTRUCTION));
        assert!(prompt_without_selection.contains("请生成一族 Halo 轨道"));
        assert!(!prompt_without_selection.contains("[当前画布选择]"));

        let prompt_with_selection = build_prompt_text(
            "分析当前轨道",
            Some(&json!({"recordId": "rec-123", "family": "Halo"})),
        );
        assert!(prompt_with_selection.starts_with(DOMAIN_INSTRUCTION));
        assert!(prompt_with_selection.contains("分析当前轨道"));
        assert!(prompt_with_selection.contains("[当前画布选择]"));
        assert!(prompt_with_selection.contains("\"recordId\":\"rec-123\""));
    }

    /// build_prompt_text 与 user_visible_message 互逆：回放剥离后应还原
    /// 用户原始消息；无信封特征的回放文本原样通过。
    #[test]
    fn user_visible_message_round_trip() {
        for (message, selection) in [
            ("问", None),
            ("多行\n消息", Some(json!({"recordId": "r1"}))),
        ] {
            let full = build_prompt_text(message, selection.as_ref());
            assert_eq!(user_visible_message(&full), message);
        }
        assert_eq!(user_visible_message("回放：最早的问题"), "回放：最早的问题");
    }
}
