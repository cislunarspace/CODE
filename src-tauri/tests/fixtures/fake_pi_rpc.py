#!/usr/bin/env python3
"""pi RPC 假服务端（assistant_pi_rpc 集成测试专用）。

模拟 `pi --mode rpc` 的命令/响应/事件三层（ADR 0032 契约）：
- 命令 {"id","type",…} → 响应 {"id","type":"response","command","success",…}；
- 会话事件（message_update/tool_execution_*/message_end/agent_settled）；
- extension_ui_request(select, TOD_TOOL_APPROVAL 信封) 审批子协议。

行为由 prompt 正文里的标记驱动（测试约定）：
- 默认：thinking + delta “收到：<用户消息>” + message_done + settled；
- TOOL: 写工具审批流（extension_ui_request → 等应答 → 执行/拒绝）；
- READTOOL: 只读工具免确认直跑（无审批请求）；
- CANCEL: 流式输出后等 abort，以 aborted 收尾；
- STEER: 流式开头后等 steer prompt，旧轮收尾 + 新消息续跑；
- EXIT: 立即退出进程（重连路径）。

会话目录取 PI_CODING_AGENT_SESSION_DIR（Rust 注入）：启动时预置
fake-77.jsonl（回放用）与 fail-load.jsonl（切换失败用），运行期把消息
追加到 <session>.jsonl——Rust 的会话索引靠目录扫描，文件必须真实存在。

依赖：python3（标准库）。单连接单线程 + 审批/abort 处的阻塞读。
"""

import json
import os
import sys
import threading
import time

write_lock = threading.Lock()

SESSION_DIR = os.environ.get("PI_CODING_AGENT_SESSION_DIR", "/tmp")

state = {
    "counter": 0,
    "session_id": None,
    "session_file": None,
    "messages": {},  # session_id -> [AgentMessage, ...]
    "model": {"id": "m-2", "name": "模型二", "provider": "prov-b"},
}


def send(obj):
    with write_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def respond(cmd_id, command, data=None):
    send(
        {"id": cmd_id, "type": "response", "command": command, "success": True, "data": data or {}}
    )


def respond_err(cmd_id, command, message):
    send({"id": cmd_id, "type": "response", "command": command, "success": False, "error": message})


def emit(record):
    send(record)


def user_of(prompt_text):
    """从 prompt 全文剥出用户消息（领域指令与画布选择之后段）。"""
    parts = prompt_text.split("\n\n")
    return parts[-1] if len(parts) > 1 else prompt_text


def session_path(session_id):
    return os.path.join(SESSION_DIR, f"{session_id}.jsonl")


def record(session_id, message):
    """消息追加进内存与磁盘（磁盘供 Rust 目录扫描索引）。"""
    state["messages"].setdefault(session_id, []).append(message)
    path = session_path(session_id)
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "type": "session",
                        "version": 3,
                        "id": session_id,
                        "timestamp": "2026-01-01T00:00:00.000Z",
                        "cwd": SESSION_DIR,
                    }
                )
                + "\n"
            )
    entry = {
        "type": "message",
        "id": f"e{len(state['messages'][session_id])}",
        "parentId": None,
        "timestamp": "2026-01-01T00:00:01.000Z",
        "message": message,
    }
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def text_delta(text):
    emit(
        {
            "type": "message_update",
            "usage": {},
            "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": text},
        }
    )


def thinking_delta(text):
    emit(
        {
            "type": "message_update",
            "usage": {},
            "assistantMessageEvent": {"type": "thinking_delta", "contentIndex": 0, "delta": text},
        }
    )


def message_end(stop_reason="stop", total_tokens=100):
    emit(
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "content": [],
                "stopReason": stop_reason,
                "usage": {"totalTokens": total_tokens},
            },
        }
    )


def read_command():
    """阻塞读一条客户端命令（审批应答 / abort / steer prompt）。"""
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    return json.loads(line)


def default_turn(user, extra=""):
    thinking_delta("想一下")
    text_delta(f"收到：{user}{extra}")
    message_end()
    record(state["session_id"], {"role": "user", "content": user})
    record(
        state["session_id"],
        {
            "role": "assistant",
            "content": [{"type": "text", "text": f"收到：{user}{extra}"}],
            "usage": {"totalTokens": 100},
            "stopReason": "stop",
        },
    )


