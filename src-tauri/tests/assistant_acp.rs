//! AssistantState 对真实子进程的 ACP 集成测试（fake omp 驱动）。
//!
//! 覆盖计划验证条目 2 的进程级面：session new/load（回放）/cancel、
//! 审批请求/响应（Approve/Deny）、子进程退出重连、会话列表过滤、
//! 未知通知忽略、未知请求回错。工具桥接的进程级面在 bridge.rs 单测与
//! scripts/smoke_omp_acp.py 冒烟里覆盖。
//!
//! 依赖：python3（fake 服务端脚本）。单测试函数串行推进——
//! AssistantState 的事件发射器与 OmpState 配置是进程级单例，并行用例
//! 会互踩。

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc;

use transfer_orbit_design_lib::assistant::{set_emitter, AssistantState};

fn fixture() -> String {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_omp_acp.py");
    dir.to_string_lossy().into_owned()
}

async fn next_event(rx: &mut mpsc::UnboundedReceiver<Value>) -> Value {
    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("10s 内应有事件")
        .expect("发射器不应关闭")
}

async fn wait_kind(rx: &mut mpsc::UnboundedReceiver<Value>, kind: &str) -> Value {
    loop {
        let ev = next_event(rx).await;
        if ev["kind"] == kind {
            return ev;
        }
    }
}

/// 推进一个 future（如 send）直到完成，期间到达的事件交给回调。
/// 审批确认是同步方法（resolve_confirm），可在回调里即时落定。
async fn drive_with<F, T>(mut fut: F, rx: &mut mpsc::UnboundedReceiver<Value>, mut on_event: impl FnMut(Value)) -> T
where
    F: Future<Output = T> + Unpin,
{
    loop {
        tokio::select! {
            out = &mut fut => return out,
            ev = rx.recv() => {
                if let Some(ev) = ev {
                    on_event(ev);
                }
            }
        }
    }
}

