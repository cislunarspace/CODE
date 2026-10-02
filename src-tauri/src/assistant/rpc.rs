//! pi RPC JSONL stdio 客户端：与 `pi --mode rpc` 子进程的换行 JSON 传输层
//!（ADR 0032；取代旧 ACP JSON-RPC 包封）。
//!
//! 职责（仅协议层，不含会话语义）：
//! - 在给定读写流上跑换行 JSON 协议（子进程拉起由调用方完成；测试用内存
//!   双工流替代真进程）；
//! - 命令 `{"id","type",…}` / 响应 `{"id","type":"response","command",
//!   "success",…}` 按 id 多路复用（响应乱序到达各归各家）；
//! - 会话事件（`message_update`/`tool_execution_*`/`agent_settled` 等，
//!   有 type 无 id）转交回调；
//! - 服务端子协议请求（`extension_ui_request`，有 type 有 id）转交回调并
//!   附带应答通道；应答为 `extension_ui_response`（复用请求自带 id，无
//!   JSON-RPC 错误码语义）；
//! - 读循环断开时唤醒全部等待者（is_alive 转假，上层据此重连）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

/// 服务端 → 客户端子协议请求（extension_ui_request）的应答通道：回调持有
/// 它择机应答，恰好一次。
#[derive(Clone)]
pub struct Responder {
    tx: mpsc::UnboundedSender<Outgoing>,
    id: Value,
}

impl Responder {
    /// 应答 select 的取值（如批准/拒绝选项文案）。
    pub fn ok(self, value: Value) {
        let _ = self
            .tx
            .send(Outgoing::UiResponse { id: self.id, value });
    }
}

/// 读循环上抛给上层的入站消息处理入口。
pub trait RpcHandlers: Send + Sync {
    /// 会话事件（有 type 无 id）。
    fn on_event(&self, record: Value);

    /// 服务端子协议请求（extension_ui_request）。实现必须恰好应答一次；
    /// fire-and-forget 方法（notify/setStatus 等）由实现忽略。
    fn on_request(&self, method: &str, params: Value, responder: Responder);
}

/// 客户端 → 子进程的出站消息（统一经同一写出通道串行写出）。
enum Outgoing {
    /// 命令（登记等待者）。
    Command {
        id: u64,
        kind: String,
        payload: Value,
        reply: oneshot::Sender<Result<Value>>,
    },
    /// 服务端子协议请求的应答。
    UiResponse { id: Value, value: Value },
}

/// RPC 连接句柄。克隆便宜；读循环退出后所有请求失败、`is_alive` 为假。
#[derive(Clone)]
pub struct RpcConn {
    tx: mpsc::UnboundedSender<Outgoing>,
    alive: Arc<AtomicBool>,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

impl RpcConn {
    /// 在已有读写流上跑协议，返回连接句柄（读写在后台任务中运行）。
    pub fn spawn_on<R, W>(reader: R, writer: W, handlers: Arc<dyn RpcHandlers>) -> Self
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (tx, rx) = mpsc::unbounded_channel();
        let alive = Arc::new(AtomicBool::new(true));
        // 回调应答服务端请求也走同一写出通道：给 io_loop 留一份发送端
        let responder_tx = tx.clone();
        tokio::spawn(io_loop(
            BufReader::new(reader),
            writer,
            rx,
            responder_tx,
            handlers,
            Arc::clone(&alive),
        ));
        Self { tx, alive }
    }

    /// 发命令并等响应（响应乱序到达按 id 路由）。信封的 success 判定与
    /// data 提取在 classify 一处完成（失败响应已转 Err 上抛）。
    pub async fn request(&self, kind: &str, payload: Value) -> Result<Value> {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(Outgoing::Command {
                id,
                kind: kind.into(),
                payload,
                reply: reply_tx,
            })
            .map_err(|_| anyhow!("RPC 连接已关闭"))?;
        reply_rx
            .await
            .map_err(|_| anyhow!("RPC 连接在等待响应时断开（{kind}）"))?
    }

