"""transfer-orbit-design sidecar 入口：透传子命令运行 e2m2e CLI。

打包产物默认以 serve-stdio 模式运行（无参数时；stdin/stdout 走 JSON 行 +
二进制帧协议，e2m2e ADR 0035，由 Tauri 壳现有工具链路拉起）；带参数时
透传给 e2m2e CLI——AI 助手的标准 MCP 链路以 `mcp-serve` 子命令拉起同一个
可执行文件（本仓 ADR 0023：两条 stdio 链路并存）。

启动时另做一次基线数据集首用导入：e2m2e 5.9.5 起基线 CR3BP 族不再打进
wheel，改由本仓在 release 构建期下载 zip 随包分发（packaging/baseline/，
ADR 0047）。导入只在计算链路的两种子命令（serve-stdio / mcp-serve）下、
catalog 已显式配置时尝试，失败只告警——用户库的可用性优先于预置族的
完整性，坏基线不该阻断主链路。
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
import zipfile
from pathlib import Path

from e2m2e.api.cli.main import main

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

#: 需要预置族的子命令：计算链路的两条 stdio 通道（catalog_* 等纯查询子命令
#: 不需要，用户也可能只是跑 CLI 打印帮助）。
_BASELINE_SUBCOMMANDS = ("serve-stdio", "mcp-serve")


def _bundle_dir(extracted: Path) -> Path:
    """定位解压后的基线束目录（直接含 JSON + NPZ 的那一层）。

    zip 内通常有单层根目录（``baseline-cr3bp-<ver>/``），而
    ``import_baseline`` 要求传入直接含束文件的目录——传错层会静默导入 0
    条，故这里显式下探一层。
    """
    if any(extracted.glob("*.json")):
        return extracted
    nested = sorted(p for p in extracted.iterdir() if p.is_dir() and any(p.glob("*.json")))
    return nested[0] if nested else extracted


def import_baseline_once(argv: list[str]) -> None:
    """导入随包分发的基线数据集（幂等：同版本重导零副作用）。

    复用上游 ``import_baseline``：库中已有同族且基线版本一致时跳过（尊重
    用户对基线成员的删除），版本不一致时整族替换——即上游的 re-seed 语义。
    """
    if not argv or argv[0] not in _BASELINE_SUBCOMMANDS:
        return
    # catalog 未配置时 e2m2e 本身不建库（ADR 0047），预置族无处可放
    if os.environ.get("E2M2E_CATALOG_ENABLED", "").strip().lower() not in ("1", "true", "yes"):
        return
    catalog_dir = os.environ.get("E2M2E_CATALOG_DIR")
    if not catalog_dir:
        return

    # onefile 运行时包内数据在 sys._MEIPASS；源码运行（uv run）时取模块同级，
    # 后者永不成立（仓库里没有 baseline/ 目录），因此开发链路走
    # scripts/import_baseline.py 手动导入。
    baseline_dir = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "baseline"
    zips = sorted(baseline_dir.glob("*.zip"))
    if not zips:
        return

    from e2m2e.data.catalog import CatalogStore
    from e2m2e.data.catalog.baseline import import_baseline

    try:
        with tempfile.TemporaryDirectory(prefix="tod-baseline-") as tmp:
            extracted = Path(tmp)
            with zipfile.ZipFile(zips[-1]) as archive:
                archive.extractall(extracted)
            imported = import_baseline(CatalogStore(catalog_dir), _bundle_dir(extracted))
        logger.info("基线数据集首用导入：%d 条记录（%s）", imported, zips[-1].name)
    except (zipfile.BadZipFile, FileNotFoundError, KeyError) as exc:
        logger.warning("基线数据集导入失败，跳过（用户库仍可用）：%s", exc)


if __name__ == "__main__":
    argv = sys.argv[1:] or ["serve-stdio"]
    import_baseline_once(argv)
    raise SystemExit(main(argv))
