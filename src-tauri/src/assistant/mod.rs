//! AI 助手会话适配器：以随应用分发的 pi 为唯一会话运行时（RPC 客户端，
//! ADR 0032）。
//!
//! pi 负责：模型配置与凭据（原生配置，本应用不保存 base URL/model/key）、
//! 会话上下文与持久化（`PI_CODING_AGENT_SESSION_DIR` 下的 JSONL，本应用
//! 只读扫描不解析改写）、模型调用、思考过程与 agent loop、steer 排队与
//! abort。本模块只保留：
//! - RPC 连接与当前会话 `(session_id, session_path)`、运行门禁、待处理
//!   审批与事件路由；
//! - pi 会话事件 → `AssistantEventPayload` 的单一转换（events.rs）；
//! - 会话生命周期：new / switch（get_messages 折成回放事件流重建 UI）/
//!   abort（真中断，aborted stopReason → interrupted）/ clear（pi 无
//!   reset 命令，落位为新建，旧会话留作历史）；
//! - 工具审批：桥接扩展（tod-bridge.ts）在 tool_call 拦截里对非白名单
//!   工具出 `extension_ui_request(select)`，本层解析信封映射为
//!   `tool_proposed` 工具卡片，用户确认/拒绝经 `assistant_confirm_tool`
//!   回 `extension_ui_response`（value 批准/拒绝）；
//! - 会话配置面：`get_available_models`/`get_available_thinking_levels`
//!   → 前端线形（model/thinking 两项，无 mode）；`set_config_option`
//!   先校验取值在选项内，期望配置在会话建立时统一下发。
//!
//! 事件契约（前端 `assistant-event`）：delta/thinking/user_message/tool_*
//! /message_done/interrupted/error/reset。回放（get_messages 折叠）与
//! 实时流走同一折叠路径，前端不再解析任何历史文件格式。

pub mod bridge;
pub mod events;
pub mod host_tools;
pub mod pi;
pub mod rpc;

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tokio::sync::oneshot;

use events::{EventSink, UpdateConverter};
use rpc::{Responder, RpcConn, RpcHandlers};

/// 前端监听的事件名。
pub const ASSISTANT_EVENT: &str = "assistant-event";

/// 会话结构操作被门禁拦下时的提示。
const BUSY_MSG: &str = "有回复进行中或工具确认未决，请等待完成后再操作会话";

/// 发给 pi 的固定中文领域指令：角色边界、工具纪律、结果与引用规范
///（每轮 prompt 正文前置注入；pi 侧无应用可控的系统提示词接口）。
const DOMAIN_INSTRUCTION: &str = "你是 Transfer Orbit Design 的轨道设计助手。始终使用简体中文回答，专业名词、工具名、字段名和协议名可保留必要的英文缩写。\n你只能协助本项目的轨道库、轨道计算、轨道预报、转移设计、坐标转换、分区分析和情景管理；超出范围时明确说明，不编造结果、记录、参数或工具返回值。\n本项目工具经 MCP 服务器 tod 挂载（工具名形如 mcp__tod__<工具名>），直接调用工具名即可，不经代码执行间接调用。\n处理任务时先理解用户目标，再使用已有工具获取事实；需要查询轨道库或情景时优先查询，不凭记忆猜测记录内容。工具参数必须符合工具 schema，缺少关键参数或存在多个合理解释时先向用户说明需要补充的信息。\n只读查询用于确认事实；会改变轨道库或情景的操作必须通过工具审批后执行。工具返回错误时说明错误原因和可行的下一步，不掩盖错误，不把未完成操作说成已完成。\n涉及计算结果时给出使用的输入、关键假设、单位、适用的数据系和结果摘要；引用轨道库记录、产物或情景时优先使用真实 record_id 或 scenario_file。不要输出冗长的内部思考过程，只给出对用户有用的结论、依据和下一步。";

/// 组装发给 pi 的 prompt 正文：领域指令 → 用户消息 → 可选画布选择。
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

/// build_prompt_text 的逆：从 pi 回放的消息全文剥出用户可见消息
///（去掉领域指令前缀与画布选择段；无信封特征时原样返回，兼容任意
/// 回放文本）。pi 会话文件里 user 消息存的是 prompt 全文，气泡必须在此
/// 剥离。
pub(crate) fn user_visible_message(full: &str) -> &str {
    let rest = full.strip_prefix(DOMAIN_INSTRUCTION).unwrap_or(full);
    let rest = rest.strip_prefix("\n\n").unwrap_or(rest);
    match rest.find("\n\n[当前画布选择]") {
        Some(i) => &rest[..i],
        None => rest,
    }
}

/// 会话事件日志上限（条）：超出截头（久远事件不再重放，全文在 pi 会话里）。
const MAX_SESSION_LOG: usize = 5000;

