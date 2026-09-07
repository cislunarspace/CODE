//! ACP（Agent Client Protocol）JSON-RPC stdio 客户端：与 omp `acp` 子进程
//! 的换行 JSON 传输层（omp 为基座的重构，取代自建 OpenAI 兼容 agent loop）。
//!
//! 职责（仅协议层，不含会话语义）：
//! - 在给定读写流上跑换行 JSON 协议（子进程拉起由调用方完成；测试用内存
//!   双工流替代真进程）；
//! - 请求/响应按 id 多路复用（响应乱序到达各归各家）；
//! - 服务端通知（`session/update` 等）转交回调；未知通知同样上抛，由
//!   上层记调试日志后忽略；
//! - 服务端请求（`elicitation/create`、`session/request_permission` 等）
//!   转交回调并附带应答通道；本层不区分已知未知——上层对未知请求回
//!   JSON-RPC 标准错误，保证需要回复的请求不被静默吞掉；
//! - 读循环断开时唤醒全部等待者并广播 closed（上层据此重连）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, Notify};

/// 服务端 → 客户端请求的应答通道：回调持有它择机应答，恰好一次。
#[derive(Clone)]
pub struct Responder {
    tx: mpsc::UnboundedSender<Outgoing>,
    id: Value,
}

impl Responder {
    /// 服务端请求的 id（审批键：卡片 callId 与挂起表都按它索引）。
    pub fn id(&self) -> &Value {
        &self.id
    }

    /// 应答成功结果。
    pub fn ok(self, result: Value) {
        let _ = self.tx.send(Outgoing::Response { id: self.id, outcome: Ok(result) });
    }

    /// 应答 JSON-RPC 错误。
    pub fn err(self, code: i64, message: impl Into<String>) {
        let _ = self.tx.send(Outgoing::Response {
            id: self.id,
            outcome: Err((code, message.into())),
        });
    }
}

/// 读循环上抛给上层的入站消息处理入口。
pub trait AcpHandlers: Send + Sync {
    /// 服务端通知（有 method 无 id）。
    fn on_notification(&self, method: &str, params: Value);

    /// 服务端请求（有 method 有 id）。实现必须恰好应答一次；未识别的
    /// method 由实现回 -32601（本层不拦截，保证语义集中）。
    fn on_request(&self, method: &str, params: Value, responder: Responder);
}

/// 客户端 → 子进程的出站消息（统一经同一写出通道串行写出）。
enum Outgoing {
    /// 请求（登记等待者）。
    Request {
        id: u64,
        method: String,
        params: Value,
        reply: oneshot::Sender<Result<Value>>,
    },
    /// 通知（无 id）。
    Notification { method: String, params: Value },
    /// 服务端请求的应答。
    Response { id: Value, outcome: std::result::Result<Value, (i64, String)> },
}

/// ACP 连接句柄。克隆便宜；读循环退出后所有请求失败、`is_alive` 为假。
#[derive(Clone)]
pub struct AcpConn {
    tx: mpsc::UnboundedSender<Outgoing>,
    closed: Arc<Notify>,
    alive: Arc<AtomicBool>,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

impl AcpConn {
    /// 在已有读写流上跑协议，返回连接句柄（读写在后台任务中运行）。
    pub fn spawn_on<R, W>(reader: R, writer: W, handlers: Arc<dyn AcpHandlers>) -> Self
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (tx, rx) = mpsc::unbounded_channel();
        let closed = Arc::new(Notify::new());
        let alive = Arc::new(AtomicBool::new(true));
        // 回调应答服务端请求也走同一写出通道：给 io_loop 留一份发送端
        let responder_tx = tx.clone();
        tokio::spawn(io_loop(
            BufReader::new(reader),
            writer,
            rx,
            responder_tx,
            handlers,
            Arc::clone(&closed),
            Arc::clone(&alive),
        ));
        Self { tx, closed, alive }
    }

