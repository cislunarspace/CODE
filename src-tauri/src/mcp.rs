//! 标准 MCP stdio client：连接 e2m2e `mcp-serve` 子进程（本仓 ADR 0023）。
//!
//! 协议：MCP（JSON-RPC 2.0，stdio 传输，换行分隔 JSON 消息）。只实现
//! agent loop 需要的最小子集：initialize 握手、tools/list、tools/call；
//! tools/call 支持 progressToken（e2m2e 5.9.0 起 server 发
//! notifications/progress，分数制 [0,1] + 可读消息），其余 server
//! notifications 忽略。
//!
//! 与 sidecar（serve-stdio，e2m2e 自有协议、串行单任务）不同：MCP 请求
//! 按 id 多路复用，可并发在飞；e2m2e 服务端把同步计算丢线程池，因此
//! AI 的只读查询不阻塞 GUI 正在跑的计算。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

#[cfg(windows)]
use crate::job;

/// initialize 握手提议的协议版本；服务端回它支持的版本，不强制相等。
const PROTOCOL_VERSION: &str = "2025-06-18";

/// initialize / tools/list 的响应超时（tools/call 不限时：用户确认过的
/// 长计算可达分钟级，与 serve-stdio 链路行为一致）。
const CONTROL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// 工具调用的进度回调（notifications/progress 的路由目标）：进度分数
/// [0, 1] 与可读消息。进度令牌复用请求 id（io_loop 据此分发）。
pub type ProgressSink = Arc<dyn Fn(f64, Option<String>) + Send + Sync>;

enum Cmd {
    Request {
        id: u64,
        method: String,
        params: Value,
        progress: Option<ProgressSink>,
        reply: oneshot::Sender<anyhow::Result<Value>>,
    },
}

/// MCP 子进程句柄。克隆便宜（内部全是 Arc/通道）；进程随最后一份句柄
/// drop 被 kill_on_drop 终止。Windows 生命周期兜底见 [`crate::job`]。
#[derive(Clone)]
pub struct McpHandle {
    tx: mpsc::UnboundedSender<Cmd>,
    next_id: Arc<AtomicU64>,
    child: Arc<Mutex<Option<Child>>>,
    #[cfg(windows)]
    _job: Option<Arc<job::JobHandle>>,
}

/// tools/call 的解析结果：e2m2e 信封（{status, data, error, meta}）以
/// TextContent(JSON) 形式返回，此处保留原文，摘要投影在 assistant 层做。
#[derive(Debug)]
pub struct ToolCallOutcome {
    pub is_error: bool,
    /// content 里全部 text 片段拼接（通常只有一个，是信封 JSON 文本）。
    pub text: String,
}

impl McpHandle {
    /// 拉起 mcp-serve 子进程（stderr 继承到终端，便于排障）。拉起策略
    /// （dev uv / 分发打包产物）由调用方决定，与 sidecar 同一约定。
    pub fn spawn(command: &[&str], cwd: Option<&std::path::Path>) -> anyhow::Result<Self> {
        let mut cmd = Command::new(command[0]);
        cmd.args(&command[1..])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        let mut child = cmd.spawn()?;
        #[cfg(windows)]
        let job_handle = job::assign_tree_to_kill_on_close_job(&mut child);
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");

        let (tx, rx) = mpsc::unbounded_channel();
        let child = Arc::new(Mutex::new(Some(child)));
        tokio::spawn(io_loop(stdout, stdin, rx));
        tokio::spawn(reaper(Arc::clone(&child)));

        Ok(Self {
            tx,
            next_id: Arc::new(AtomicU64::new(1)),
            child,
            #[cfg(windows)]
            _job: job_handle,
        })
    }

