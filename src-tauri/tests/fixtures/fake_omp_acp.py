#!/usr/bin/env python3
"""ACP 假服务端（assistant_acp 集成测试专用）。

模拟 omp 18.1.11 `omp acp` 的被测契约子集：
- initialize / session/new / session/load / session/list / session/prompt /
  session/cancel（通知）/ session/set_config_option
- 审批：session/prompt 消息含 "TOOL:" 时发 elicitation/create（Allow tool
  表单），等客户端应答 Approve/Deny 后再发 tool_call_update 终态
- 回放：session/load 先推 user_message_chunk / agent_message_chunk /
  tool_call / tool_call_update 再回 result（对任意 sessionId 状态化回放）
- 干扰项：若干未知通知（应被忽略）与一个未知请求（应收到 -32601）
- "EXIT:" 消息令进程退出（测子进程死亡重连）

状态：会话 id 计数器 + thinking 当前值。进程重启即失忆（load 对任意 id
回放固定序列，恰好覆盖重连重开路径）。
"""

import json
import sys
import threading
import time

state = {
    "next_session": 0,
    "thinking": "medium",
    "model": "zhipu/glm-4.7",
    "mode": "default",
    "cancel_requested": False,
    "cwd": "",
    "pending_msgs": [],
}
write_lock = threading.Lock()


def send(obj):
    with write_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def notify(method, params):
    send({"jsonrpc": "2.0", "method": method, "params": params})


def reply(mid, result):
    send({"jsonrpc": "2.0", "id": mid, "result": result})


def reply_err(mid, code, message):
    send({"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}})


def config_options():
    return [
        {
            "id": "mode",
            "name": "Mode",
            "category": "mode",
            "type": "select",
            "currentValue": state["mode"],
            "options": [
                {"value": "default", "name": "Default"},
                {"value": "plan", "name": "Plan"},
            ],
        },
        {
            "id": "model",
            "name": "Model",
            "category": "model",
            "type": "select",
            "currentValue": state["model"],
            "options": [
                {"value": "zhipu/glm-4.7", "name": "GLM 4.7"},
                {"value": "deepseek/deepseek-v4-flash", "name": "DeepSeek V4 Flash"},
            ],
        },
        {
            "id": "thinking",
            "name": "Thinking",
            "category": "thinking",
            "type": "select",
            "currentValue": state["thinking"],
            "options": [
                {"value": v, "name": v} for v in ["off", "auto", "minimal", "low", "medium", "high"]
            ],
        },
    ]


def replay(session_id):
    """session/load 的回放序列（含一次已完成的桥接工具调用）。"""
    notify(
        "session/update",
        {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "user_message_chunk",
                "content": {"type": "text", "text": "回放：最早的问题"},
            },
        },
    )
    notify(
        "session/update",
        {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "回放：最早的回答"},
            },
        },
    )
    notify(
        "session/update",
        {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "replay-call-1",
                "kind": "execute",
                "status": "pending",
                "rawInput": {"path": "xd://mcp__tod_catalog_query", "content": '{"q": 1}'},
            },
        },
    )
    notify(
        "session/update",
        {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "replay-call-1",
                "status": "completed",
                "content": [
                    {
                        "type": "content",
                        "content": {
                            "type": "text",
                            "text": '{"status":"ok","data":{"record_id":"rec-replay"}}',
                        },
                    }
                ],
            },
        },
    )