/// 交替推进 send 与事件：直到出现目标 kind 的事件或 send 完成。
/// 返回 (是否见到目标事件, send 的剩余 future)——调用方可在中途回调
/// 异步操作（cancel/门禁探测），再续等 future。
async fn until_kind_or_done<'a, F>(
    mut fut: std::pin::Pin<&'a mut F>,
    rx: &mut mpsc::UnboundedReceiver<Value>,
    kind: &str,
) -> (bool, std::pin::Pin<&'a mut F>)
where
    F: Future,
{
    loop {
        tokio::select! {
            _ = &mut fut => return (false, fut),
            ev = rx.recv() => {
                if let Some(ev) = ev {
                    if ev["kind"] == kind {
                        return (true, fut);
                    }
                }
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn acp_lifecycle_over_fake_process() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    set_emitter(Arc::new(move |v: &Value| {
        let _ = tx.send(v.clone());
    }));

    // 工作目录（overlay 落盘 + 会话 cwd 过滤用）
    let cwd = std::env::temp_dir().join(format!("tod-acp-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&cwd);
    std::fs::create_dir_all(&cwd).unwrap();
    transfer_orbit_design_lib::assistant::omp::OmpState::configure(
        vec!["python3".into(), fixture()],
        cwd.clone(),
    );

    let state = AssistantState::new();

    // --- 1. 首条消息懒建会话：thinking/delta/message_done ---
    state.send("你好", None).await.expect("首轮发送");
    let think = wait_kind(&mut rx, "thinking").await;
    assert_eq!(think["text"], "想一下");
    let delta = wait_kind(&mut rx, "delta").await;
    assert!(delta["text"].as_str().unwrap().contains("收到"));
    let done = wait_kind(&mut rx, "message_done").await;
    assert_eq!(done["usage"]["total_tokens"], 100);
    let sid1 = state.current_session().expect("会话已建立");
    assert!(sid1.starts_with("fake-"));

    // 会话索引：fake-1 在列，别的 cwd（other-9）被过滤
    let sessions = state.sessions();
    assert!(sessions.iter().any(|s| s["id"] == "fake-1"), "列表：{sessions:?}");
    assert!(sessions.iter().all(|s| s["id"] != "other-9"));

    // --- 2. 写工具审批：tool_proposed → 确认 → tool_done(摘要) ---
    // 事件由 drive_with 期间收集（收发与 send 并行推进，不能事后重读 rx）
    let mut seen: Vec<Value> = Vec::new();
    let mut key: Option<String> = None;
    let state_ref = &state;
    drive_with(
        Box::pin(state.send("TOOL: scenario_write", None)),
        &mut rx,
        |ev| {
            if ev["kind"] == "tool_proposed" {
                assert_eq!(ev["tool"], "scenario_write");
                assert_eq!(ev["arguments"]["filename"], "demo");
                assert!(state_ref.resolve_confirm(ev["callId"].as_str().unwrap(), true));
                key = Some(ev["callId"].as_str().unwrap().to_string());
            }
            if ev["kind"] == "tool_done" {
                // 终态事件回填工具名（产物登记契约：recordId 与 tool 配对）
                assert_eq!(ev["tool"], "scenario_write", "终态事件应带工具名：{ev}");
            }
            seen.push(ev);
        },
    )
    .await
    .expect("审批轮发送完成");
    let key = key.expect("审批轮应产出 tool_proposed");
    assert!(
        seen.iter().any(|e| e["kind"] == "tool_done" && e["ok"] == true
            && e["summary"]["recordId"] == "rec-1"),
        "Approve 应产出完成态卡片：{seen:?}"
    );
    assert!(seen.iter().any(|e| e["kind"] == "message_done"), "应有终态：{seen:?}");
    // 已消费的审批键再确认返回 false（重复点击）
    assert!(!state.resolve_confirm(&key, true));

    // --- 3. 拒绝路径：Deny → tool_done ok=false ---
    let mut seen: Vec<Value> = Vec::new();
    let state_ref = &state;
    drive_with(
        Box::pin(state.send("TOOL: cr3bp_compute", None)),
        &mut rx,
        |ev| {
            if ev["kind"] == "tool_proposed" {
                assert!(state_ref.resolve_confirm(ev["callId"].as_str().unwrap(), false));
            }
            seen.push(ev);
        },
    )
    .await
    .unwrap();
    assert!(
        seen.iter().any(|e| e["kind"] == "tool_done" && e["ok"] == false),
        "Deny 应产出失败态卡片：{seen:?}"
    );
    assert!(seen.iter().any(|e| e["kind"] == "message_done"));

    // --- 4. 中断：session/cancel → interrupted ---
    let send_fut = state.send("CANCEL: 慢慢数", None);
    tokio::pin!(send_fut);
    let (saw_delta, send_fut) = until_kind_or_done(send_fut, &mut rx, "delta").await;
    assert!(saw_delta, "中断前应有输出");
    assert!(state.request_cancel().await, "运行中应返回 true");
    send_fut.await.unwrap();
    let interrupted = wait_kind(&mut rx, "interrupted").await;
    assert_eq!(interrupted["kind"], "interrupted");

    // --- 5a. 首次打开的会话：session/load 回放重建（用户气泡/正文/卡片） ---
    state.switch_session("fake-77").await.expect("切换");
    let reset = wait_kind(&mut rx, "reset").await;
    assert_eq!(reset["kind"], "reset");
    let user = wait_kind(&mut rx, "user_message").await;
    assert!(user["text"].as_str().unwrap().contains("回放：最早的问题"), "got {user}");
    let replay_delta = wait_kind(&mut rx, "delta").await;
    assert!(replay_delta["text"].as_str().unwrap().contains("回放：最早的回答"));
    let replay_done = wait_kind(&mut rx, "tool_done").await;
    assert_eq!(replay_done["summary"]["recordId"], "rec-replay");
    assert_eq!(replay_done["tool"], "catalog_query", "回放终态应带工具名");
    assert_eq!(state.current_session().as_deref(), Some("fake-77"));

    // --- 5b. 本进程内会话：事件日志重放（含用户气泡；不走 omp 回放） ---
    state.switch_session(&sid1).await.expect("切回");
    wait_kind(&mut rx, "reset").await;
    let user = wait_kind(&mut rx, "user_message").await;
    assert_eq!(user["text"], "你好", "日志重放应含用户气泡：{user}");
    assert_eq!(state.current_session().as_deref(), Some(sid1.as_str()));

    // --- 5c. 缓存重放隔离：切走再切回，别的会话事件不串入、日志不翻倍 ---
    // 5b 的 wait_kind 只消费到第一条用户气泡，通道可能还有遗留——断言
    // 只针对本次重放段（最后一个 reset 之后）。
    let mut seen: Vec<Value> = Vec::new();
    drive_with(
        Box::pin(state.switch_session("fake-77")),
        &mut rx,
        |ev| seen.push(ev),
    )
    .await
    .expect("二次切换 fake-77");
    let replay_start = seen
        .iter()
        .rposition(|e| e["kind"] == "reset")
        .expect("缓存重放应以 reset 开头");
    let replay = &seen[replay_start + 1..];
    let user_msgs: Vec<&Value> = replay.iter().filter(|e| e["kind"] == "user_message").collect();
    assert_eq!(user_msgs.len(), 1, "缓存重放应只有一条用户气泡：{seen:?}");
    assert_eq!(user_msgs[0]["text"], "回放：最早的问题");
    assert!(
        !replay.iter().any(|e| e["kind"] == "user_message" && e["text"] == "你好"),
        "fake-1 的事件不得串入 fake-77 的重放：{seen:?}"
    );

    // --- 5d. 切换失败：报错并恢复原会话显示（session id 不变） ---
    let before_fail = state.current_session().expect("当前会话");
    state.switch_session("fail-load").await.expect_err("损坏会话应报错");
    assert_eq!(state.current_session().as_deref(), Some(before_fail.as_str()), "失败后 session id 不变");
    let restored = wait_kind(&mut rx, "user_message").await;
    assert_eq!(restored["text"], "回放：最早的问题", "失败后应重放恢复原会话显示");

    // --- 6. 清空 = 新建（omp 无 reset 能力时的落位） ---
    let sid_before = state.current_session().unwrap();
    state.clear_history().await.expect("清空");
    assert_ne!(sid_before, state.current_session().unwrap(), "清空应换新会话");

    // --- 7. 思考等级：三档映射 + configOptions 回读；非法档位报错 ---
    state.set_thinking_level("deep").await.expect("设思考档");
    assert_eq!(state.thinking_level(), "deep");
    state.set_thinking_level("bogus").await.expect_err("非法档位应报错");

    // --- 8. 子进程退出重连：会话 id 保持，静默恢复（无回放噪声） ---
    state.send("EXIT: 立刻退出", None).await.expect("命令本身 Ok");
    let err = wait_kind(&mut rx, "error").await;
    let msg = err["message"].as_str().unwrap_or_default();
    assert!(
        msg.contains("断开") || msg.contains("退出") || msg.contains("ACP") || msg.contains("写入"),
        "重连前错误应指向连接：{msg}"
    );
    state.send("重连后继续", None).await.expect("重连后发送");
    let delta = wait_kind(&mut rx, "delta").await;
    assert!(delta["text"].as_str().unwrap().contains("收到：重连后继续"));
    wait_kind(&mut rx, "message_done").await;

    // --- 9. 门禁：运行中拒绝新建/切换；空闲后恢复 ---
    let send_fut = state.send("CANCEL: 再来一轮", None);
    tokio::pin!(send_fut);
    let (saw_delta, send_fut) = until_kind_or_done(send_fut, &mut rx, "delta").await;
    assert!(saw_delta);
    assert!(state.new_session().await.is_err(), "运行中新建应被门禁拦截");
    assert!(state.switch_session("fake-1").await.is_err());
    assert!(state.request_cancel().await);
    send_fut.await.unwrap();
    wait_kind(&mut rx, "interrupted").await;
    state.new_session().await.expect("空闲后新建可用");

    // 清理
    let _ = std::fs::remove_dir_all(&cwd);
}