def approval_flow(cmd_id, tool, arguments, result_envelope):
    """写工具审批：extension_ui_request → 等应答 → 执行或拒绝。"""
    call_id = f"call_{tool}"
    envelope = json.dumps(
        {"toolCallId": call_id, "tool": f"mcp__tod__{tool}", "arguments": arguments}
    )
    emit(
        {
            "type": "extension_ui_request",
            "id": f"ui-{cmd_id}",
            "method": "select",
            "title": "TOD_TOOL_APPROVAL " + envelope,
            "options": ["批准", "拒绝"],
        }
    )
    answer = read_command()
    if answer.get("type") != "extension_ui_response":
        respond_err(cmd_id, "prompt", "审批应答形态异常")
        return
    if answer.get("value") != "批准":
        # 拒绝：无执行事件，本轮正常收尾（Rust 侧已发拒绝收尾卡）
        message_end()
        emit({"type": "agent_settled"})
        return
    emit(
        {
            "type": "tool_execution_start",
            "toolCallId": call_id,
            "toolName": f"mcp__tod__{tool}",
            "args": arguments,
        }
    )
    time.sleep(0.05)
    emit(
        {
            "type": "tool_execution_end",
            "toolCallId": call_id,
            "toolName": f"mcp__tod__{tool}",
            "result": {"content": [{"type": "text", "text": json.dumps(result_envelope)}]},
            "isError": False,
        }
    )
    text_delta(f"{tool} 完成")
    message_end()
    emit({"type": "agent_settled"})


def handle_prompt(cmd_id, params):
    user = user_of(params.get("message", ""))
    respond(cmd_id, "prompt", {"disposition": "started"})
    emit({"type": "agent_start"})
    record(state["session_id"], {"role": "user", "content": params.get("message", "")})
    if "DENYTOOL:" in user:
        approval_flow(cmd_id, "cr3bp_compute", {"mu": 0.012}, {"status": "ok", "data": {}})
        return
    # 注意顺序：READTOOL 含 TOOL 子串，长标记先判
    if "READTOOL:" in user:
        emit(
            {
                "type": "tool_execution_start",
                "toolCallId": "call_read",
                "toolName": "mcp__tod__catalog_query",
                "args": {"q": 1},
            }
        )
        emit(
            {
                "type": "tool_execution_end",
                "toolCallId": "call_read",
                "toolName": "mcp__tod__catalog_query",
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps({"status": "ok", "data": {"record_id": "rec-r"}}),
                        }
                    ]
                },
                "isError": False,
            }
        )
        text_delta("查询完成")
        message_end()
        emit({"type": "agent_settled"})
        return
    if "TOOL:" in user:
        approval_flow(
            cmd_id,
            "scenario_write",
            {"filename": "demo"},
            {"status": "ok", "data": {"record_id": "rec-1"}},
        )
        return
    if "CANCEL:" in user:
        thinking_delta("想一下")
        text_delta("开始")
        # 等 abort：到达后以 aborted 收尾（真实 pi 语义）
        while True:
            cmd = read_command()
            if cmd.get("type") == "abort":
                respond(cmd["id"], "abort")
                message_end("aborted")
                emit({"type": "agent_settled"})
                return
            if cmd.get("type") == "extension_ui_response":
                continue
            if cmd.get("id") is not None:
                respond_err(cmd["id"], cmd["type"], "流式中不支持")
    if "STEER:" in user:
        thinking_delta("想一下")
        # 等 steer prompt：旧轮收尾后以新消息续跑（上下文保留）
        while True:
            cmd = read_command()
            if cmd.get("type") == "prompt" and cmd.get("streamingBehavior") == "steer":
                respond(cmd["id"], "prompt", {"disposition": "queued"})
                message_end()
                steer_user = user_of(cmd.get("message", ""))
                record(state["session_id"], {"role": "user", "content": cmd.get("message", "")})
                text_delta(f"收到（steer）：{steer_user}")
                message_end()
                emit({"type": "agent_settled"})
                return
            if cmd.get("id") is not None:
                respond_err(cmd["id"], cmd["type"], "流式中只接受 steer")
    if "EXIT:" in user:
        # 模拟进程崩溃：直接退出（stdout 关闭，客户端读循环结束）
        sys.stdout.flush()
        os._exit(0)
    default_turn(user)
    emit({"type": "agent_settled"})