/// 会话索引扫描上限（文件数，按 mtime 倒序取前 N）。
const MAX_SESSION_FILES: usize = 200;

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

/// 一次挂起的审批（键 = pi 的 toolCallId，即卡片 callId）。
struct PendingApproval {
    /// 用户决定通道（true=批准）。
    tx: oneshot::Sender<bool>,
    /// 展示工具名（拒绝时收尾卡片回填）。
    tool: String,
}

/// 助手状态：RPC 连接（经 PiState）、当前会话 (id, path)、运行门禁、待
/// 确认审批与回放缓存。克隆语义：Command 层持 State 引用即可，无需 Clone。
pub struct AssistantState {
    inner: Arc<Inner>,
}

struct Inner {
    pi: pi::PiState,
    /// 当前会话 (session_id, session_path)（None = 尚未建立会话，首次发送
    /// 时懒创建）。存活于 pi 进程之外：pi 崩溃重拉后按 path switch_session
    /// 续上。
    session: parking_lot::Mutex<Option<(String, String)>>,
    /// 在飞轮次计数（并发的 steer 轮各占一个；全部在 agent_settled 收尾）。
    in_flight: AtomicUsize,
    /// 空闲门（watch）：agent_settled → true；prompt 接受 / agent_start →
    /// false。run_prompt 在 prompt 被接受后等它翻真（pi 的 prompt 响应只
    /// 表示受理，不表示轮次结束）。`_idle_anchor` 常驻一个 receiver：
    /// watch 的 send 在全部 receiver drop 后永久失效，等待者用完即丢，
    /// 通道必须始终有活 receiver。
    idle_tx: tokio::sync::watch::Sender<bool>,
    _idle_anchor: tokio::sync::watch::Receiver<bool>,
    /// 静默装载（重连后重开会话：转换器照常维护，但不外发事件）。
    quiet: parking_lot::Mutex<bool>,
    /// 用户期望的会话配置（config_id → value；会话建立前缓存，建立时应用）。
    desired_config: parking_lot::Mutex<HashMap<String, String>>,
    /// 会话当前生效的配置面（Rust 构造：model/thinking 两项）。
    config_options: parking_lot::Mutex<Vec<Value>>,
    /// 待确认审批：extension_ui_request id → 决定通道与卡片信息。
    confirmations: parking_lot::Mutex<HashMap<String, PendingApproval>>,
    /// 会话事件日志（UI 渲染缓存）：本进程内每条已外发事件的追加记录。
    /// pi 对已打开会话的二次切换不回放，切回时按日志重放；首次打开的
    /// 会话由 get_messages 回放重建后整体写入。上限截头防膨胀。
    replay_cache: parking_lot::Mutex<HashMap<String, Vec<Value>>>,
    /// 正在捕获的回放事件（回放构建期间置位；sink 内写入）。
    replay_capture: parking_lot::Mutex<Option<Vec<Value>>>,
    /// 会话索引（目录扫描产物，传输形状对齐前端 SessionMeta）。
    sessions: parking_lot::Mutex<Vec<Value>>,
    /// 会话 id → 会话文件路径（索引扫描副产品；switch_session 用）。
    session_paths: parking_lot::Mutex<HashMap<String, String>>,
    /// 当前连接代的转换器（换进程重建，审批挂起随之作废）。
    converter: parking_lot::Mutex<UpdateConverter>,
    /// 统一事件出口：静默丢弃、回放捕获、会话日志追加、全局外发。
    /// 全部事件（转换器产物与状态机自身发布）都必须经它，日志才完整。
    /// OnceLock：构造后立刻注入（闭包持 Weak，需 Inner 先存在）。
    sink: std::sync::OnceLock<EventSink>,
}

