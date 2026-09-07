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

state = {"next_session": 0, "thinking": "medium", "cancel_requested": False, "cwd": ""}
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
        {"id": "mode", "currentValue": "default"},
        {"id": "thinking", "currentValue": state["thinking"]},
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
        import time

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

    if "TOOL:" in text:
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
        decision = request_elicitation(mid, tool)
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


def request_elicitation(prompt_id, tool):
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
                "message": (
                    f"Allow tool: write\nPath: xd://mcp__tod_{tool}\n"
                    'Content: {"filename": "demo"}'
                ),
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
        if msg.get("method") is None and msg.get("id") is not None:
            # 其它请求响应：忽略
            continue


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        method = msg.get("method")
        mid = msg.get("id")
        params = msg.get("params") or {}

        if method == "initialize":
            reply(
                mid,
                {"protocolVersion": 1, "agentInfo": {"name": "fake-omp"}, "agentCapabilities": {}},
            )
            continue
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
                continue
            replay(params.get("sessionId", "?"))
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
        elif method == "session/set_config_option":
            state["thinking"] = params.get("value", "medium")
            reply(mid, {"configOptions": config_options()})
        elif method == "$/ping-unknown":
            # 未知请求：等一条应答（客户端应回 -32601；这里不校验内容）
            pass
        else:
            if mid is not None:
                reply_err(mid, -32601, f"未知方法 {method}")
        # 干扰项：未知通知应被客户端忽略
        if method == "initialize":
            notify("$/noise", {})


if __name__ == "__main__":
    main()