REPLAY_77 = [
    {"role": "user", "content": "回放：最早的问题"},
    {
        "role": "assistant",
        "content": [
            {"type": "text", "text": "回放：最早的回答"},
            {
                "type": "toolCall",
                "id": "call_r",
                "name": "mcp__tod__catalog_query",
                "arguments": {"q": 1},
            },
        ],
        "usage": {"totalTokens": 9},
        "stopReason": "stop",
    },
    {
        "role": "toolResult",
        "toolCallId": "call_r",
        "toolName": "mcp__tod__catalog_query",
        "content": [
            {
                "type": "text",
                "text": json.dumps({"status": "ok", "data": {"record_id": "rec-replay"}}),
            }
        ],
        "isError": False,
    },
]


def seed_session_files():
    """预置索引需要的会话文件（Rust 目录扫描在首个连接建立时发生）。"""
    os.makedirs(SESSION_DIR, exist_ok=True)
    path = session_path("fake-77")
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "type": "session",
                        "version": 3,
                        "id": "fake-77",
                        "timestamp": "2026-01-01T00:00:00.000Z",
                        "cwd": SESSION_DIR,
                    }
                )
                + "\n"
            )
            f.write(
                json.dumps(
                    {
                        "type": "session_info",
                        "id": "info",
                        "parentId": None,
                        "timestamp": "2026-01-01T00:00:00.000Z",
                        "name": "回放会话",
                    }
                )
                + "\n"
            )
            for m in REPLAY_77:
                f.write(
                    json.dumps(
                        {
                            "type": "message",
                            "id": "x",
                            "parentId": None,
                            "timestamp": "2026-01-01T00:00:00.000Z",
                            "message": m,
                        }
                    )
                    + "\n"
                )
    fail = session_path("fail-load")
    if not os.path.exists(fail):
        with open(fail, "w", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "type": "session",
                        "version": 3,
                        "id": "fail-load",
                        "timestamp": "2026-01-01T00:00:00.000Z",
                        "cwd": SESSION_DIR,
                    }
                )
                + "\n"
            )


def dispatch(msg):
    cmd = msg.get("type")
    cmd_id = msg.get("id")
    if cmd == "get_state":
        respond(
            cmd_id,
            "get_state",
            {
                "sessionId": state["session_id"],
                "sessionFile": state["session_file"],
                "model": state["model"],
                "thinkingLevel": "high",
                "isStreaming": False,
            },
        )
    elif cmd == "prompt":
        handle_prompt(cmd_id, msg)
    elif cmd == "abort":
        respond(cmd_id, "abort")
    elif cmd == "new_session":
        state["counter"] += 1
        state["session_id"] = f"fake-{state['counter']}"
        state["session_file"] = session_path(state["session_id"])
        respond(cmd_id, "new_session", {"cancelled": False})
    elif cmd == "switch_session":
        path = msg.get("sessionPath", "")
        name = os.path.basename(path).removesuffix(".jsonl")
        if "fail" in name:
            respond_err(cmd_id, "switch_session", f"session file not found: {path}")
            return
        state["session_id"] = name
        state["session_file"] = path
        respond(cmd_id, "switch_session", {"cancelled": False})
    elif cmd == "get_messages":
        msgs = (
            REPLAY_77
            if state["session_id"] == "fake-77"
            else state["messages"].get(state["session_id"], [])
        )
        respond(cmd_id, "get_messages", {"messages": msgs})
    elif cmd == "get_available_models":
        respond(
            cmd_id,
            "get_available_models",
            {
                "models": [
                    {"id": "m-1", "name": "模型一", "provider": "prov-a"},
                    {"id": "m-2", "name": "模型二", "provider": "prov-b"},
                ]
            },
        )
    elif cmd == "get_available_thinking_levels":
        respond(
            cmd_id,
            "get_available_thinking_levels",
            {"levels": ["off", "minimal", "low", "medium", "high"]},
        )
    elif cmd == "set_model":
        provider, model_id = msg.get("provider"), msg.get("modelId")
        known = {"prov-a": "m-1", "prov-b": "m-2"}
        if known.get(provider) == model_id:
            state["model"] = {
                "id": model_id,
                "name": "模型一" if model_id == "m-1" else "模型二",
                "provider": provider,
            }
            respond(cmd_id, "set_model", dict(state["model"]))
        else:
            respond_err(cmd_id, "set_model", f"Model not found: {model_id}")
    elif cmd == "set_thinking_level":
        respond(cmd_id, "set_thinking_level")
    else:
        respond_err(cmd_id, cmd or "unknown", f"未知命令 {cmd}")


def main():
    seed_session_files()
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        dispatch(msg)


if __name__ == "__main__":
    main()