    /// 读循环是否仍在（探活）。
    pub fn is_alive(&self) -> bool {
        !self.tx.is_closed() && self.alive.load(Ordering::SeqCst)
    }
}

async fn io_loop<R, W>(
    reader: BufReader<R>,
    mut writer: W,
    mut rx: mpsc::UnboundedReceiver<Outgoing>,
    responder_tx: mpsc::UnboundedSender<Outgoing>,
    handlers: Arc<dyn RpcHandlers>,
    alive: Arc<AtomicBool>,
) where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut lines = reader.lines();
    let mut pending: HashMap<u64, oneshot::Sender<Result<Value>>> = HashMap::new();
    loop {
        tokio::select! {
            out = rx.recv() => {
                let msg = match out {
                    Some(m) => m,
                    None => break, // 全部句柄已 drop
                };
                // 命令按值拆出等待者（oneshot 不可克隆），先登记再写：
                // 写失败立刻唤醒，不留悬挂等待
                let (registered_id, line) = match msg {
                    Outgoing::Command { id, kind, payload, reply } => {
                        pending.insert(id, reply);
                        (Some(id), encode_command(id, &kind, &payload))
                    }
                    other => (None, encode(&other)),
                };
                if let Some(line) = line {
                    if write_line(&mut writer, &line).await.is_err() {
                        if let Some(id) = registered_id {
                            if let Some(tx) = pending.remove(&id) {
                                let _ = tx.send(Err(anyhow!("RPC 写入失败（子进程可能已退出）")));
                            }
                        }
                        break;
                    }
                } else if let Some(id) = registered_id {
                    if let Some(tx) = pending.remove(&id) {
                        let _ = tx.send(Err(anyhow!("RPC 命令序列化失败")));
                    }
                }
            }
            line = lines.next_line() => {
                let text = match line {
                    Ok(Some(t)) => t,
                    Ok(None) | Err(_) => break, // EOF / IO 错误：子进程已死
                };
                let v: Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue, // 非 JSON 行（噪声/前向兼容）：跳过
                };
                match classify(&v) {
                    Inbound::Response { id, result } => {
                        if let Some(tx) = pending.remove(&id) {
                            let _ = tx.send(result);
                        }
                    }
                    Inbound::Event { record } => {
                        handlers.on_event(record);
                    }
                    Inbound::UiRequest { method, id, params } => {
                        let responder = Responder { tx: responder_tx.clone(), id };
                        handlers.on_request(&method, params, responder);
                    }
                }
            }
        }
    }
    alive.store(false, Ordering::SeqCst);
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err(anyhow!("RPC_CONNECTION_CLOSED")));
    }
}

async fn write_line<W: AsyncWrite + Unpin>(writer: &mut W, text: &str) -> std::io::Result<()> {
    let mut buf = String::with_capacity(text.len() + 1);
    buf.push_str(text);
    buf.push('\n');
    writer.write_all(buf.as_bytes()).await?;
    writer.flush().await
}

fn encode(msg: &Outgoing) -> Option<String> {
    let v = match msg {
        // Command 经 encode_command 平铺（见 io_loop）；此分支不可达，
        // 仅为穷尽匹配
        Outgoing::Command { id, kind, .. } => json!({"id": id, "type": kind}),
        Outgoing::UiResponse { id, value } => {
            json!({"type": "extension_ui_response", "id": id, "value": value})
        }
    };
    serde_json::to_string(&v).ok()
}

/// pi 命令载荷平铺进命令对象（`{"id","type",…payload}`，无 params 包封）。
fn encode_command(id: u64, kind: &str, payload: &Value) -> Option<String> {
    let mut v = json!({"id": id, "type": kind});
    if let (Some(obj), Some(extra)) = (v.as_object_mut(), payload.as_object()) {
        for (k, val) in extra {
            obj.insert(k.clone(), val.clone());
        }
    }
    serde_json::to_string(&v).ok()
}