def handle_prompt(mid, params):
    session_id = params.get("sessionId", "")
    text = ""
    for block in params.get("prompt", []):
        if block.get("type") == "text":
            text += block.get("text", "")

    # 客户端正文信封：指令段与用户消息以空行分隔（见 build_prompt_text）
    user_message = text.split("\n\n", 2)[1] if "\n\n" in text else text
    # 客户端会在正文前注入固定领域指令，命令标记按包含匹配（真实 omp
    # 同样不要求命令位于文本开头）
    if "EXIT:" in text:
        # 直接退出（响应欠奉）：客户端应得到连接断开错误
        sys.exit(0)

    if "CANCEL:" in text:
        state["cancel_requested"] = False
        notify(
            "session/update",
            {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "数着"},
                },
            },
        )
        # 等待 session/cancel（测试侧另线触发，最多等 10 秒）

        for _ in range(100):
            if state["cancel_requested"]:
                break
            time.sleep(0.1)
        reply(mid, {"stopReason": "cancelled", "usage": {"totalTokens": 10}})
        return

    notify(
        "session/update",
        {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "agent_thought_chunk",
                "content": {"type": "text", "text": "想一下"},
            },
        },
    )

    if "TOOL:" in text and "EVALTOOL:" not in text and "EVALREAD:" not in text:
        # 审批链路：tool_call(pending) → elicitation/create → 按应答出终态
        tool = text.split("TOOL:", 1)[1].strip().split(maxsplit=1)[0] or "scenario_write"
        notify(
            "session/update",
            {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": f"call-{mid}",
                    "kind": "execute",
                    "status": "pending",
                    "rawInput": {
                        "path": f"xd://mcp__tod_{tool}",
                        "content": '{"filename": "demo"}',
                    },
                },
            },
        )
        decision = request_elicitation(
            mid,
            f'Allow tool: write\nPath: xd://mcp__tod_{tool}\nContent: {{"filename": "demo"}}',
        )
        if decision == "Approve":
            status = "completed"
            content = [
                {
                    "type": "content",
                    "content": {
                        "type": "text",
                        "text": '{"status":"ok","data":{"record_id":"rec-1"}}',
                    },
                }
            ]
        else:
            status = "failed"
            content = None
        update = {
            "sessionUpdate": "tool_call_update",
            "toolCallId": f"call-{mid}",
            "status": status,
            "rawOutput": {"content": [{"type": "text", "text": "用户已拒绝"}]},
        }
        if content:
            update["content"] = content
        notify("session/update", {"sessionId": session_id, "update": update})

    if "EVALTOOL:" in text or "EVALREAD:" in text:
        # eval 包装形态（omp ≥18.1.12 实测）：审批是通用 eval 表单，真实
        # 工具在 Code 里（tool.<name>(args)）；tool_call 无 path
        marker = "EVALTOOL:" if "EVALTOOL:" in text else "EVALREAD:"
        tool = text.split(marker, 1)[1].strip().split(maxsplit=1)[0]
        code = f'await tool.{tool}({{"filename": "demo"}})'
        notify(
            "session/update",
            {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": f"call-{mid}",
                    "kind": "execute",
                    "status": "pending",
                    "rawInput": {"language": "js", "code": code},
                },
            },
        )
        decision = request_elicitation(mid, f"Allow tool: eval\nLanguage: js\nCode:\n{code}")
        if decision == "Approve":
            content = [
                {
                    "type": "content",
                    "content": {
                        "type": "text",
                        "text": 'display[1]:\n{"status":"ok","data":{"record_id":"rec-eval"}}',
                    },
                }
            ]
            status = "completed"
        else:
            content = None
            status = "failed"
        update = {
            "sessionUpdate": "tool_call_update",
            "toolCallId": f"call-{mid}",
            "status": status,
            "rawOutput": {"content": [{"type": "text", "text": "用户已拒绝"}]},
        }
        if content:
            update["content"] = content
        notify("session/update", {"sessionId": session_id, "update": update})

    if "STEER:" in text:
        # 慢轮引导（omp 实测语义：运行中来新 prompt = 取消当前轮 + 新轮
        # 立即开始）。读 stdin 等第二 prompt（STEERED:）或 session/cancel
        deadline = time.time() + 10
        while time.time() < deadline:
            line = sys.stdin.readline()
            if not line:
                break
            msg = json.loads(line)
            if msg.get("method") == "session/cancel":
                state["cancel_requested"] = True
                reply(mid, {"stopReason": "cancelled", "usage": {"totalTokens": 5}})
                return
            if msg.get("method") == "session/prompt":
                blocks = msg.get("params", {}).get("prompt", [])
                steered = any("STEERED:" in (b.get("text", "")) for b in blocks)
                if steered:
                    reply(mid, {"stopReason": "cancelled", "usage": {"totalTokens": 5}})
                    handle_prompt(msg["id"], msg["params"])
                    return
        reply(mid, {"stopReason": "end_turn", "usage": {"totalTokens": 5}})
        return

    notify(
        "session/update",
        {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "收到：" + user_message[:20]},
            },
        },
    )
    reply(mid, {"stopReason": "end_turn", "usage": {"totalTokens": 100}})


