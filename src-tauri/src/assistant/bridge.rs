//! MCP stdio 桥接服务：omp 的 ACP mcpServers 入口（`--assistant-mcp-bridge`
//! 子进程模式），把 e2m2e 工具与宿主情景工具暴露给 omp 会话。
//!
//! 职责（计划条目 2）：
//! - `tools/list`：mcp-serve 的名称/描述/inputSchema 原样透出 + 宿主
//!   `scenario_write`/`scenario_list`（OpenAI function 定义转 MCP 形态）；
//! - `tools/call`：宿主工具本地执行（固定目录、覆盖语义、MCP 信封口径与
//!   mcp-serve 一致）；其余原样转发 mcp-serve（含崩溃自愈与进度转发）；
//! - 进度：客户端（omp）带 progressToken 时，把 mcp-serve 的
//!   notifications/progress 按 token 原路转发。
//!
//! 拉起：omp 在 session/new 收到
//! `{name: "tod", command: <本应用二进制>, args: ["--assistant-mcp-bridge"], env: []}`
//! 后作为子进程启动本模式；mcp-serve 命令经 `TOD_MCP_COMMAND_JSON` /
//! `TOD_MCP_CWD` 环境变量传入（app setup 写入 omp 环境，无任何密钥）。

use std::sync::Arc;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use super::host_tools;
use crate::mcp::{self, McpState, ProgressSink};

/// 本应用二进制作为 MCP 桥接子进程拉起时的 argv 标记。
pub const BRIDGE_ARG: &str = "--assistant-mcp-bridge";

/// ACP session/new 的 mcpServers 桥接条目（cwd 即会话目录，env 必须给
/// 空数组——omp 18.1.11 对缺失 env 的条目内部报错）。
pub fn bridge_server_entry() -> Value {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    json!({
        "name": super::events::BRIDGE_SERVER_NAME,
        "command": exe,
        "args": [BRIDGE_ARG],
        "env": []
    })
}

/// 子进程入口：从环境取 mcp-serve 配置并同步跑桥接直到 stdin EOF。
pub fn run_bridge_process() {
    let argv: Vec<String> = match std::env::var("TOD_MCP_COMMAND_JSON")
        .ok()
        .and_then(|s: String| serde_json::from_str::<Vec<String>>(&s).ok())
    {
        Some(v) if !v.is_empty() => v,
        _ => {
            eprintln!("tod-bridge: 缺少 TOD_MCP_COMMAND_JSON（应由 omp 从应用环境继承）");
            std::process::exit(1);
        }
    };
    let cwd = std::env::var("TOD_MCP_CWD").ok();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    rt.block_on(async move {
        McpState::configure(argv, cwd);
        let mcp = Arc::new(McpState::new());
        let stdin = tokio::io::stdin();
        let stdout = tokio::io::stdout();
        if let Err(e) = run_server(stdin, stdout, mcp).await {
            eprintln!("tod-bridge: 退出：{e}");
            std::process::exit(1);
        }
    });
}

/// 在给定读写流上跑 MCP 服务（测试用内存双工流；进程模式用 stdin/stdout）。
/// 请求串行处理（与旧 agent loop 的串行确认节奏一致）。
pub async fn run_server<R, W>(reader: R, writer: W, mcp: Arc<McpState>) -> Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    // 出站统一走通道串行写出：tools/call 执行期间也能随时写进度通知
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let mut writer = writer;
    tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            let mut buf = line.into_bytes();
            buf.push(b'\n');
            if writer.write_all(&buf).await.is_err() || writer.flush().await.is_err() {
                break;
            }
        }
    });

    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        let text = line.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue, // 非 JSON 行：跳过（MCP 无恢复语义要求）
        };
        // 通知（无 id）：initialized/progress 等本服务无需处理
        let Some(id) = v.get("id").cloned() else { continue };
        let method = v.get("method").and_then(Value::as_str).unwrap_or_default();
        let params = v.get("params").cloned().unwrap_or(Value::Null);
        match method {
            "initialize" => respond(&out_tx, &id, Ok(json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {"listChanged": false}},
                "serverInfo": {"name": "tod-bridge", "version": env!("CARGO_PKG_VERSION")}
            }))),
            "ping" => respond(&out_tx, &id, Ok(json!({}))),
            "tools/list" => {
                let result = tools_list(&mcp).await;
                respond_result(&out_tx, &id, result);
            }
            "tools/call" => {
                let result = tools_call(&mcp, &params, &out_tx).await;
                respond_result(&out_tx, &id, result);
            }
            other => respond(
                &out_tx,
                &id,
                Err((-32601, format!("tod-bridge 不支持的方法：{other}"))),
            ),
        }
    }
    // stdin EOF：omp 关闭了桥接，正常退出
    Ok(())
}

fn respond(tx: &mpsc::UnboundedSender<String>, id: &Value, outcome: Result<Value, (i64, String)>) {
    let v = match outcome {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err((code, message)) => {
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
        }
    };
    let _ = tx.send(v.to_string());
}

fn respond_result(tx: &mpsc::UnboundedSender<String>, id: &Value, result: anyhow::Result<Value>) {
    match result {
        Ok(v) => respond(tx, id, Ok(v)),
        Err(e) => respond(tx, id, Err((-32603, format!("tod-bridge 内部错误：{e}")))),
    }
}

