"""mcp-serve 冒烟脚本：spawn → initialize 握手 → tools/list → design_orbit 真调用。

验证本仓 ADR 0023 依赖的链路真实可用，并兼作发布流水线的打包冒烟闸：
design_orbit 走完整星历修正链（懒加载 R2S2 → CalcephBin.open 包内
lte440.bsp → SPICE 内核加载 → 修正收敛），打包漏带任何一环都会在此变红，
坏包发不出去。

带 ``--baseline <zip>`` 时另开一个临时轨道库，把基线 zip 交给同一个
子进程的首用导入逻辑（env 注入 E2M2E_CATALOG_DIR/ENABLED，与 Rust 壳
生产口径一致），再按 tag=baseline 查询断言库内成员记录数——随包分发的
基线数据集漏带或残缺同样在此变红。

用法：
    开发（默认）：uv run e2m2e mcp-serve，cwd=仓库根
    打包：--exe <sidecar 路径> --cwd <resource 根> --kernels <SPICE 内核目录>
    打包含基线：同上 + --baseline packaging/baseline/baseline-cr3bp-5.9.0.zip

一次性与 CI 双用，不进仓库测试套件。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# design_orbit 冒烟参数：HALO L1 北族，10 天短弧（venv 实测秒级收敛），
# 走 segmented 星历修正——恰好覆盖 R2S2/SPICE 全链路。
DESIGN_ARGS = {
    "orbit_type": "HALO",
    "collinear_point": 1,
    "north_south": 1,
    "amplitude": 20000.0,
    "phase": 0.5,
    "epoch": [2024, 1, 1, 0, 0, 0],
    "duration": 864000,
    "output_step": 3600,
    "correction_method": "segmented",
}

#: 基线数据集门槛：成员记录数下限（5.9.0 束共 13 族 592 条成员）+ 族数下限。
#: 单看条数会漏掉"缺族"——去掉 5 个族仍有 533 条，落在 500 之上，缺了预置族的
#: 安装包照样能过闸；族数下限防这一头，条数下限防"某族只导入一部分"。两者都留
#: 余量（不钉精确值），上游加族加成员不会让冒烟变红。
#: Thresholds for the baseline dataset: a floor on member records (the 5.9.0 bundle
#: has 13 families / 592 members) plus a floor on families. Record count alone misses
#: missing families (dropping 5 families still leaves 533, above 500, so a package
#: without preloaded families would pass); the family floor covers that side, the
#: record floor covers a partially imported family. Both keep headroom (no pinned
#: exact values) so upstream adding families or members never turns the smoke red.
MIN_BASELINE_RECORDS = 500
MIN_BASELINE_FAMILIES = 13


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", help="打包 sidecar 可执行文件路径（缺省走 dev uv 拉起）")
    parser.add_argument("--cwd", default=REPO_ROOT, help="子进程工作目录（默认仓库根）")
    parser.add_argument(
        "--kernels",
        help="SPICE 内核目录，写入子进程 SPICE_KERNEL_DIR（打包冒烟必传）",
    )
    parser.add_argument(
        "--baseline",
        help="基线数据集 zip 路径（构建期下载的那个）：给出后开临时库目录并断言包内基线导入条数",
    )
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    command = [args.exe, "mcp-serve"] if args.exe else ["uv", "run", "e2m2e", "mcp-serve"]

    env = os.environ.copy()
    if args.kernels:
        env["SPICE_KERNEL_DIR"] = os.path.abspath(args.kernels)

    # 基线断言走临时库目录：预置族落库需要与 Rust 壳一样的两个 env
    # The baseline assertion uses a temp catalog: preloading families needs the
    # same two env vars the Rust shell injects.
    baseline_tmp = None
    if args.baseline:
        if not os.path.isfile(args.baseline):
            logger.error("FAIL: 基线 zip 不存在：%s（release 流水线应在构建前下载）", args.baseline)
            return 1
        baseline_tmp = tempfile.mkdtemp(prefix="smoke-catalog-")
        env["E2M2E_CATALOG_DIR"] = baseline_tmp
        env["E2M2E_CATALOG_ENABLED"] = "1"

    proc = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",  # mcp-serve 输出 UTF-8；Windows 默认 GBK 会炸
        errors="replace",
        cwd=args.cwd,
        env=env,
    )

    def send(msg: dict) -> None:
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    def read_until(req_id: int) -> dict:
        assert proc.stdout is not None
        while True:
            line = proc.stdout.readline()
            if not line:
                err = proc.stderr.read() if proc.stderr else ""
                raise RuntimeError(f"mcp-serve 提前退出。stderr:\n{err[-2000:]}")
            msg = json.loads(line)
            if msg.get("id") == req_id:
                return msg

    send(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "smoke", "version": "0"},
            },
        }
    )
    init_resp = read_until(1)
    server = init_resp.get("result", {}).get("serverInfo", {})
    logger.info("initialize → serverInfo=%s", json.dumps(server, ensure_ascii=False))

    send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tools_resp = read_until(2)
    tools = tools_resp.get("result", {}).get("tools", [])
    logger.info("tools/list → %d 个工具", len(tools))
    if not tools:
        logger.error("FAIL: tools/list 为空")
        proc.kill()
        return 1

    send(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "design_orbit", "arguments": DESIGN_ARGS},
        }
    )
    call_resp = read_until(3)
    result = call_resp.get("result", {})
    is_error = result.get("isError", False)
    content = result.get("content", [])
    text = content[0].get("text", "") if content else ""
    logger.info("tools/call design_orbit → isError=%s, text=%s", is_error, text[:400])

    # 基线断言：条数由子进程自己的首用导入写进库，故这里查到多少条即包内
    # 基线数据真实落库多少条（漏带 → 0 条 → 红）
    # Baseline assertion: the child's own first-use import wrote the records, so
    # whatever this query returns is exactly what the bundled baseline data
    # produced (missing bundle → 0 records → red).
    baseline_count = None
    baseline_families = 0
    if baseline_tmp:
        send(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {"name": "catalog_query", "arguments": {"tags": ["baseline"]}},
            }
        )
        query_resp = read_until(4)
        qresult = query_resp.get("result", {})
        qcontent = qresult.get("content", [])
        qtext = qcontent[0].get("text", "") if qcontent else ""
        try:
            records = json.loads(qtext).get("data", {}).get("records", [])
            baseline_count = len(records)
            baseline_families = len({r.get("family_id") for r in records if r.get("family_id")})
        except (json.JSONDecodeError, AttributeError):
            logger.error("FAIL: catalog_query 返回无法解析：%s", qtext[:400])
            proc.kill()
            return 1
        logger.info(
            "tools/call catalog_query(tag=baseline) → %d 条记录 / %d 族",
            baseline_count,
            baseline_families,
        )

    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()

    if baseline_tmp:
        shutil.rmtree(baseline_tmp, ignore_errors=True)

    if is_error or "converged" not in text:
        logger.error("FAIL: design_orbit 未收敛或返回错误")
        return 1
    if baseline_count is not None and (
        baseline_count < MIN_BASELINE_RECORDS or baseline_families < MIN_BASELINE_FAMILIES
    ):
        logger.error(
            "FAIL: 库内基线 %d 条 / %d 族，少于 %d 条 / %d 族——包内基线数据集缺失、"
            "缺族或导入残缺（检查构建前的下载步骤与 spec 的 datas）",
            baseline_count,
            baseline_families,
            MIN_BASELINE_RECORDS,
            MIN_BASELINE_FAMILIES,
        )
        return 1
    logger.info("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