    /// 发请求并等响应（响应乱序到达按 id 路由）。
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(Outgoing::Request { id, method: method.into(), params, reply: reply_tx })
            .map_err(|_| anyhow!("ACP 连接已关闭"))?;
        reply_rx
            .await
            .map_err(|_| anyhow!("ACP 连接在等待响应时断开（{method}）"))?
    }

    /// 发通知（无 id，不等响应）。
    pub fn notify(&self, method: &str, params: Value) -> Result<()> {
        self.tx
            .send(Outgoing::Notification { method: method.into(), params })
            .map_err(|_| anyhow!("ACP 连接已关闭"))
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
    handlers: Arc<dyn AcpHandlers>,
    closed: Arc<Notify>,
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
                // 请求按值拆出等待者（oneshot 不可克隆），先登记再写：
                // 写失败立刻唤醒，不留悬挂等待
                let (registered_id, line) = match msg {
                    Outgoing::Request { id, method, params, reply } => {
                        pending.insert(id, reply);
                        (Some(id), encode_request(id, &method, &params))
                    }
                    other => (None, encode(&other)),
                };
                if let Some(line) = line {
                    if write_line(&mut writer, &line).await.is_err() {
                        if let Some(id) = registered_id {
                            if let Some(tx) = pending.remove(&id) {
                                let _ = tx.send(Err(anyhow!("ACP 写入失败（子进程可能已退出）")));
                            }
                        }
                        break;
                    }
                } else if let Some(id) = registered_id {
                    if let Some(tx) = pending.remove(&id) {
                        let _ = tx.send(Err(anyhow!("ACP 请求序列化失败")));
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
                    Inbound::Notification { method, params } => {
                        handlers.on_notification(&method, params);
                    }
                    Inbound::Request { method, id, params } => {
                        let responder = Responder { tx: responder_tx.clone(), id };
                        handlers.on_request(&method, params, responder);
                    }
                }
            }
        }
    }
    alive.store(false, Ordering::SeqCst);
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err(anyhow!("ACP_CONNECTION_CLOSED")));
    }
    closed.notify_waiters();
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
        Outgoing::Request { id, method, params, .. } => {
            json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
        }
        Outgoing::Notification { method, params } => {
            json!({"jsonrpc": "2.0", "method": method, "params": params})
        }
        Outgoing::Response { id, outcome } => match outcome {
            Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
            Err((code, message)) => {
                json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
            }
        },
    };
    serde_json::to_string(&v).ok()
}

fn encode_request(id: u64, method: &str, params: &Value) -> Option<String> {
    serde_json::to_string(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).ok()
}

enum Inbound {
    Response { id: u64, result: Result<Value> },
    Notification { method: String, params: Value },
    Request { method: String, id: Value, params: Value },
}