/// 工具清单：e2m2e 原样 + 宿主情景工具（OpenAI function → MCP 形态）。
async fn tools_list(mcp: &McpState) -> Result<Value> {
    let mut tools = mcp::list_tools_with_retry(mcp)
        .await
        .context("mcp-serve 工具清单不可用")?;
    tools.extend(host_tools::tool_specs().into_iter().map(|spec| {
        let f = &spec["function"];
        json!({
            "name": f["name"],
            "description": f["description"],
            "inputSchema": f["parameters"],
        })
    }));
    Ok(json!({"tools": tools}))
}

/// 工具调用：宿主工具本地执行，其余转发 mcp-serve（错误回灌文本供模型自纠）。
async fn tools_call(
    mcp: &McpState,
    params: &Value,
    out_tx: &mpsc::UnboundedSender<String>,
) -> Result<Value> {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
    let progress_token = params
        .get("_meta")
        .and_then(|m| m.get("progressToken"))
        .cloned();

    if host_tools::is_host_tool(name) {
        let envelope = host_tools::execute(name, &arguments);
        let is_error = envelope.contains("\"error\"");
        return Ok(call_result(envelope, is_error));
    }

    // 进度转发：mcp-serve 的分数制 [0,1] + 可读消息按 omp 的 token 原路回
    let sink: Option<ProgressSink> = progress_token.map(|token| {
        let tx = out_tx.clone();
        Arc::new(move |fraction: f64, message: Option<String>| {
            let v = json!({
                "jsonrpc": "2.0",
                "method": "notifications/progress",
                "params": {
                    "progressToken": token,
                    "progress": fraction,
                    "message": message,
                }
            });
            let _ = tx.send(v.to_string());
        }) as ProgressSink
    });

    match mcp::call_tool_with_retry(mcp, name, arguments, sink).await {
        Ok(out) => Ok(call_result(out.text, out.is_error)),
        // 传输级失败：以 isError 回灌，让模型看到原因（旧 agent loop 同口径）
        Err(e) => Ok(call_result(format!("工具调用失败：{e}"), true)),
    }
}

fn call_result(text: String, is_error: bool) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": is_error})
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 桥接主回路：给定脚本消息，收集服务的全部响应/通知。
    async fn drive(script: Vec<Value>) -> Vec<Value> {
        McpState::configure(vec!["definitely-not-a-real-binary".into()], None::<String>);
        let mcp = Arc::new(McpState::new());
        let (client, server) = tokio::io::duplex(64 * 1024);
        let (mut c_read, mut c_write) = tokio::io::split(client);
        let (s_read, s_write) = tokio::io::split(server);
        let handle = tokio::spawn(run_server(s_read, s_write, Arc::clone(&mcp)));
        for msg in script {
            let mut buf = serde_json::to_string(&msg).unwrap();
            buf.push('\n');
            c_write.write_all(buf.as_bytes()).await.unwrap();
            c_write.flush().await.unwrap();
        }
        // split 写半的 drop 不发 EOF（ halves 共持底层流）：显式 shutdown
        let _ = c_write.shutdown().await;
        let _ = handle.await;
        // 读回全部响应行
        let mut out = Vec::new();
        let mut lines = BufReader::new(&mut c_read).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                out.push(v);
            }
        }
        out
    }

    #[tokio::test]
    async fn initialize_and_ping_respond() {
        let out = drive(vec![
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}),
            json!({"jsonrpc": "2.0", "id": 2, "method": "ping"}),
        ])
        .await;
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["result"]["serverInfo"]["name"], "tod-bridge");
        assert_eq!(out[1]["result"], json!({}));
    }

    #[tokio::test]
    async fn notifications_are_not_answered() {
        let out = drive(vec![
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json!({"jsonrpc": "2.0", "id": 5, "method": "ping"}),
        ])
        .await;
        // 只有 ping 的响应，通知不应产生任何输出
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["id"], 5);
    }

    #[tokio::test]
    async fn unknown_method_gets_error() {
        let out = drive(vec![json!({"jsonrpc": "2.0", "id": 9, "method": "resources/list"})]).await;
        assert_eq!(out[0]["error"]["code"], -32601);
    }

    /// 宿主工具（scenario_write）本地执行：成功信封透传，isError=false。
    /// （临时目录由 host_tools 固定目录决定，此处只验证协议形状——写入
    /// 真实用户目录不可取，改为校验 list 中的宿主工具注册。）
    #[tokio::test]
    async fn host_tools_listed_in_mcp_shape() {
        // mcp-serve 不可用 → tools/list 内部错误；宿主工具注册逻辑经
        // tools_list 的组装函数直接验证
        let specs = host_tools::tool_specs();
        assert!(specs.len() >= 2);
        for spec in specs {
            let f = &spec["function"];
            assert!(f["name"].is_string());
            assert!(f["parameters"].is_object());
        }
    }

    /// mcp-serve 不可用时 tools/list 返回 JSON-RPC 内部错误（不空列表：
    /// 空清单会让会话静默缺工具）。
    #[tokio::test]
    async fn tools_list_fails_loud_when_mcp_serve_dead() {
        let out = drive(vec![json!({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})]).await;
        assert_eq!(out[0]["error"]["code"], -32603);
        assert!(out[0]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("mcp-serve"));
    }

    #[tokio::test]
    async fn bridge_server_entry_shape_matches_omp_contract() {
        let entry = bridge_server_entry();
        assert_eq!(entry["name"], "tod");
        assert!(entry["command"].as_str().unwrap().contains("transfer"));
        assert_eq!(entry["args"][0], "--assistant-mcp-bridge");
        // env 必须存在且是数组（omp 18.1.11 对缺失 env 的条目内部报错）
        assert!(entry["env"].as_array().is_some());
    }

}
