//! AssistantState 对真实子进程的 pi RPC 集成测试（fake pi 驱动）。
//!
//! 覆盖 ADR 0032 的进程级面：prompt 流式事件、审批子协议
//!（extension_ui_request → tool_proposed → extension_ui_response）、
//! abort 中断、steer 引导、会话切换（get_messages 回放）与缓存重放、
//! 子进程退出重连、会话索引目录扫描、配置面。工具桥接的进程级面在
//! bridge.rs 单测与 scripts/smoke_pi_rpc.py 冒烟里覆盖。
//!
//! 依赖：python3（fake 服务端脚本）。单测试函数串行推进——
//! AssistantState 的事件发射器与 PiState 配置是进程级单例，并行用例
//! 会互踩：cargo test -- --test-threads=1。

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc;

use transfer_orbit_design_lib::assistant::{set_emitter, AssistantState};

fn fixture() -> String {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_pi_rpc.py");
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
/// 返回 (是否见到目标事件, send 的剩余 future)。
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
async fn pi_rpc_lifecycle_over_fake_process() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    set_emitter(Arc::new(move |v: &Value| {
        let _ = tx.send(v.clone());
    }));

    // 应用会话目录（PI_CODING_AGENT_SESSION_DIR + 索引扫描目标）
    let session_dir = std::env::temp_dir().join(format!("tod-pi-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&session_dir);
    std::fs::create_dir_all(&session_dir).unwrap();
    transfer_orbit_design_lib::assistant::pi::PiState::configure(
        vec!["python3".into(), fixture()],
        session_dir.clone(),
    );

    let state = AssistantState::new();

    // --- 1. 首条消息懒建会话：thinking/delta/message_done ---
    state.send("你好", None).await.expect("首轮发送");
    let think = wait_kind(&mut rx, "thinking").await;
    assert_eq!(think["text"], "想一下");
    let delta = wait_kind(&mut rx, "delta").await;
    assert!(delta["text"].as_str().unwrap().contains("收到：你好"));
    let done = wait_kind(&mut rx, "message_done").await;
    assert_eq!(done["usage"]["total_tokens"], 100);
    let sid1 = state.current_session().expect("会话已建立");
    assert!(sid1.starts_with("fake-"), "got {sid1}");

    // 会话索引：目录扫描命中本会话与预置的 fake-77，别的不混入
    let sessions = state.sessions();
    assert!(
        sessions.iter().any(|s| s["id"] == sid1),
        "索引应含当前会话：{sessions:?}"
    );
    assert!(sessions.iter().any(|s| s["id"] == "fake-77"));

    // --- 2. 写工具审批：tool_proposed → 确认 → tool_execution 收尾 ---
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
                // 终态事件带工具名（产物登记契约：recordId 与 tool 配对）
                assert_eq!(ev["tool"], "scenario_write", "终态事件应带工具名：{ev}");
            }
            seen.push(ev);
        },
    )
    .await
    .expect("审批轮发送完成");
    let key = key.expect("审批轮应产出 tool_proposed");
    assert!(
        seen.iter().any(|e| e["kind"] == "tool_started" && e["tool"] == "scenario_write"),
        "批准后应进入执行：{seen:?}"
    );
    assert!(
        seen.iter().any(|e| e["kind"] == "tool_done" && e["ok"] == true
            && e["summary"]["recordId"] == "rec-1"),
        "批准应产出完成态卡片：{seen:?}"
    );
    assert!(seen.iter().any(|e| e["kind"] == "message_done"), "应有终态：{seen:?}");
    // 已消费的审批键再确认返回 false（重复点击）
    assert!(!state.resolve_confirm(&key, true));

    // --- 3. 拒绝路径：拒绝 → tool_done ok=false ---
    let mut seen: Vec<Value> = Vec::new();
    let state_ref = &state;
    drive_with(
        Box::pin(state.send("DENYTOOL: cr3bp_compute", None)),
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
        "拒绝应产出失败态卡片：{seen:?}"
    );
    assert!(seen.iter().any(|e| e["kind"] == "message_done"));

    // --- 4. 只读工具免确认：不出审批卡，直接执行完成 ---
    let mut seen: Vec<Value> = Vec::new();
    drive_with(
        Box::pin(state.send("READTOOL: catalog_query", None)),
        &mut rx,
        |ev| seen.push(ev),
    )
    .await
    .expect("只读轮完成");
    assert!(
        !seen.iter().any(|e| e["kind"] == "tool_proposed"),
        "白名单工具不应出审批卡：{seen:?}"
    );
    assert!(
        seen.iter().any(|e| e["kind"] == "tool_done" && e["ok"] == true
            && e["summary"]["recordId"] == "rec-r"),
        "免确认应直接完成：{seen:?}"
    );

    // --- 5. 中断：abort → aborted stopReason → interrupted ---
    let send_fut = state.send("CANCEL: 慢慢数", None);
    tokio::pin!(send_fut);
    let (saw_delta, send_fut) = until_kind_or_done(send_fut, &mut rx, "delta").await;
    assert!(saw_delta, "中断前应有输出");
    assert!(state.request_cancel().await, "运行中应返回 true");
    send_fut.await.unwrap();
    let interrupted = wait_kind(&mut rx, "interrupted").await;
    assert_eq!(interrupted["kind"], "interrupted");

    // --- 6a. 首次打开的会话：get_messages 回放重建（气泡/正文/卡片） ---
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

    // --- 6b. 本进程内会话：事件日志重放（含用户气泡；不走 pi 回放） ---
    state.switch_session(&sid1).await.expect("切回");
    wait_kind(&mut rx, "reset").await;
    let user = wait_kind(&mut rx, "user_message").await;
    assert_eq!(user["text"], "你好", "日志重放应含用户气泡：{user}");
    assert_eq!(state.current_session().as_deref(), Some(sid1.as_str()));

    // --- 6c. 缓存重放隔离：切走再切回，别的会话事件不串入、日志不翻倍 ---
    let mut seen: Vec<Value> = Vec::new();
    drive_with(
        Box::pin(state.switch_session("fake-77")),
        &mut rx,
        |ev| seen.push(ev),
    )
    .await
    .expect("二次切换 fake-77");
    // 缓存重放是同步快路径：future 先于事件消费完成，补抽干缓冲
    while let Ok(ev) = rx.try_recv() {
        seen.push(ev);
    }
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
        "{sid1} 的事件不得串入 fake-77 的重放：{seen:?}"
    );

    // --- 6d. 切换失败：报错并恢复原会话显示（session id 不变） ---
    let before_fail = state.current_session().expect("当前会话");
    state.switch_session("fail-load").await.expect_err("损坏会话应报错");
    assert_eq!(state.current_session().as_deref(), Some(before_fail.as_str()), "失败后 session id 不变");
    let restored = wait_kind(&mut rx, "user_message").await;
    assert_eq!(restored["text"], "回放：最早的问题", "失败后应重放恢复原会话显示");

    // --- 7. 清空 = 新建（pi RPC 无 reset 能力时的落位） ---
    let sid_before = state.current_session().unwrap();
    state.clear_history().await.expect("清空");
    assert_ne!(sid_before, state.current_session().unwrap(), "清空应换新会话");

    // --- 8. 会话配置：model/thinking 下发并回读；非法值报错 ---
    state
        .set_config_option("model", "prov-a/m-1")
        .await
        .expect("设模型");
    let opts = state.config_options();
    let model = opts.iter().find(|o| o["id"] == "model").expect("model 配置项");
    assert_eq!(model["currentValue"], "prov-a/m-1", "模型应生效：{opts:?}");
    let thinking = opts.iter().find(|o| o["id"] == "thinking").expect("thinking 配置项");
    assert!(
        thinking["options"].as_array().unwrap().len() >= 5,
        "思考档应含 pi 原生值域：{opts:?}"
    );
    state
        .set_config_option("model", "no-such-model")
        .await
        .expect_err("非法模型应报错");
    state
        .set_config_option("bogus", "x")
        .await
        .expect_err("未知配置项应报错");

    // --- 9. 引导：生成中再发消息 = steer 排队续跑（上下文保留） ---
    let mut seen: Vec<Value> = Vec::new();
    let f1 = state.send("STEER: 慢慢生成", None);
    tokio::pin!(f1);
    let (saw_thinking, f1) = until_kind_or_done(f1, &mut rx, "thinking").await;
    assert!(saw_thinking, "旧轮应在跑");
    let f2 = state.send("STEERED: 改用新约束", None);
    tokio::pin!(f2);
    drive_with(f2, &mut rx, |ev| seen.push(ev)).await.expect("引导轮完成");
    drive_with(f1, &mut rx, |ev| seen.push(ev)).await.expect("旧轮收尾");
    assert!(
        seen.iter().any(|e| e["kind"] == "user_message" && e["text"] == "STEERED: 改用新约束"),
        "引导气泡应出现：{seen:?}"
    );
    assert!(
        seen.iter().any(|e| e["kind"] == "delta"
            && e["text"].as_str().unwrap_or("").contains("STEERED")),
        "引导轮应流式输出：{seen:?}"
    );
    assert!(
        !seen.iter().any(|e| e["kind"] == "interrupted"),
        "pi steer 不取消轮次，不应出 interrupted 标记：{seen:?}"
    );

    // --- 10. 引导时挂起审批的收尾：卡片落失败态，不进确认 ---
    let mut seen: Vec<Value> = Vec::new();
    let f1 = state.send("TOOL: scenario_write", None);
    tokio::pin!(f1);
    let (saw_card, f1) = until_kind_or_done(f1, &mut rx, "tool_proposed").await;
    assert!(saw_card, "应有审批卡片");
    // 不确认，直接引导
    let f2 = state.send("STEERED: 换方向", None);
    tokio::pin!(f2);
    drive_with(f2, &mut rx, |ev| seen.push(ev)).await.expect("引导轮完成");
    drive_with(f1, &mut rx, |ev| seen.push(ev)).await.expect("旧轮收尾");
    assert!(
        seen.iter().any(|e| e["kind"] == "tool_done" && e["ok"] == false),
        "挂起卡片应收尾为失败态：{seen:?}"
    );

    // --- 11. 子进程退出重连：会话 id 保持，静默恢复（无回放噪声） ---
    state.send("EXIT: 立刻退出", None).await.expect("命令本身 Ok");
    let err = wait_kind(&mut rx, "error").await;
    let msg = err["message"].as_str().unwrap_or_default();
    assert!(
        msg.contains("断开") || msg.contains("RPC"),
        "重连前错误应指向连接：{msg}"
    );
    state.send("重连后继续", None).await.expect("重连后发送");
    let delta = wait_kind(&mut rx, "delta").await;
    assert!(delta["text"].as_str().unwrap().contains("收到：重连后继续"));
    wait_kind(&mut rx, "message_done").await;

    // --- 12. 门禁：运行中拒绝新建/切换；空闲后恢复 ---
    let send_fut = state.send("CANCEL: 再来一轮", None);
    tokio::pin!(send_fut);
    let (saw_delta, send_fut) = until_kind_or_done(send_fut, &mut rx, "delta").await;
    assert!(saw_delta);
    assert!(state.new_session().await.is_err(), "运行中新建应被门禁拦截");
    let sid_now = state.current_session().unwrap();
    assert!(state.switch_session(&sid_now).await.is_err());
    assert!(state.request_cancel().await);
    send_fut.await.unwrap();
    wait_kind(&mut rx, "interrupted").await;
    state.new_session().await.expect("空闲后新建可用");

    // 清理
    let _ = std::fs::remove_dir_all(&session_dir);
}