def request_elicitation(prompt_id, message):
    """同步等一次 elicitation/create 的应答（阻塞读一条客户端消息）。"""
    rid = 1000 + prompt_id if isinstance(prompt_id, int) else 1000
    send(
        {
            "jsonrpc": "2.0",
            "id": rid,
            "method": "elicitation/create",
            "params": {
                "mode": "form",
                "sessionId": "any",
                "message": message,
                "requestedSchema": {"type": "object"},
            },
        }
    )
    while True:
        line = sys.stdin.readline()
        if not line:
            return None
        msg = json.loads(line)
        if msg.get("id") == rid and "result" in msg:
            value = msg["result"].get("content", {}).get("value")
            return value
        # 其间到达的其它消息（如 session/cancel 通知）转交主循环处理
        if msg.get("method") == "session/cancel":
            state["cancel_requested"] = True
            continue
        if msg.get("method") is not None:
            # 引导场景：审批等待期间到达的新 prompt 等请求先入队，
            # 由主循环在审批结束后处理（否则被吞、客户端挂死）
            state["pending_msgs"].append(msg)
            continue


def main():
    while True:
        # 审批等待期入队的消息（引导的新 prompt 等）先出队处理
        if state["pending_msgs"]:
            msg = state["pending_msgs"].pop(0)
            dispatch(msg)
            continue
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        dispatch(msg)


def dispatch(msg):
    method = msg.get("method")
    mid = msg.get("id")
    params = msg.get("params") or {}

    if method == "initialize":
        reply(
            mid,
            {"protocolVersion": 1, "agentInfo": {"name": "fake-omp"}, "agentCapabilities": {}},
        )
        notify("$/noise", {})
        return
    # 记住会话建立/载入时的 cwd（真实 omp 按落盘值返回 session/list）
    if method in ("session/new", "session/load") and params.get("cwd"):
        state["cwd"] = params["cwd"]
    if method == "session/new":
        state["next_session"] += 1
        reply(
            mid,
            {"sessionId": f"fake-{state['next_session']}", "configOptions": config_options()},
        )
    elif method == "session/load":
        if params.get("sessionId") == "fail-load":
            # 指定失败会话：测客户端失败路径（应恢复原会话显示）
            reply_err(mid, -32000, "会话文件损坏")
            return
        replay(params.get("sessionId", "?"))
        reply(mid, {"configOptions": config_options()})
    elif method == "session/set_config_option":
        cid = params.get("configId", "")
        value = params.get("value", "")
        opt = next((o for o in config_options() if o["id"] == cid), None)
        if opt is None:
            reply_err(mid, -32603, f"Unknown ACP config option: {cid}")
            return
        if not any(x["value"] == value for x in opt["options"]):
            reply_err(mid, -32603, f"Unknown value for {cid}: {value}")
            return
        state[cid] = value
        reply(mid, {"configOptions": config_options()})
    elif method == "session/list":
        reply(
            mid,
            {
                "sessions": [
                    {
                        "sessionId": "fake-1",
                        "cwd": state["cwd"],  # 真实 omp 按落盘 cwd 返回
                        "title": "会话一",
                        "updatedAt": "2026-01-01T00:00:00Z",
                        "_meta": {"messageCount": 3},
                    },
                    {
                        "sessionId": "other-9",
                        "cwd": "/somewhere/else",
                        "title": "别人的",
                        "updatedAt": "2026-01-01T00:00:00Z",
                        "_meta": {"messageCount": 1},
                    },
                ]
            },
        )
    elif method == "session/prompt":
        handle_prompt(mid, params)
    elif method == "session/cancel":
        state["cancel_requested"] = True
    elif method == "$/ping-unknown":
        # 未知请求：等一条应答（客户端应回 -32601；这里不校验内容）
        pass
    else:
        if mid is not None:
            reply_err(mid, -32601, f"未知方法 {method}")


if __name__ == "__main__":
    main()