    /// 发一个 JSON-RPC 请求并等响应（按 id 多路复用，可并发）。带
    /// progress 时把请求 id 兼作 progressToken 写进 `_meta`，通知按其
    /// 路由回本请求的 sink。
    async fn request(
        &self,
        method: &str,
        mut params: Value,
        progress: Option<ProgressSink>,
    ) -> anyhow::Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        if progress.is_some() {
            params["_meta"] = json!({"progressToken": id});
        }
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(Cmd::Request {
                id,
                method: method.to_string(),
                params,
                progress,
                reply: reply_tx,
            })
            .map_err(|_| anyhow::anyhow!("mcp-serve 读循环已退出（子进程可能已崩溃）"))?;
        reply_rx
            .await
            .map_err(|_| anyhow::anyhow!("mcp-serve 子进程提前退出"))?
    }

    /// 控制面请求（initialize/tools/list）：带超时，挂死不应拖住 agent loop。
    async fn control_request(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        tokio::time::timeout(CONTROL_TIMEOUT, self.request(method, params, None))
            .await
            .map_err(|_| anyhow::anyhow!("mcp-serve {method} 响应超时"))?
    }

    /// MCP 握手：initialize + notifications/initialized。
    pub async fn initialize(&self) -> anyhow::Result<()> {
        let result = self
            .control_request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "cislunar-code", "version": env!("CARGO_PKG_VERSION")},
                }),
            )
            .await?;
        if result.get("protocolVersion").is_none() {
            anyhow::bail!("mcp-serve initialize 响应缺少 protocolVersion");
        }
        // initialized 是 notification（无 id），直接写，不等响应
        self.tx
            .send(Cmd::Request {
                id: 0, // notification：读循环见到 id=0 只写不登记
                method: "notifications/initialized".into(),
                params: json!({}),
                progress: None,
                reply: oneshot::channel().0,
            })
            .map_err(|_| anyhow::anyhow!("mcp-serve 读循环已退出"))?;
        Ok(())
    }

    /// 工具清单（原始 MCP Tool 数组：[{name, description, inputSchema}]）。
    pub async fn list_tools(&self) -> anyhow::Result<Vec<Value>> {
        let result = self.control_request("tools/list", json!({})).await?;
        Ok(result
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    /// 调工具（不限时）。返回服务端 CallToolResult 的文本内容与错误位；
    /// `on_progress` 提供时订阅 notifications/progress（e2m2e 分数制
    /// [0,1] + 可读消息，服务端限流 100 ms 一条）。
    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Value,
        on_progress: Option<ProgressSink>,
    ) -> anyhow::Result<ToolCallOutcome> {
        let result = self
            .request(
                "tools/call",
                json!({"name": name, "arguments": arguments}),
                on_progress,
            )
            .await?;
        let is_error = result
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let text = result
            .get("content")
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|p| p.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        Ok(ToolCallOutcome { is_error, text })
    }

    /// 读循环是否仍在运行（探活：死句柄判定）。
    pub fn is_alive(&self) -> bool {
        !self.tx.is_closed()
    }

    /// 终止子进程（与 reaper 竞争所有权，同 sidecar 语义）。
    pub async fn shutdown(&self) -> anyhow::Result<()> {
        if let Some(mut child) = self.child.lock().await.take() {
            child.start_kill()?;
            let _ = child.wait().await;
        }
        Ok(())
    }
}