fn classify(v: &Value) -> Inbound {
    if let Some(method) = v.get("method").and_then(Value::as_str) {
        let params = v.get("params").cloned().unwrap_or(Value::Null);
        if let Some(id) = v.get("id") {
            Inbound::Request { method: method.to_string(), id: id.clone(), params }
        } else {
            Inbound::Notification { method: method.to_string(), params }
        }
    } else if let Some(id) = v.get("id").and_then(Value::as_u64) {
        let result = if let Some(err) = v.get("error") {
            let message = err.get("message").and_then(Value::as_str).unwrap_or("未知 ACP 错误");
            let detail = err.get("data").and_then(|d| d.get("details")).and_then(Value::as_str);
            let code = err.get("code").and_then(Value::as_i64).unwrap_or(0);
            Err(anyhow!(
                "ACP 错误 {code}：{message}{}",
                detail.map(|d| format!("（{d}）")).unwrap_or_default()
            ))
        } else {
            Ok(v.get("result").cloned().unwrap_or(Value::Null))
        };
        Inbound::Response { id, result }
    } else {
        // 无 method 无 id：既非请求也非响应，按可忽略通知上抛（空 method）
        Inbound::Notification { method: String::new(), params: Value::Null }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use serde_json::json;
    use std::time::Duration;

    /// 捕获通知与请求并立即应答的最小 handlers。
    struct Recorder {
        notifications: Mutex<Vec<(String, Value)>>,
        requests: Mutex<Vec<(String, Value)>>,
    }

    impl Recorder {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                notifications: Mutex::new(Vec::new()),
                requests: Mutex::new(Vec::new()),
            })
        }
    }

    impl AcpHandlers for Recorder {
        fn on_notification(&self, method: &str, params: Value) {
            self.notifications.lock().push((method.to_string(), params));
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

    fn fake_pair() -> (AcpConn, Fake) {
        // duplex(64k) 返回单个双工流：客户端留一半，假服务端一半
        let (client, server) = tokio::io::duplex(64 * 1024);
        let (c_read, c_write) = tokio::io::split(client);
        let rec = Recorder::new();
        let conn = AcpConn::spawn_on(c_read, c_write, rec);
        let (r, w) = tokio::io::split(server);
        (conn, Fake { reader: BufReader::new(r), writer: w })
    }

    /// 乱序响应按 id 各归各家。
    #[tokio::test]
    async fn out_of_order_responses_route_by_id() {
        let (conn, mut fake) = fake_pair();
        let (ca, cb) = (conn.clone(), conn.clone());
        let a = tokio::spawn(async move { ca.request("session/new", json!({"cwd": "/tmp"})).await });
        let b = tokio::spawn(async move { cb.request("session/list", json!({})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let id1 = fake.read().await["id"].as_u64().unwrap();
        let id2 = fake.read().await["id"].as_u64().unwrap();
        // 乱序：先应答后发的请求
        fake.write(json!({"jsonrpc": "2.0", "id": id2, "result": {"which": "b"}})).await;
        fake.write(json!({"jsonrpc": "2.0", "id": id1, "result": {"which": "a"}})).await;
        let ra = a.await.unwrap().unwrap();
        let rb = b.await.unwrap().unwrap();
        assert_eq!(ra["which"], "a");
        assert_eq!(rb["which"], "b");
    }

    /// 通知进回调且不产生任何响应（对端不会再读到东西——用请求应答对齐验证）。
    #[tokio::test]
    async fn notifications_forwarded_without_reply() {
        let (conn, mut fake) = fake_pair();
        fake.write(json!({
            "jsonrpc": "2.0", "method": "session/update",
            "params": {"sessionId": "s1", "update": {"sessionUpdate": "usage_update"}}
        }))
        .await;
        fake.write(json!({"jsonrpc": "2.0", "method": "$/unknown", "params": {}})).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        // 发一个请求并等应答：证明通知没有被误当成响应消耗
        let c2 = conn.clone();
        let resp = tokio::spawn(async move { c2.request("session/list", json!({})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let req = fake.read().await;
        let id = req["id"].as_u64().unwrap();
        assert_eq!(req["method"], "session/list");
        fake.write(json!({"jsonrpc": "2.0", "id": id, "result": {"ok": true}})).await;
        resp.await.unwrap().unwrap();
    }

    /// 服务端请求进回调并由 Responder 应答。
    #[tokio::test]
    async fn server_request_roundtrip() {
        let (conn, mut fake) = fake_pair();
        fake.write(json!({
            "jsonrpc": "2.0", "id": 7, "method": "elicitation/create",
            "params": {"mode": "form", "message": "Allow tool: write"}
        }))
        .await;
        let resp = fake.read().await;
        assert_eq!(resp["id"], 7);
        assert_eq!(resp["result"]["echo"], "elicitation/create");
        assert!(conn.is_alive());
    }

    /// 读循环断开（对端关闭）：全部等待者收到错误，is_alive 变假。
    #[tokio::test]
    async fn stream_close_fails_waiters_and_marks_dead() {
        let (conn, fake, ) = fake_pair();
        let c2 = conn.clone();
        let pending = tokio::spawn(async move { c2.request("session/prompt", json!({})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        drop(fake); // 模拟子进程退出
        let err = pending.await.unwrap().unwrap_err();
        assert!(err.to_string().contains("ACP_CONNECTION_CLOSED"), "got: {err}");
        assert!(!conn.is_alive());
    }

    /// 服务端错误响应透传 message 与 data.details。
    #[tokio::test]
    async fn error_response_surfaces_details() {
        let (conn, mut fake) = fake_pair();
        let c2 = conn.clone();
        let task = tokio::spawn(async move { c2.request("session/load", json!({"sessionId": "nope"})).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let id = fake.read().await["id"].as_u64().unwrap();
        fake.write(json!({
            "jsonrpc": "2.0", "id": id,
            "error": {"code": -32603, "message": "Internal error",
                      "data": {"details": "ACP session not found: nope"}}
        }))
        .await;
        let err = task.await.unwrap().unwrap_err();
        assert!(err.to_string().contains("ACP session not found: nope"), "got: {err}");
    }
}