enum Inbound {
    Response { id: u64, result: Result<Value> },
    Event { record: Value },
    UiRequest { method: String, id: Value, params: Value },
}

fn classify(v: &Value) -> Inbound {
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
    match kind {
        "response" => {
            let Some(id) = v.get("id").and_then(Value::as_u64) else {
                // 解析失败的响应无 id（parse 错误）：按事件上抛记日志
                return Inbound::Event { record: v.clone() };
            };
            let result = if v.get("success") == Some(&json!(false)) {
                let message = v
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("未知 pi 错误");
                Err(anyhow!("pi 错误：{message}"))
            } else {
                Ok(v.get("data").cloned().unwrap_or(Value::Null))
            };
            Inbound::Response { id, result }
        }
        // 扩展 UI 子协议：有 id 有 method，需要应答（select 等对话框）
        "extension_ui_request" => {
            let method = v
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let id = v.get("id").cloned().unwrap_or(Value::Null);
            Inbound::UiRequest {
                method,
                id,
                params: v.clone(),
            }
        }
        // 其余（message_update/tool_execution_*/agent_settled/…）：事件
        _ => Inbound::Event { record: v.clone() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use serde_json::json;
    use std::time::Duration;

    /// 捕获事件与请求并立即应答的最小 handlers。
    struct Recorder {
        events: Mutex<Vec<Value>>,
        requests: Mutex<Vec<(String, Value)>>,
    }

    impl Recorder {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                events: Mutex::new(Vec::new()),
                requests: Mutex::new(Vec::new()),
            })
        }
    }

    impl RpcHandlers for Recorder {
        fn on_event(&self, record: Value) {
            self.events.lock().push(record);
        }
        fn on_request(&self, method: &str, params: Value, responder: Responder) {
            self.requests.lock().push((method.to_string(), params));
            responder.ok(json!({"echo": method}));
        }
    }

    /// 测试用假服务端：读半 + 写半。
    struct Fake {
        reader: BufReader<tokio::io::ReadHalf<tokio::io::DuplexStream>>,
        writer: tokio::io::WriteHalf<tokio::io::DuplexStream>,
    }

    impl Fake {
        async fn read(&mut self) -> Value {
            let mut line = String::new();
            self.reader.read_line(&mut line).await.expect("read line");
            assert!(!line.trim().is_empty(), "对端不应关闭");
            serde_json::from_str(line.trim()).expect("valid json")
        }

        async fn write(&mut self, v: Value) {
            let mut buf = serde_json::to_string(&v).expect("serialize");
            buf.push('\n');
            self.writer.write_all(buf.as_bytes()).await.expect("write");
            self.writer.flush().await.expect("flush");
        }
    }

    fn fake_pair() -> (RpcConn, Fake) {
        // duplex(64k) 返回单个双工流：客户端留一半，假服务端一半
        let (client, server) = tokio::io::duplex(64 * 1024);
        let (c_read, c_write) = tokio::io::split(client);
        let rec = Recorder::new();
        let conn = RpcConn::spawn_on(c_read, c_write, rec);
        let (r, w) = tokio::io::split(server);
        (conn, Fake { reader: BufReader::new(r), writer: w })
    }

    /// 乱序响应按 id 各归各家。
    #[tokio::test]
    async fn out_of_order_responses_route_by_id() {
        let (conn, mut fake) = fake_pair();
        let (ca, cb) = (conn.clone(), conn.clone());
        let a = tokio::spawn(async move { ca.request("get_state", json!({})).await });
        let b = tokio::spawn(async move { cb.request("get_messages", json!({})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let id1 = fake.read().await["id"].as_u64().unwrap();
        let id2 = fake.read().await["id"].as_u64().unwrap();
        // 乱序：先应答后发的命令
        fake.write(json!({"id": id2, "type": "response", "command": "get_messages", "success": true, "data": {"which": "b"}})).await;
        fake.write(json!({"id": id1, "type": "response", "command": "get_state", "success": true, "data": {"which": "a"}})).await;
        let ra = a.await.unwrap().unwrap();
        let rb = b.await.unwrap().unwrap();
        assert_eq!(ra["which"], "a");
        assert_eq!(rb["which"], "b");
    }

    /// 命令载荷平铺进命令对象（无 params 包封）。
    #[tokio::test]
    async fn command_payload_is_flattened() {
        let (conn, mut fake) = fake_pair();
        let c2 = conn.clone();
        let task = tokio::spawn(async move { c2.request("prompt", json!({"message": "hi"})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let req = fake.read().await;
        assert_eq!(req["type"], "prompt");
        assert_eq!(req["message"], "hi");
        assert!(req.get("params").is_none(), "载荷不得包进 params：{req}");
        let id = req["id"].as_u64().unwrap();
        fake.write(json!({"id": id, "type": "response", "command": "prompt", "success": true, "data": {"disposition": "started"}})).await;
        let data = task.await.unwrap().unwrap();
        assert_eq!(data["disposition"], "started");
    }

    /// 会话事件进回调且不产生任何响应。
    #[tokio::test]
    async fn events_forwarded_without_reply() {
        let (conn, mut fake) = fake_pair();
        fake.write(json!({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "你好"}})).await;
        fake.write(json!({"type": "agent_settled"})).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        // 发一个命令并等应答：证明事件没有被误当成响应消耗
        let c2 = conn.clone();
        let resp = tokio::spawn(async move { c2.request("get_state", json!({})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let req = fake.read().await;
        let id = req["id"].as_u64().unwrap();
        assert_eq!(req["type"], "get_state");
        fake.write(json!({"id": id, "type": "response", "command": "get_state", "success": true, "data": {}})).await;
        resp.await.unwrap().unwrap();
    }

    /// extension_ui_request 进回调并由 Responder 应答（id 原样回带）。
    #[tokio::test]
    async fn ui_request_roundtrip() {
        let (conn, mut fake) = fake_pair();
        fake.write(json!({
            "type": "extension_ui_request", "id": "ui-7", "method": "select",
            "title": "TOD_TOOL_APPROVAL {}", "options": ["批准", "拒绝"]
        }))
        .await;
        let resp = fake.read().await;
        assert_eq!(resp["type"], "extension_ui_response");
        assert_eq!(resp["id"], "ui-7");
        assert_eq!(resp["value"]["echo"], "select");
        assert!(conn.is_alive());
    }

    /// 读循环断开（对端关闭）：全部等待者收到错误，is_alive 变假。
    #[tokio::test]
    async fn stream_close_fails_waiters_and_marks_dead() {
        let (conn, fake) = fake_pair();
        let c2 = conn.clone();
        let pending = tokio::spawn(async move { c2.request("prompt", json!({"message": "x"})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        drop(fake); // 模拟子进程退出
        let err = pending.await.unwrap().unwrap_err();
        assert!(err.to_string().contains("RPC_CONNECTION_CLOSED"), "got: {err}");
        assert!(!conn.is_alive());
    }

    /// 失败响应（success=false）透传 error 文本。
    #[tokio::test]
    async fn error_response_surfaces_error_text() {
        let (conn, mut fake) = fake_pair();
        let c2 = conn.clone();
        let task = tokio::spawn(async move { c2.request("set_model", json!({"provider": "x", "modelId": "nope"})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let id = fake.read().await["id"].as_u64().unwrap();
        fake.write(json!({
            "id": id, "type": "response", "command": "set_model",
            "success": false, "error": "Model not found: nope"
        }))
        .await;
        let err = task.await.unwrap().unwrap_err();
        assert!(err.to_string().contains("Model not found: nope"), "got: {err}");
    }
}
