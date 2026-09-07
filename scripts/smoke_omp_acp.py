"""omp acp 冒烟脚本：真实 omp + 应用桥接 + mcp-serve + 宿主情景工具全链路。

验证链路（omp 为基座的 AI 会话重构）：
1. `omp acp` 握手（initialize，客户端声明 elicitation.form 审批能力）；
2. session/new 带 ACP mcpServers 桥接条目（应用二进制
   `--assistant-mcp-bridge` 模式），omp 拉起桥接、发现 e2m2e 与宿主工具；
3. 只读工具（catalog_query，审批白名单）直接执行，不触发审批表单；
4. 写工具（scenario_write）触发 omp 审批表单（elicitation/create），
   回 Approve 后经桥接真实执行（情景文件落盘）；
5. session/cancel：进行中的轮次以 cancelled stop reason 结束；
6. 第二个进程 session/load 回放同会话（omp 侧持久化的历史）。

用法（开发环境，需本机 omp 已配置可用 provider）：
    uv run python scripts/smoke_omp_acp.py [--app <应用二进制>]

一次性与人工回归双用，不进仓库测试套件（依赖真实模型调用）。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_APP = os.path.join(REPO_ROOT, "src-tauri", "target", "debug", "transfer-orbit-design")


class AcpClient:
    """omp acp 的最小 ACP 客户端（换行 JSON-RPC over stdio）。"""

    def __init__(self, command: list[str], env: dict[str, str] | None = None):
        self.proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            env=env,
        )
        self.lines: list[dict] = []
        self.elicitations: list[dict] = []
        self._lock = threading.Lock()
        threading.Thread(target=self._reader, daemon=True).start()
        self.next_id = 1

    def _reader(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("method") == "elicitation/create":
                # 审批表单：自动 Approve（冒烟只验证链路，不模拟犹豫）
                with self._lock:
                    self.elicitations.append(msg)
                self.respond(msg["id"], {"action": "accept", "content": {"value": "Approve"}})
            with self._lock:
                self.lines.append(msg)

    def send(self, payload: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def request(self, method: str, params: dict) -> dict:
        rid = self.next_id
        self.next_id += 1
        self.send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        deadline = time.time() + 120
        while time.time() < deadline:
            with self._lock:
                for msg in self.lines:
                    if msg.get("id") == rid:
                        if "error" in msg:
                            raise RuntimeError(f"{method} 失败：{msg['error']}")
                        return msg["result"]
            time.sleep(0.1)
        raise RuntimeError(f"{method} 响应超时")

    def respond(self, rid, result: dict) -> None:
        self.send({"jsonrpc": "2.0", "id": rid, "result": result})

    def notify(self, method: str, params: dict) -> None:
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def updates(self, session_id: str) -> list[dict]:
        with self._lock:
            return [
                m["params"]["update"]
                for m in self.lines
                if m.get("method") == "session/update"
                and m.get("params", {}).get("sessionId") == session_id
                and "update" in m.get("params", {})
            ]

    def close(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def find_omp() -> list[str]:
    env = os.environ.get("TOD_OMP_BIN")
    if env and os.path.isfile(env):
        return [env]
    for dir_ in os.environ.get("PATH", "").split(os.pathsep):
        cand = os.path.join(dir_, "omp")
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return [cand]
    raise RuntimeError("未找到 omp（PATH 或 TOD_OMP_BIN）")


def overlay_path() -> str:
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    cfg_dir = os.path.join(base, "transfer-orbit-design")
    os.makedirs(cfg_dir, exist_ok=True)
    path = os.path.join(cfg_dir, "omp-approval-overlay.yaml")
    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "# smoke 脚本生成：只读白名单免确认，其余审批\n"
            "tools:\n"
            "  approvalMode: always-ask\n"
            "  approval:\n"
            "    mcp__tod_catalog_query: allow\n"
            "    mcp__tod_catalog_get: allow\n"
            "    mcp__tod_scenario_list: allow\n"
        )
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", default=DEFAULT_APP, help="应用二进制（桥接入口）")
    args = parser.parse_args()
    if not os.path.isfile(args.app):
        print(f"应用二进制不存在：{args.app}（先 cargo build）", file=sys.stderr)
        return 1

    omp = find_omp()
    overlay = overlay_path()
    session_cwd = os.path.join(
        os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config"),
        "transfer-orbit-design",
    )
    os.makedirs(session_cwd, exist_ok=True)

    server_entry = {
        "name": "tod",
        "command": os.path.abspath(args.app),
        "args": ["--assistant-mcp-bridge"],
        "env": [],
    }

    # 桥接进程由 omp 拉起并继承本环境：mcp-serve 命令经环境传递
    # （与 app 的 OmpState::spawn 同一约定；不含任何密钥）
    env = dict(os.environ)
    env["TOD_MCP_COMMAND_JSON"] = json.dumps(["uv", "run", "e2m2e", "mcp-serve"])
    env["TOD_MCP_CWD"] = REPO_ROOT
    client = AcpClient(omp + ["acp", "--config", overlay], env=env)
    try:
        # 1. 握手
        init = client.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {"elicitation": {"form": {}}},
            },
        )
        assert init["agentInfo"]["name"], "握手缺 agentInfo"
        agent = init["agentInfo"]
        print(f"[1] initialize ok：{agent['name']} {agent.get('version', '')}")

        # 2. 会话（omp 拉起桥接并发现工具）
        new = client.request(
            "session/new",
            {"cwd": session_cwd, "mcpServers": [server_entry]},
        )
        sid = new["sessionId"]
        print(f"[2] session/new ok：{sid}")

        # 3. 只读工具（白名单）直接执行：catalog_query 不触发审批表单
        result = client.request(
            "session/prompt",
            {
                "sessionId": sid,
                "prompt": [
                    {
                        "type": "text",
                        "text": "调用 catalog_query 工具查询最近的轨道记录（参数给空对象）。"
                        " 只做这一次工具调用，然后用一句话报告结果状态。",
                    }
                ],
            },
        )
        assert result["stopReason"] == "end_turn", f"只读轮异常结束：{result}"
        catalog_els = [
            e
            for e in client.elicitations
            if "mcp__tod_catalog_query" in e["params"].get("message", "")
        ]
        assert not catalog_els, "白名单工具不应触发审批表单"
        # 模型行为不确定（可能自查工具文档/重试）：只断言发生了工具调用，
        # 终态宽松（真实桥接链路由第 4 步的 scenario_write 严格验证）
        assert any(
            u.get("sessionUpdate") == "tool_call_update"
            for u in client.updates(sid)
        ), "应有工具调用回执"
        print("[3] 只读工具白名单直跑 ok（无审批表单）")
        _ = result

        # 4. 写工具触发审批 → Approve → 桥接真实执行
        result = client.request(
            "session/prompt",
            {
                "sessionId": sid,
                "prompt": [
                    {
                        "type": "text",
                        "text": "调用 scenario_write 工具，filename 用 "
                        "smoke_acp_demo，records 给空列表，reference_epoch 给 "
                        '{"utc": "2024-01-01T00:00:00"}。只做这一次调用，完成后'
                        "用一句话报告 scenario_file 路径。",
                    }
                ],
            },
        )
        assert result["stopReason"] == "end_turn", f"写工具轮异常结束：{result}"
        write_els = [
            e
            for e in client.elicitations
            if "mcp__tod_scenario_write" in e["params"].get("message", "")
        ]
        assert write_els, "写工具应触发审批表单"
        write_done = [
            u
            for u in client.updates(sid)
            if u.get("sessionUpdate") == "tool_call_update"
            and u.get("status") == "completed"
            and "scenario_file" in json.dumps(u.get("content", []))
        ]
        assert write_done, "Approve 后应完成 scenario_write 并带 scenario_file"
        print("[4] 写工具审批 → 桥接执行 ok（scenario_file 已回）")

        # 5. cancel：慢轮次中断
        rid = client.next_id
        client.next_id += 1
        client.send(
            {
                "jsonrpc": "2.0",
                "id": rid,
                "method": "session/prompt",
                "params": {
                    "sessionId": sid,
                    "prompt": [
                        {
                            "type": "text",
                            "text": "从 1 慢慢数到 500，每个数字单独一行，"
                            "每个数字后面附加该数字的中文大写，不要停不要总结。",
                        }
                    ],
                },
            }
        )
        time.sleep(5)
        client.notify("session/cancel", {"sessionId": sid})
        deadline = time.time() + 30
        stop = None
        while time.time() < deadline:
            with client._lock:
                for msg in client.lines:
                    if msg.get("id") == rid and "result" in msg:
                        stop = msg["result"]["stopReason"]
                        break
            if stop:
                break
            time.sleep(0.2)
        assert stop == "cancelled", f"中断后 stopReason 应为 cancelled：{stop}"
        print("[5] session/cancel ok（stopReason=cancelled）")
    finally:
        client.close()

    # 6. 第二进程回放同会话
    client2 = AcpClient(omp + ["acp", "--config", overlay], env=env)
    try:
        client2.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {"elicitation": {"form": {}}},
            },
        )
        client2.request(
            "session/load",
            {
                "sessionId": sid,
                "cwd": session_cwd,
                "mcpServers": [server_entry],
            },
        )
        replay = [
            u
            for u in client2.updates(sid)
            if u.get("sessionUpdate") in ("user_message_chunk", "agent_message_chunk", "tool_call")
        ]
        assert any(u["sessionUpdate"] == "user_message_chunk" for u in replay), "回放应含用户消息"
        assert any(u["sessionUpdate"] == "tool_call" for u in replay), "回放应含工具卡片"
        print(f"[6] session/load 回放 ok（{len(replay)} 条重建事件）")
    finally:
        client2.close()

    print("\n全部通过：握手 / 桥接工具发现 / 只读白名单 / 写工具审批 / 取消 / 回放")
    return 0


if __name__ == "__main__":
    sys.exit(main())