/// IO 循环：stdout 按行解析 JSON-RPC 响应路由给等待者；stdin 串行写出。
/// 响应乱序到达（服务端线程池并发），按 id 分发；notifications/progress
/// 按 progressToken（= 请求 id）转发给该请求的 sink，其余通知忽略。
async fn io_loop(
    stdout: tokio::process::ChildStdout,
    stdin: ChildStdin,
    mut rx: mpsc::UnboundedReceiver<Cmd>,
) {
    let mut lines = BufReader::new(stdout).lines();
    let mut stdin = BufWriter::new(stdin);
    let mut pending: HashMap<u64, oneshot::Sender<anyhow::Result<Value>>> = HashMap::new();
    let mut progress_sinks: HashMap<u64, ProgressSink> = HashMap::new();

    loop {
        tokio::select! {
            cmd = rx.recv() => {
                match cmd {
                    Some(Cmd::Request { id, method, params, progress, reply }) => {
                        // notification（id=0）：不写 id 字段，不登记等待
                        let msg = if id == 0 {
                            json!({"jsonrpc": "2.0", "method": method, "params": params})
                        } else {
                            pending.insert(id, reply);
                            if let Some(sink) = progress {
                                progress_sinks.insert(id, sink);
                            }
                            json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
                        };
                        let mut text = match serde_json::to_string(&msg) {
                            Ok(t) => t,
                            Err(e) => {
                                if let Some(tx) = pending.remove(&id) {
                                    let _ = tx.send(Err(anyhow::anyhow!("请求序列化失败：{e}")));
                                }
                                continue;
                            }
                        };
                        text.push('\n');
                        if stdin.write_all(text.as_bytes()).await.is_err()
                            || stdin.flush().await.is_err()
                        {
                            if let Some(tx) = pending.remove(&id) {
                                let _ = tx.send(Err(anyhow::anyhow!("写请求失败（子进程可能已退出）")));
                            }
                            break;
                        }
                    }
                    None => break, // 所有句柄已 drop
                }
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        let v: Value = match serde_json::from_str(&text) {
                            Ok(v) => v,
                            Err(_) => continue, // 非 JSON 行（前向兼容/噪声）：跳过
                        };
                        // 通知（无 id 或带 method）：notifications/progress
                        // 按 progressToken 转发（e2m2e 5.9.0+）；其余忽略。
                        if v.get("method").is_some() {
                            if v.get("method").and_then(Value::as_str)
                                == Some("notifications/progress")
                            {
                                let params = v.get("params").cloned().unwrap_or(Value::Null);
                                if let Some(token) =
                                    params.get("progressToken").and_then(Value::as_u64)
                                {
                                    if let Some(sink) = progress_sinks.get(&token) {
                                        let frac = params
                                            .get("progress")
                                            .and_then(Value::as_f64)
                                            .unwrap_or(0.0);
                                        let message = params
                                            .get("message")
                                            .and_then(Value::as_str)
                                            .map(String::from);
                                        sink(frac, message);
                                    }
                                }
                            }
                            continue;
                        }
                        // 响应：有 id 且带 result/error
                        let Some(id) = v.get("id").and_then(Value::as_u64) else { continue };
                        progress_sinks.remove(&id);
                        if let Some(tx) = pending.remove(&id) {
                            if let Some(err) = v.get("error") {
                                let message = err.get("message").and_then(Value::as_str).unwrap_or("未知 MCP 错误");
                                let code = err.get("code").and_then(Value::as_i64).unwrap_or(0);
                                let _ = tx.send(Err(anyhow::anyhow!("MCP 错误 {code}：{message}")));
                            } else {
                                let _ = tx.send(Ok(v.get("result").cloned().unwrap_or(Value::Null)));
                            }
                        }
                    }
                    Ok(None) | Err(_) => break, // EOF / IO 错误：子进程已死
                }
            }
        }
    }
    // 循环退出（子进程死/句柄尽）：唤醒全部等待者走自愈路径
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err(anyhow::anyhow!("MCP_EXIT")));
    }
}

/// 子进程退出收割（避免僵尸）：取走 Child 所有权再等，不长期持锁。
async fn reaper(child: Arc<Mutex<Option<Child>>>) {
    let taken = child.lock().await.take();
    if let Some(mut child) = taken {
        let _ = child.wait().await;
    }
}

/// 全局唯一的 mcp-serve 拉起配置（setup 时写入一次）。
static SPAWN_CONFIG: OnceLock<(Vec<String>, Option<String>)> = OnceLock::new();

/// mcp-serve 懒初始化句柄容器（与 SidecarState 同型：懒拉起 + 崩溃重建）。
pub struct McpState {
    handle: Mutex<Option<McpHandle>>,
}

impl McpState {
    pub fn new() -> Self {
        Self { handle: Mutex::new(None) }
    }

    /// 注册拉起配置（app setup 阶段调用一次；重复调用保持首次值）。
    pub fn configure(command: Vec<String>, cwd: Option<String>) {
        let _ = SPAWN_CONFIG.set((command, cwd));
    }