impl AssistantState {
    pub fn new() -> Self {
        let (idle_tx, _) = tokio::sync::watch::channel(false);
        let inner = Arc::new(Inner {
            pi: pi::PiState::new(),
            session: parking_lot::Mutex::new(None),
            in_flight: AtomicUsize::new(0),
            _idle_anchor: idle_tx.subscribe(),
            idle_tx,
            quiet: parking_lot::Mutex::new(false),
            desired_config: parking_lot::Mutex::new(HashMap::new()),
            config_options: parking_lot::Mutex::new(Vec::new()),
            confirmations: parking_lot::Mutex::new(HashMap::new()),
            replay_cache: parking_lot::Mutex::new(HashMap::new()),
            replay_capture: parking_lot::Mutex::new(None),
            sessions: parking_lot::Mutex::new(Vec::new()),
            session_paths: parking_lot::Mutex::new(HashMap::new()),
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
        self.inner.session.lock().as_ref().map(|(id, _)| id.clone())
    }

    /// 会话列表（目录扫描产物）。
    pub fn sessions(&self) -> Vec<Value> {
        self.inner.sessions.lock().clone()
    }

    /// 是否有回复进行中或未决审批（会话结构操作门禁）。
    pub fn busy(&self) -> bool {
        self.inner.in_flight.load(Ordering::SeqCst) > 0 || self.has_pending_confirmations()
    }

    /// 是否存在未决工具审批。
    pub fn has_pending_confirmations(&self) -> bool {
        !self.inner.confirmations.lock().is_empty()
    }

    /// 当前配置面（Rust 构造：model/thinking；UI 据此渲染下拉）。
    pub fn config_options(&self) -> Vec<Value> {
        self.inner.config_options.lock().clone()
    }

    /// RPC 进程是否存活（不为查询而拉起；首次使用才懒启动）。
    pub async fn connected(&self) -> bool {
        self.inner.pi.current().await.is_some()
    }

    /// pi 可执行文件是否可用（空态判定：未安装/不可执行）。以 setup
    /// 注册的命令为准（发布构建解析过资源目录），未注册再回落实时解析。
    pub fn pi_configured(&self) -> bool {
        pi::PiState::configured_command().is_some()
    }

    /// 确认/拒绝一次工具审批。返回 false = 该键没有挂起的等待（已取消/
    /// 重复点击）。拒绝时同步发 tool_done 失败卡（扩展阻断后调用不再有
    /// execution 事件，卡片由本层收尾；批准路径由 tool_execution_* 收尾）。
    pub fn resolve_confirm(&self, key: &str, approved: bool) -> bool {
        let Some(pending) = self.inner.confirmations.lock().remove(key) else {
            return false;
        };
        let _ = pending.tx.send(approved);
        if !approved {
            self.publish(json!({
                "kind": "tool_done", "callId": key, "tool": pending.tool,
                "ok": false, "summary": {"status": "info", "text": "用户拒绝执行"}
            }));
        }
        true
    }

    /// 取活跃连接；新拉进程时静默重开当前会话（重连路径）、重建配置面并
    /// 刷新索引。
    async fn ensure_conn(&self) -> Result<RpcConn> {
        let handlers = Arc::new(ConnHandlers(Arc::clone(&self.inner)));
        let (conn, fresh) = self.inner.pi.get_or_spawn(handlers).await?;
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
        if let Some((sid, path)) = current {
            let was_quiet = self.swap_quiet(true);
            let result = conn
                .request("switch_session", json!({"sessionPath": path}))
                .await;
            self.swap_quiet(was_quiet);
            result.map_err(|e| anyhow!("重连后恢复会话失败：{e}"))?;
            self.inner.session.lock().replace((sid, path));
        }
        // 配置面在会话恢复后重建：pi 会话文件里的 model/thinking 变更
        // 随 switch_session 恢复到状态面
        self.rebuild_config_face(&conn).await;
        self.refresh_sessions().await;
        Ok(conn)
    }

    /// 刷新会话索引：目录扫描含逐文件读取（首行 + 消息计数），整体丢给
    /// blocking 池执行，不占 tokio worker（assistant_send 返回路径上每轮跑）。
    async fn refresh_sessions(&self) {
        let inner = Arc::clone(&self.inner);
        tokio::task::spawn_blocking(move || scan_sessions_blocking(&inner))
            .await
            .expect("扫描任务不应 panic");
    }

    /// 发送一条用户消息并等整轮结束（增量经事件流推送）。生成中再发即
    /// 引导：pi 的 steer 排队到当前轮工具批后继续（上下文保留，不取消旧
    /// 轮）；引导前先收尾所有挂起审批。早期错误（pi 未安装/命令失败）经
    /// Err 上抛；运行期错误走 error 事件。
    pub async fn send(&self, message: &str, selection: Option<Value>) -> Result<()> {
        if self.inner.in_flight.load(Ordering::SeqCst) > 0 {
            // 引导轮：挂起的工具审批逐一拒绝收尾（卡片落失败态）——steer
            // 在工具批后注入，审批语义上应重新发起
            self.resolve_pending_for_steering();
        }
        self.inner.in_flight.fetch_add(1, Ordering::SeqCst);
        let result = self.run_prompt(message, selection).await;
        self.inner.in_flight.fetch_sub(1, Ordering::SeqCst);
        if let Err(e) = &result {
            self.publish(json!({"kind": "error", "message": e.to_string()}));
        }
        Ok(())
    }

    /// 引导前置清理：逐一拒绝全部挂起审批（对已失效的请求应答无害）并对
    /// 每张卡片发布失败收尾事件。
    fn resolve_pending_for_steering(&self) {
        let keys: Vec<String> = self.inner.confirmations.lock().keys().cloned().collect();
        for key in &keys {
            self.resolve_confirm(key, false); // 拒绝即发 tool_done 失败卡收尾
        }
    }

    async fn run_prompt(&self, message: &str, selection: Option<Value>) -> Result<()> {
        let conn = self.ensure_conn().await?;
        // 会话懒创建：首条消息建立会话（不发 reset——用户气泡已在 UI 上）
        if self.inner.session.lock().is_none() {
            self.create_session(&conn, false)
                .await
                .map_err(|e| anyhow!("创建会话失败：{e}"))?;
        }
        let prompt_text = build_prompt_text(message, selection.as_ref());
        // 用户气泡统一由事件流渲染（live 与回放同一路径）；选择上下文
        // 只进发给 pi 的正文，不进气泡事件
        self.publish(json!({"kind": "user_message", "text": message}));
        // 空闲门翻假：prompt 受理后等待 agent_settled
        let _ = self.inner.idle_tx.send(false);
        let steering = self.inner.in_flight.load(Ordering::SeqCst) > 1;
        let mut payload = json!({"message": prompt_text});
        if steering {
            payload["streamingBehavior"] = json!("steer");
        }
        if let Err(e) = conn.request("prompt", payload).await {
            // 受理失败：轮次没有开始，空闲门回真并如实报错
            let _ = self.inner.idle_tx.send(true);
            return Err(anyhow!("发送失败：{e}"));
        }
        self.wait_idle(&conn).await?;
        self.refresh_sessions().await;
        Ok(())
    }

    /// 等待轮次结束（agent_settled）。连接中途死亡时如实报错（等待者
    /// 不能挂死：pi 崩溃后 watch 不会翻真）。
    async fn wait_idle(&self, conn: &RpcConn) -> Result<()> {
        let mut rx = self.inner.idle_tx.subscribe();
        loop {
            if *rx.borrow() {
                return Ok(());
            }
            if !conn.is_alive() {
                return Err(anyhow!("RPC 连接在轮次进行中断开"));
            }
            tokio::select! {
                changed = rx.changed() => {
                    if changed.is_err() {
                        return Ok(()); // 发送端随 Inner 存活，实际不可达
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(250)) => {
                    // 循环回探活分支
                }
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

    /// 请求中断当前轮：abort 命令（响应到达即空闲）。返回是否存在进行中
    /// 轮次。
    pub async fn request_cancel(&self) -> bool {
        let running = self.inner.in_flight.load(Ordering::SeqCst) > 0;
        if running {
            // 通知是尽力而为：连接已死时下轮 ensure_conn 自愈
            if let Some(conn) = self.inner.pi.current().await {
                let _ = conn.request("abort", json!({})).await;
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
        self.refresh_sessions().await;
        Ok(sid)
    }

    /// create_session：new_session 命令 → get_state 取 (sessionId,
    /// sessionFile)；应用期望配置；emit_reset 控制 reset 事件（send 的懒
    /// 创建路径不发，避免清掉刚输入的用户气泡）。
    async fn create_session(&self, conn: &RpcConn, emit_reset: bool) -> Result<String> {
        conn.request("new_session", json!({}))
            .await
            .map_err(|e| anyhow!("new_session 失败：{e}"))?;
        let (sid, _path) = self.current_session_from_state(conn).await?;
        self.inner.replay_cache.lock().insert(sid.clone(), Vec::new());
        self.apply_desired_config(conn).await;
        if emit_reset {
            self.publish_reset();
        }
        Ok(sid)
    }

    /// get_state 取当前 (sessionId, sessionFile) 并写入 Inner.session。
    async fn current_session_from_state(&self, conn: &RpcConn) -> Result<(String, String)> {
        let state = conn.request("get_state", json!({})).await?;
        let sid = state
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("get_state 响应缺少 sessionId"))?
            .to_string();
        let path = state
            .get("sessionFile")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        self.inner
            .session_paths
            .lock()
            .insert(sid.clone(), path.clone());
        self.inner.session.lock().replace((sid.clone(), path.clone()));
        Ok((sid, path))
    }

    /// 切换会话：switch_session + get_messages 折成回放事件流重建 UI；
    /// 已打开过的会话走本地缓存重放。失败时恢复原会话的显示（有缓存则
    /// 重放回原状），会话 id 不变。
    pub async fn switch_session(&self, session_id: &str) -> Result<()> {
        if self.busy() {
            anyhow::bail!(BUSY_MSG);
        }
        // 会话路径：索引扫描产物或本进程建立的会话
        let path = self
            .inner
            .session_paths
            .lock()
            .get(session_id)
            .cloned()
            .or_else(|| {
                self.inner
                    .session
                    .lock()
                    .as_ref()
                    .filter(|(id, _)| id == session_id)
                    .map(|(_, p)| p.clone())
            })
            .ok_or_else(|| anyhow!("会话 {session_id} 不在索引里"))?;
        let conn = self.ensure_conn().await?;
        let previous = self.inner.session.lock().clone();
        // 重建指令先行：后续无论缓存重放还是 pi 回放都在清空后的流上重建
        self.publish_reset();
        let cached = self.inner.replay_cache.lock().get(session_id).cloned();
        if let Some(log) = cached {
            // 缓存命中也要切 pi 侧活动会话：prompt 命令无会话寻址，
            // 只作用于 pi 当前会话，不切换会把后续消息写进别的会话文件
            if let Err(e) = conn.request("switch_session", json!({"sessionPath": path})).await {
                if let Some((prev_id, prev_path)) = previous {
                    if let Some(log) = self.inner.replay_cache.lock().get(&prev_id).cloned() {
                        self.replay_cached(&prev_id, &prev_path, &log);
                    }
                }
                anyhow::bail!("切换会话失败：{e}")
            }
            self.replay_cached(session_id, &path, &log);
            // 目标会话的 model/thinking 随 switch_session 恢复到 pi 状态面，
            // 配置条同步重建（不重建则显示原会话取值直到重连）
            self.rebuild_config_face(&conn).await;
            self.refresh_sessions().await;
            return Ok(());
        }
        // 首次打开：切换 + 消息折成回放事件流并缓存
        let switched = conn
            .request("switch_session", json!({"sessionPath": path}))
            .await;
        match switched {
            Ok(_) => {
                let messages = conn
                    .request("get_messages", json!({}))
                    .await
                    .map_err(|e| anyhow!("读取会话消息失败：{e}"))?;
                let list: Vec<Value> = messages
                    .get("messages")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                *self.inner.replay_capture.lock() = Some(Vec::new());
                self.inner.converter.lock().replay_from_messages(&list);
                let log = self.inner.replay_capture.lock().take().unwrap_or_default();
                self.inner
                    .replay_cache
                    .lock()
                    .insert(session_id.to_string(), log);
                self.inner
                    .session
                    .lock()
                    .replace((session_id.to_string(), path));
                self.rebuild_config_face(&conn).await;
                self.refresh_sessions().await;
                Ok(())
            }
            Err(e) => {
                // UI 已被 reset 清空：重放缓存里的原会话日志恢复显示
                //（原会话无缓存时保持空态，错误信息仍可见）
                if let Some((prev_id, prev_path)) = previous {
                    if let Some(log) = self.inner.replay_cache.lock().get(&prev_id).cloned() {
                        self.replay_cached(&prev_id, &prev_path, &log);
                    }
                }
                anyhow::bail!("切换会话失败：{e}")
            }
        }
    }

    /// 重放一段已缓存的会话日志到事件流：先换会话身份，重放期间经 scratch
    /// 捕获缓冲隔离——既不把重放事件写回该会话缓存（日志会翻倍），也不
    /// 串进此前会话的日志。
    fn replay_cached(&self, session_id: &str, path: &str, log: &[Value]) {
        self.inner
            .session
            .lock()
            .replace((session_id.to_string(), path.to_string()));
        *self.inner.replay_capture.lock() = Some(Vec::new());
        let sink = self.inner.sink.get().expect("sink 在构造时注入").clone();
        for payload in log {
            sink(payload);
        }
        self.inner.replay_capture.lock().take();
    }

    /// 清空当前会话：pi RPC 无 reset 能力，按计划落位为新建会话，旧会话
    /// 留在 pi 会话目录作为历史（不删 pi 原生文件）。
    pub async fn clear_history(&self) -> Result<()> {
        self.new_session().await.map(|_| ())
    }

    /// 设置一项会话配置（model/thinking）。值先对照当前配置面校验（select
    /// 必须在选项内，防止垃圾值进期望缓存）；pi 进程存在时即时下发并刷新
    /// 配置面，不存在时缓存到进程拉起。pi 侧错误原样上抛。
    pub async fn set_config_option(&self, config_id: &str, value: &str) -> Result<()> {
        let opts = self.inner.config_options.lock().clone();
        if let Some(opt) = opts.iter().find(|o| o.get("id") == Some(&json!(config_id))) {
            let valid = opt
                .get("options")
                .and_then(Value::as_array)
                .map(|xs| xs.iter().any(|x| x.get("value") == Some(&json!(value))))
                .unwrap_or(false);
            if !valid {
                anyhow::bail!("配置 {config_id} 不支持取值 {value}");
            }
        } else {
            anyhow::bail!("未知配置项 {config_id}");
        }
        self.inner
            .desired_config
            .lock()
            .insert(config_id.to_string(), value.to_string());
        if self.inner.pi.current().await.is_some() {
            let conn = self.ensure_conn().await?;
            self.apply_config_option(&conn, config_id, value)
                .await?;
        }
        Ok(())
    }

    /// 把一项配置下发给 pi（model 拆 provider/modelId；thinking 直传）。
    async fn apply_config_option(
        &self,
        conn: &RpcConn,
        config_id: &str,
        value: &str,
    ) -> Result<()> {
        match config_id {
            "model" => {
                let (provider, model_id) = value
                    .split_once('/')
                    .ok_or_else(|| anyhow!("模型值须为 provider/modelId 形态：{value}"))?;
                conn.request(
                    "set_model",
                    json!({"provider": provider, "modelId": model_id}),
                )
                .await
                .map_err(|e| anyhow!("设置模型失败：{e}"))?;
            }
            "thinking" => {
                conn.request("set_thinking_level", json!({"level": value}))
                    .await
                    .map_err(|e| anyhow!("设置思考档失败：{e}"))?;
            }
            other => anyhow::bail!("未知配置项 {other}"),
        }
        self.rebuild_config_face(conn).await;
        Ok(())
    }

    /// 把用户期望的全部配置应用到 pi（create_session 后调用）。某项失败：
    /// 丢弃该项（避免每次建会话都撞同一错误）并显式报错，其余继续。
    async fn apply_desired_config(&self, conn: &RpcConn) {
        let desired: Vec<(String, String)> = self
            .inner
            .desired_config
            .lock()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (id, value) in desired {
            if let Err(e) = self.apply_config_option(conn, &id, &value).await {
                self.inner.desired_config.lock().remove(&id);
                self.publish(json!({
                    "kind": "error",
                    "message": format!("会话配置 {id}={value} 应用失败，已丢弃：{e}")
                }));
            }
        }
    }

    /// 重建配置面：get_state（当前 model/thinking）+ get_available_models
    /// + get_available_thinking_levels → 前端线形（无 mode 项）。
    async fn rebuild_config_face(&self, conn: &RpcConn) {
        let mut opts: Vec<Value> = Vec::new();
        let state = conn.request("get_state", json!({})).await.ok();
        if let Some(models) = conn
            .request("get_available_models", json!({}))
            .await
            .ok()
            .and_then(|d| d.get("models").cloned())
            .and_then(|m| m.as_array().cloned())
        {
            let current = state
                .as_ref()
                .and_then(|s| s.get("model"))
                .map(|m| {
                    format!(
                        "{}/{}",
                        m.get("provider").and_then(Value::as_str).unwrap_or(""),
                        m.get("id").and_then(Value::as_str).unwrap_or("")
                    )
                })
                .unwrap_or_default();
            let options: Vec<Value> = models
                .iter()
                .map(|m| {
                    let value = format!(
                        "{}/{}",
                        m.get("provider").and_then(Value::as_str).unwrap_or(""),
                        m.get("id").and_then(Value::as_str).unwrap_or("")
                    );
                    json!({
                        "value": value,
                        "name": m.get("name").and_then(Value::as_str)
                            .unwrap_or_else(|| m.get("id").and_then(Value::as_str).unwrap_or("")),
                    })
                })
                .collect();
            opts.push(json!({
                "id": "model",
                "currentValue": if current.is_empty() { Value::Null } else { json!(current) },
                "options": options,
            }));
        }
        if let Some(levels) = conn
            .request("get_available_thinking_levels", json!({}))
            .await
            .ok()
            .and_then(|d| d.get("levels").cloned())
            .and_then(|l| l.as_array().cloned())
        {
            let current = state
                .as_ref()
                .and_then(|s| s.get("thinkingLevel"))
                .cloned()
                .unwrap_or(Value::Null);
            let options: Vec<Value> = levels
                .iter()
                .map(|l| json!({"value": l, "name": l}))
                .collect();
            opts.push(json!({"id": "thinking", "currentValue": current, "options": options}));
        }
        *self.inner.config_options.lock() = opts;
    }

    /// 静默标志切换（重连恢复用），返回旧值。
    fn swap_quiet(&self, value: bool) -> bool {
        let mut guard = self.inner.quiet.lock();
        let old = *guard;
        *guard = value;
        old
    }
}

/// 会话目录扫描（blocking 池执行）：`*.jsonl` 按 mtime 倒序取前
/// MAX_SESSION_FILES。逐文件读首行 SessionHeader（id）+ 统计对话消息条数
///（user/assistant）+ 取最后一条 session_info 的 name；updatedAt 用文件
/// mtime。坏文件（首行解析失败）跳过。产物写回 Inner 的索引与路径表。
fn scan_sessions_blocking(inner: &Inner) {
    let Some(dir) = session_dir() else {
        *inner.sessions.lock() = Vec::new();
        inner.session_paths.lock().clear();
        return;
    };
    let mut entries: Vec<(std::time::SystemTime, std::path::PathBuf)> =
        match std::fs::read_dir(&dir) {
            Ok(rd) => rd
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "jsonl"))
                .filter_map(|p| {
                    let mtime = std::fs::metadata(&p)
                        .and_then(|m| m.modified())
                        .ok()?;
                    Some((mtime, p))
                })
                .collect(),
            Err(_) => Vec::new(),
        };
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    entries.truncate(MAX_SESSION_FILES);
    let mut list = Vec::with_capacity(entries.len());
    let mut paths = HashMap::new();
    for (mtime, path) in entries {
        let Some(header) = read_session_header(&path) else { continue };
        let id = header
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if id.is_empty() {
            continue;
        }
        let (message_count, title) = scan_session_file(&path);
        let title = match title {
            Some(name) => name,
            None => id.chars().take(8).collect(),
        };
        let updated = mtime
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        paths.insert(id.clone(), path.to_string_lossy().into_owned());
        list.push(json!({
            "id": id,
            "title": title,
            "updatedAt": updated,
            "messageCount": message_count,
        }));
    }
    *inner.sessions.lock() = list;
    *inner.session_paths.lock() = paths;
}

/// 应用会话目录（PI_CODING_AGENT_SESSION_DIR 注入目标；setup 注册）。
fn session_dir() -> Option<std::path::PathBuf> {
    pi::PiState::session_dir()
}

/// 读会话文件首行 SessionHeader（解析失败返回 None）。
fn read_session_header(path: &std::path::Path) -> Option<Value> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).ok()?;
    let mut line = String::new();
    std::io::BufReader::new(file).read_line(&mut line).ok()?;
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    (v.get("type").and_then(Value::as_str) == Some("session")).then_some(v)
}

/// 扫描会话文件正文：对话消息条数（user/assistant）与最后一条
/// session_info 的 name。
fn scan_session_file(path: &std::path::Path) -> (Option<u64>, Option<String>) {
    use std::io::BufRead;
    let Ok(file) = std::fs::File::open(path) else {
        return (None, None);
    };
    let mut count = 0u64;
    let mut title = None;
    let mut first = true;
    for line in std::io::BufReader::new(file).lines().map_while(Result::ok) {
        if first {
            first = false; // SessionHeader 不计
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        match v.get("type").and_then(Value::as_str) {
            Some("message") => {
                let role = v
                    .get("message")
                    .and_then(|m| m.get("role"))
                    .and_then(Value::as_str);
                if matches!(role, Some("user") | Some("assistant")) {
                    count += 1;
                }
            }
            Some("session_info") => {
                title = v.get("name").and_then(Value::as_str).map(String::from);
            }
            _ => {}
        }
    }
    (Some(count), title)
}

/// 转换器的事件出口：静默期丢弃、捕获期入缓存、正常期外发。
/// Weak 引用打破 Inner → converter → sink → Inner 的环。
fn make_sink(weak: std::sync::Weak<Inner>) -> EventSink {
    Arc::new(move |payload: &Value| {
        let Some(inner) = weak.upgrade() else { return };
        if *inner.quiet.lock() {
            return;
        }
        if payload["kind"] == "reset" {
            emit(payload.clone());
            return;
        }
        if let Some(buf) = inner.replay_capture.lock().as_mut() {
            buf.push(payload.clone());
        } else if let Some((sid, _)) = inner.session.lock().clone() {
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

/// pi 事件路由：会话事件 → events.rs 转换（sink 决定外发）；
/// extension_ui_request → 审批卡挂起等用户决定；fire-and-forget UI 方法
/// 忽略；agent_settled → 空闲门翻真。
struct ConnHandlers(Arc<Inner>);

impl RpcHandlers for ConnHandlers {
    fn on_event(&self, record: Value) {
        let inner = &self.0;
        match record.get("type").and_then(Value::as_str) {
            Some("agent_settled") => {
                let _ = inner.idle_tx.send(true);
            }
            Some("agent_start") => {
                let _ = inner.idle_tx.send(false);
            }
            _ => {}
        }
        inner.converter.lock().on_event(&record);
    }
    fn on_request(&self, _method: &str, params: Value, responder: Responder) {
        let inner = &self.0;
        let Some((call_id, tool, _args)) = inner.converter.lock().on_approval_request(&params)
        else {
            // fire-and-forget UI 方法（notify/setStatus/setTitle/…）：不需要
            // 应答；对话框类但非审批信封（扩展其它 select）同样忽略——
            // 桥接扩展只发审批信封一种 select
            return;
        };
        // 挂起表按 toolCallId（卡片 callId）键控：前端只见卡片 callId，
        // confirm 通道与应答 Responder 各自持有所需标识。
        // 先登记决定通道再发射卡片：前端见到 tool_proposed 即可能立刻
        // resolve_confirm，键必须先存在（否则竞态丢确认）
        let (tx, rx) = oneshot::channel::<bool>();
        inner.confirmations.lock().insert(
            call_id,
            PendingApproval {
                tx,
                tool,
            },
        );
        // 挂起等用户。无超时——确认是用户动作；应用 abort 会使 pi 侧
        // 对话框按未选解析，扩展按拒绝处理（fail-closed）
        tokio::spawn(async move {
            let approved = rx.await.unwrap_or(false);
            responder.ok(json!(if approved { "批准" } else { "拒绝" }));
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 事件出口三态：静默丢弃、捕获入缓存、正常外发。
    #[tokio::test]
    async fn sink_gates_quiet_capture_and_emit() {
        let state = AssistantState::new();
        let sink = make_sink(std::sync::Arc::downgrade(&state.inner));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        set_emitter(Arc::new(move |v: &Value| {
            let _ = tx.send(v.clone());
        }));

        // 正常：外发
        sink(&json!({"kind": "delta", "text": "a"}));
        assert_eq!(rx.recv().await.unwrap()["kind"], "delta");

        // 捕获：入缓存且外发（回放要一边重建 UI 一边存档）
        *state.inner.session.lock() = Some(("s1".into(), "/tmp/s1.jsonl".into()));
        *state.inner.replay_capture.lock() = Some(Vec::new());
        sink(&json!({"kind": "user_message", "text": "q"}));
        assert_eq!(rx.recv().await.unwrap()["kind"], "user_message");
        let captured = state.inner.replay_capture.lock().take().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0]["kind"], "user_message");

        // 静默：丢弃
        *state.inner.quiet.lock() = true;
        sink(&json!({"kind": "delta", "text": "b"}));
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(rx.try_recv().is_err(), "静默期不应外发");
        *state.inner.quiet.lock() = false;

        // 拒绝路径：决定送达 + 卡片收尾为失败态（与 sink 三态同测：
        // EMITTER 是进程级 OnceLock，独立测试函数会互踩）
        let (approval_tx, mut approval_rx) = oneshot::channel();
        state.inner.confirmations.lock().insert(
            "call_9".into(),
            PendingApproval {
                tx: approval_tx,
                tool: "scenario_write".into(),
            },
        );
        assert!(state.resolve_confirm("call_9", false));
        assert!(!approval_rx.await.unwrap());
        let done = rx.recv().await.unwrap();
        assert_eq!(done["kind"], "tool_done");
        assert_eq!(done["callId"], "call_9");
        assert_eq!(done["ok"], false);
    }


    /// 门禁：运行中或存在未决审批时 busy。
    #[test]
    fn busy_tracks_running_and_pending() {
        let state = AssistantState::new();
        assert!(!state.busy());
        state.inner.in_flight.store(1, Ordering::SeqCst);
        assert!(state.busy());

        let (tx, _rx) = oneshot::channel();
        state.inner.confirmations.lock().insert(
            "1".into(),
            PendingApproval {
                tx,
                tool: "t".into(),
            },
        );
        assert!(state.busy());
    }

    /// 验证构建发送给 pi 的 prompt 时，包含固定的中文领域指令与用户输入。
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

    /// 会话文件扫描：首行 header、消息计数、session_info 标题、坏文件跳过。
    #[test]
    fn session_file_scan_extracts_header_count_and_title() {
        let dir = std::env::temp_dir().join(format!("tod-sessions-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let good = dir.join("20260101T000000_abc123.jsonl");
        std::fs::write(
            &good,
            concat!(
                "{\"type\":\"session\",\"version\":3,\"id\":\"abc123\",\"timestamp\":\"2026-01-01T00:00:00.000Z\"}\n",
                "{\"type\":\"message\",\"message\":{\"role\":\"system\",\"content\":\"\"}}\n",
                "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"hi\"}}\n",
                "{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":[]}}\n",
                "{\"type\":\"session_info\",\"name\":\"起个名字\"}\n",
            ),
        )
        .unwrap();
        let header = read_session_header(&good).expect("header 应可解析");
        assert_eq!(header["id"], "abc123");
        let (count, title) = scan_session_file(&good);
        assert_eq!(count, Some(2), "system 消息不计入");
        assert_eq!(title.as_deref(), Some("起个名字"));

        let bad = dir.join("bad.jsonl");
        std::fs::write(&bad, "not-json\n").unwrap();
        assert!(read_session_header(&bad).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
