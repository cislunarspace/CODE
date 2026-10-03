"""pi RPC 冒烟脚本：真实 pi + 桥接扩展 + 应用桥接 + mcp-serve + 宿主情景工具全链路。

验证链路（pi 为基座的 AI 会话运行时，ADR 0032）：
1. `pi --mode rpc` 拉起（--no-extensions + builtin:mcp + 桥接扩展 +
   --no-builtin-tools），get_state 握手成功；
2. new_session 后发 prompt 引导模型调只读工具（catalog_query，扩展层
   白名单）：断言无 extension_ui_request、出现 tool_execution_start/end
   且非 error；
3. 再发 prompt 引导调写工具（scenario_write）：断言收到
   extension_ui_request(method=select, TOD_TOOL_APPROVAL 信封)，回
   批准后断言情景文件落盘；
4. 流式中发 steer prompt：断言轮次继续且上下文保留（回应包含前文要点）；
5. abort 进行中轮次：断言 agent_settled 到达；
6. 第二个 pi 进程 switch_session 指向第一步的会话文件 + get_messages：
   断言消息数与末条 assistant 文本非空。

用法（开发环境，需本机 pi 已配置可用 provider）：
    uv run python scripts/smoke_pi_rpc.py [--app <应用二进制>] [--keep]

前置：cargo build --manifest-path src-tauri/Cargo.toml（默认取 debug 构建
的应用二进制，桥接进程经它拉起 mcp-serve）。

一次性与人工回归双用，不进仓库测试套件（依赖真实模型调用）。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_APP = os.path.join(REPO_ROOT, "src-tauri", "target", "debug", "cislunar-code")
DEFAULT_EXT = os.path.join(REPO_ROOT, "src-tauri", "resources", "assistant", "tod-bridge.ts")
APPROVAL_PREFIX = "TOD_TOOL_APPROVAL "


class PiClient:
    """pi --mode rpc 的最小 JSONL 客户端（命令/响应按 id 关联，事件入列表）。"""

    def __init__(self, app_bin: str, session_dir: str, tag: str):
        env = os.environ.copy()
        env["PI_CODING_AGENT_SESSION_DIR"] = session_dir
        env["TOD_APP_BIN"] = app_bin
        env["TOD_BRIDGE_CWD"] = REPO_ROOT
        # 桥接进程（--assistant-mcp-bridge）按这两个变量拉起 mcp-serve
        # （argv 对齐 lib.rs dev_mcp_command）
        env["TOD_MCP_COMMAND_JSON"] = json.dumps(
            [
                "uv",
                "run",
                "e2m2e",
                "mcp-serve",
            ]
        )
        env["TOD_MCP_CWD"] = REPO_ROOT
        env["SPICE_KERNEL_DIR"] = os.path.join(REPO_ROOT, "kernels")
        env["E2M2E_CATALOG_ENABLED"] = "1"
        env["E2M2E_CATALOG_DIR"] = os.path.join(session_dir, "catalog")
        # 宿主情景工具写 config_dir()/scenarios（XDG_CONFIG_HOME 派生）：
        # 重定向进临时目录，断言不碰用户真实配置
        env["XDG_CONFIG_HOME"] = os.path.join(session_dir, "xdg")
        ext = os.environ.get("TOD_PI_EXTENSION", DEFAULT_EXT)
        self.proc = subprocess.Popen(
            [
                os.environ.get("TOD_PI_BIN", "pi"),
                "--mode",
                "rpc",
                "--no-extensions",
                "--extension",
                "builtin:mcp",
                "--extension",
                ext,
                "--no-builtin-tools",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            env=env,
            cwd=session_dir,
        )
        self.records: list[dict] = []
        self.approvals: list[dict] = []
        self._lock = threading.Lock()
        threading.Thread(target=self._reader, daemon=True).start()
        self.next_id = 1
        self.tag = tag

    def _reader(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            with self._lock:
                self.records.append(rec)
            # 审批卡不自动应答：由步骤显式决定（smoke 要验证用户闸）

    def send(self, payload: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def request(self, kind: str, payload: dict | None = None, timeout: float = 240.0) -> dict:
        rid = f"{self.tag}-{self.next_id}"
        self.next_id += 1
        body = {"id": rid, "type": kind}
        body.update(payload or {})
        self.send(body)
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                for rec in self.records:
                    if (
                        rec.get("type") == "response"
                        and rec.get("id") == rid
                        and rec.get("_consumed") is not True
                    ):
                        rec["_consumed"] = True
                        if not rec.get("success"):
                            raise RuntimeError(f"{kind} 失败：{rec.get('error')}")
                        return rec.get("data") or {}
            time.sleep(0.05)
        raise RuntimeError(f"{kind} 响应超时（{timeout}s）")

    def wait_event(self, pred, timeout: float = 240.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                for rec in self.records:
                    if rec.get("type") != "response" and pred(rec):
                        return rec
            time.sleep(0.1)
        raise RuntimeError("等待事件超时")

    def events(self, etype: str) -> list[dict]:
        with self._lock:
            return [r for r in self.records if r.get("type") == etype]

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def wait_settled(client: PiClient, timeout: float = 300.0) -> None:
    """等新的 agent_settled（跑完当前全部自动工作，含 steer 队列）。

    先快照当前 settled 计数再等待增量：历史 settled 不算本轮完成。
    """
    deadline = time.time() + timeout
    seen = len(client.events("agent_settled"))
    while time.time() < deadline:
        if len(client.events("agent_settled")) > seen:
            return
        time.sleep(0.2)
    raise RuntimeError("agent_settled 超时")


def last_assistant_text(client: PiClient) -> str:
    texts: list[str] = []
    for rec in client.events("message_end"):
        msg = rec.get("message") or {}
        if msg.get("role") != "assistant":
            continue
        for block in msg.get("content") or []:
            if block.get("type") == "text":
                texts.append(block.get("text", ""))
    return texts[-1] if texts else ""


def main() -> int:
    parser = argparse.ArgumentParser(description="pi RPC 真实链路冒烟（需本机 pi 已配置 provider）")
    parser.add_argument("--app", default=DEFAULT_APP, help="应用二进制路径（先 cargo build）")
    parser.add_argument("--keep", action="store_true", help="保留临时会话目录（排查用）")
    args = parser.parse_args()

    if not os.path.isfile(args.app):
        print(
            f"应用二进制不存在：{args.app}（先 cargo build --manifest-path src-tauri/Cargo.toml）"
        )
        return 1
    if not os.path.isfile(DEFAULT_EXT):
        print(f"桥接扩展不存在：{DEFAULT_EXT}")
        return 1

    tmp = tempfile.mkdtemp(prefix="tod-pi-smoke-")
    session_dir = os.path.join(tmp, "pi-sessions")
    os.makedirs(session_dir, exist_ok=True)
    os.makedirs(os.path.join(tmp, "catalog"), exist_ok=True)
    scenarios = os.path.join(session_dir, "xdg", "cislunar-code", "scenarios")

    try:
        # --- 1. 握手 ---
        pi = PiClient(args.app, session_dir, "a")
        state = pi.request("get_state")
        print(f"[1] get_state ok：sessionId={state.get('sessionId')}")
        pi.request("new_session")
        state = pi.request("get_state")
        session_file = state.get("sessionFile")
        assert session_file, "get_state 缺少 sessionFile（会话文件首条消息后落盘）"
        print(f"[1] new_session ok：{session_file}")

        # --- 2. 只读工具免确认 ---
        pi.request(
            "prompt",
            {
                "message": (
                    "请调用工具 catalog_query（查询参数用空对象 {}），"
                    "然后用一句话报告查到的记录条数。不要调用其它工具。"
                )
            },
        )
        wait_settled(pi)
        assert not [r for r in pi.records if r.get("type") == "extension_ui_request"], (
            "只读工具不应触发审批"
        )
        starts = pi.events("tool_execution_start")
        assert any(s.get("toolName") == "mcp__tod__catalog_query" for s in starts), (
            f"应有 catalog_query 执行：{[s.get('toolName') for s in starts]}"
        )
        ends = [
            e
            for e in pi.events("tool_execution_end")
            if e.get("toolName") == "mcp__tod__catalog_query"
        ]
        assert ends and all(not e.get("isError") for e in ends), f"catalog_query 失败：{ends}"
        assert os.path.isfile(session_file), f"首轮后会话文件应落盘：{session_file}"
        print(f"[2] 只读免确认 ok（{len(ends)} 次执行，无审批卡，会话文件已落盘）")

        # --- 3. 写工具审批 ---
        marker = f"smoke-{uuid.uuid4().hex[:8]}"
        pi.request(
            "prompt",
            {
                "message": (
                    f"请调用工具 mcp__tod__scenario_write，参数：{{"
                    f'"filename": "{marker}", "records": [], '
                    '"reference_epoch": {"utc": "2026-01-01T00:00:00Z"}}}，'
                    "完成后报告情景文件路径。不要调用其它工具。"
                )
            },
        )
        try:
            req = pi.wait_event(
                lambda r: (
                    r.get("type") == "extension_ui_request"
                    and r.get("method") == "select"
                    and str(r.get("title", "")).startswith(APPROVAL_PREFIX)
                )
            )
        except RuntimeError:
            tools = [t.get("toolName") for t in pi.events("tool_execution_start")]
            raise RuntimeError(
                f"审批卡未到达。实际工具执行：{tools}；末条回复：{last_assistant_text(pi)[:300]}"
            ) from None
        envelope = json.loads(req["title"][len(APPROVAL_PREFIX) :])
        assert envelope.get("tool") == "mcp__tod__scenario_write", f"审批工具异常：{envelope}"
        print(f"[3] 审批卡到达：toolCallId={envelope.get('toolCallId')}")
        pi.send({"type": "extension_ui_response", "id": req["id"], "value": "批准"})
        wait_settled(pi)
        ends = [
            e
            for e in pi.events("tool_execution_end")
            if e.get("toolName") == "mcp__tod__scenario_write"
        ]
        if not ends or any(e.get("isError") for e in ends):
            dump = os.path.join(tmp, "records.json")
            with open(dump, "w", encoding="utf-8") as f:
                json.dump(pi.records, f, ensure_ascii=False, indent=1)
            raise AssertionError(f"scenario_write 失败：{ends}；全量事件已转储 {dump}")
        # 情景文件落盘（宿主工具固定目录 scenarios/）
        import glob

        matches = glob.glob(os.path.join(scenarios, f"*{marker}*"))
        assert matches, f"情景文件未落盘（{scenarios} 下无 *{marker}*）"
        print(f"[3] 批准执行 ok：{matches[0]}")

        # --- 4. steer 引导（上下文保留）---
        pi.request(
            "prompt",
            {
                "message": (
                    "请逐条列出你刚才完成的操作（工具名与关键结果），先不要调用任何工具，"
                    "写第一句后停下来等我的补充指令。"
                )
            },
        )
        pi.wait_event(
            lambda r: (
                r.get("type") == "message_update"
                and (r.get("assistantMessageEvent") or {}).get("type") == "text_delta"
            )
        )
        pi.request(
            "prompt",
            {
                "message": "补充：请在同一回答里继续，务必提到情景文件名。",
                "streamingBehavior": "steer",
            },
        )
        wait_settled(pi)
        text = last_assistant_text(pi)
        assert marker in text, f"steer 后回应应包含情景文件名 {marker}：{text[:200]}"
        print("[4] steer ok（上下文保留，回应含前文要点）")

        # --- 5. abort 中断 ---
        pi.request("prompt", {"message": "从 1 数到 50，每行一个数字。"})
        pi.wait_event(
            lambda r: (
                r.get("type") == "message_update"
                and (r.get("assistantMessageEvent") or {}).get("type") == "text_delta"
            )
        )
        pi.request("abort", timeout=60.0)
        assert pi.events("agent_settled"), "abort 后应有 agent_settled"
        print("[5] abort ok")

        pi.close()

        # --- 6. 第二进程恢复会话 ---
        pi2 = PiClient(args.app, session_dir, "b")
        pi2.request("switch_session", {"sessionPath": session_file})
        msgs = pi2.request("get_messages")["messages"]
        roles = [m.get("role") for m in msgs]
        assert roles.count("user") >= 4, f"消息数异常：{roles}"
        assert any(
            m.get("role") == "assistant"
            and any(b.get("type") == "text" and b.get("text") for b in m.get("content") or [])
            for m in msgs
        ), "应有非空 assistant 文本"
        print(f"[6] 会话恢复 ok（{len(msgs)} 条消息）")
        pi2.close()

        print("SMOKE OK：pi RPC 全链路（握手/白名单/审批/steer/abort/会话恢复）通过")
        return 0
    finally:
        if args.keep:
            print(f"保留现场：{tmp}")
        else:
            subprocess.run(["rm", "-rf", tmp], check=False)


if __name__ == "__main__":
    sys.exit(main())