    /// 取当前 mcp-serve，没有则拉起并完成 MCP 握手。已死进程自动重建。
    pub async fn get_or_spawn(&self) -> anyhow::Result<McpHandle> {
        let mut guard = self.handle.lock().await;
        if let Some(h) = guard.as_ref() {
            if h.is_alive() {
                return Ok(h.clone());
            }
        }
        let (cmd, cwd) = SPAWN_CONFIG.get().expect("setup 未注册 mcp-serve 拉起配置");
        let cmd_refs: Vec<&str> = cmd.iter().map(String::as_str).collect();
        let h = McpHandle::spawn(&cmd_refs, cwd.as_deref().map(std::path::Path::new))?;
        if let Err(e) = h.initialize().await {
            let _ = h.shutdown().await;
            return Err(e);
        }
        *guard = Some(h.clone());
        Ok(h)
    }

    /// 丢弃当前句柄（崩溃后重建用）。
    pub async fn reset(&self) {
        *self.handle.lock().await = None;
    }
}

/// 工具调用 + 崩溃自愈重试一次（与 sidecar 的 request_with_retry 同策略：
/// 死句柄/进程退出先 reset 再重拉；再失败上抛）。`on_progress` 透传给
/// 两次尝试（重试期间进度照发）。
pub async fn call_tool_with_retry(
    state: &McpState,
    name: &str,
    arguments: Value,
    on_progress: Option<ProgressSink>,
) -> anyhow::Result<ToolCallOutcome> {
    let handle = state.get_or_spawn().await?;
    match handle.call_tool(name, arguments.clone(), on_progress.clone()).await {
        Ok(out) => Ok(out),
        Err(e) => {
            state.reset().await;
            let handle = state.get_or_spawn().await?;
            handle.call_tool(name, arguments, on_progress).await.map_err(|_| e)
        }
    }
}

/// 工具清单 + 崩溃自愈重试一次。
pub async fn list_tools_with_retry(state: &McpState) -> anyhow::Result<Vec<Value>> {
    let handle = state.get_or_spawn().await?;
    match handle.list_tools().await {
        Ok(tools) => Ok(tools),
        Err(e) => {
            state.reset().await;
            let handle = state.get_or_spawn().await?;
            handle.list_tools().await.map_err(|_| e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// JSON-RPC 响应路由：乱序响应按 id 各归各家。
    /// （纯解析逻辑测试，不起进程：进程级冒烟在 assistant 集成测试里。）
    #[test]
    fn response_routing_extracts_result_by_id() {
        let ok: Value = serde_json::from_str(r#"{"jsonrpc":"2.0","id":3,"result":{"tools":[]}}"#).unwrap();
        assert_eq!(ok.get("id").and_then(Value::as_u64), Some(3));
        assert!(ok.get("result").is_some());
        let err: Value = serde_json::from_str(r#"{"jsonrpc":"2.0","id":4,"error":{"code":-32601,"message":"Method not found"}}"#).unwrap();
        assert!(err.get("error").is_some());
        // notification：无 id，不入路由
        let note: Value = serde_json::from_str(r#"{"jsonrpc":"2.0","method":"notifications/message","params":{}}"#).unwrap();
        assert!(note.get("id").is_none());
    }

    /// notifications/progress 携带 progressToken/progress/message——io_loop
    /// 按 token（= 请求 id）路由、取分数与消息的解析依据。
    #[test]
    fn progress_notification_carries_token_fraction_message() {
        let note: Value = serde_json::from_str(
            r#"{"jsonrpc":"2.0","method":"notifications/progress",
                "params":{"progressToken":7,"progress":0.42,"total":1.0,"message":"designing"}}"#,
        )
        .unwrap();
        assert_eq!(
            note.get("method").and_then(Value::as_str),
            Some("notifications/progress")
        );
        let params = note.get("params").unwrap();
        assert_eq!(params.get("progressToken").and_then(Value::as_u64), Some(7));
        assert!((params.get("progress").and_then(Value::as_f64).unwrap() - 0.42).abs() < 1e-9);
        assert_eq!(params.get("message").and_then(Value::as_str), Some("designing"));
    }
}
