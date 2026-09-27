"""把 e2m2e 基线数据集导入轨道库（开发机手动导入用）。

e2m2e 5.9.5 起基线 CR3BP 族移出 wheel（ADR 0047），改由 GitHub Release 资产
分发：发布链路在构建期下载 zip 随包分发、sidecar 首启自动导入。开发链路没有
那一步，用本脚本手动导入同一份 zip。

用法：
    uv run python scripts/import_baseline.py --download
    uv run python scripts/import_baseline.py --zip <path/to/baseline-cr3bp-*.zip>

参数：
    --zip PATH      基线 zip 的路径（Release 资产下载所得）。
    --download      改从 E2M2E_BASELINE_URL 下载（默认即发布钉的 URL）到系统
                    临时目录，再按上面的路径导入。
    --catalog-dir   轨道库目录写到哪里。缺省取环境变量 E2M2E_CATALOG_DIR
                    （Rust 壳注入的那个），再缺省用户配置目录下的 catalog/
                    （Windows %APPDATA%/transfer-orbit-design/catalog）。

幂等：同族且基线版本一致时跳过，版本变化时整族替换（上游 import_baseline
的 re-seed 语义），重复执行第二次导入 0 条。

English: import the e2m2e baseline dataset into the orbit catalog (manual
import for dev machines). Since e2m2e 5.9.5 the baseline CR3BP families left
the wheel (ADR 0047) and ship as a GitHub Release asset: the release pipeline
downloads the zip at build time and the sidecar imports it on first start. The
dev chain has no such step, hence this script.
Usage:
    uv run python scripts/import_baseline.py --download
    uv run python scripts/import_baseline.py --zip <path/to/baseline-cr3bp-*.zip>
Arguments:
    --zip PATH      path of the baseline zip (the downloaded Release asset).
    --download      fetch it from E2M2E_BASELINE_URL (default: the URL the
                    release pins) into the system temp directory first.
    --catalog-dir   directory of the catalog to write. Defaults to the
                    E2M2E_CATALOG_DIR env var (the one the Rust shell injects),
                    then to catalog/ under the user config directory (Windows
                    %APPDATA%/transfer-orbit-design/catalog).
Idempotent: a family whose baseline version matches is skipped, a version
change replaces the whole family (the re-seed semantics of upstream
import_baseline) — a second run imports 0 records.
"""

from __future__ import annotations

import argparse
import logging
import os
import pathlib
import shutil
import tempfile
import urllib.request
import zipfile

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]

#: 基线数据集 Release 资产（与 .github/workflows/release.yml 的同一个 URL）
DEFAULT_BASELINE_URL = (
    "https://github.com/cislunarspace/CODE-core/releases/download/"
    "data-baseline-5.9.0/baseline-cr3bp-5.9.0.zip"
)


def _default_catalog_dir() -> pathlib.Path:
    """库目录缺省值：env 优先，再缺省用户配置目录（与 Rust 壳同源）。"""
    env_dir = os.environ.get("E2M2E_CATALOG_DIR")
    if env_dir:
        return pathlib.Path(env_dir)
    from src.commons.paths import user_config_dir

    return user_config_dir() / "catalog"


def _bundle_dir(extracted: pathlib.Path) -> pathlib.Path:
    """定位解压后的基线束目录（直接含 JSON + NPZ 的那一层）。

    zip 内通常有单层根目录（``baseline-cr3bp-<ver>/``），而 import_baseline
    要求传入直接含束文件的目录——传错层会静默导入 0 条。
    """
    if any(extracted.glob("*.json")):
        return extracted
    nested = sorted(p for p in extracted.iterdir() if p.is_dir() and any(p.glob("*.json")))
    return nested[0] if nested else extracted


def main() -> int:
    parser = argparse.ArgumentParser(
        description="把基线数据集 zip 导入轨道库（幂等；开发链路手动导入用）"
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--zip", type=pathlib.Path, help="基线 zip 路径（Release 资产）")
    source.add_argument(
        "--download",
        action="store_true",
        help=f"从 E2M2E_BASELINE_URL 下载（默认 {DEFAULT_BASELINE_URL}）到系统临时目录",
    )
    parser.add_argument(
        "--catalog-dir",
        type=pathlib.Path,
        default=None,
        help="轨道库目录；缺省 E2M2E_CATALOG_DIR，再缺省用户配置目录下的 catalog/",
    )
    args = parser.parse_args()

    catalog_dir = args.catalog_dir or _default_catalog_dir()

    # 在 import e2m2e 之前钉住库目录：Config 从环境构造，这里是它的唯一输入
    # Pin the catalog directory before importing e2m2e: Config builds from the
    # environment and this is its only input.
    os.environ["E2M2E_CATALOG_DIR"] = str(catalog_dir)
    os.environ.setdefault("E2M2E_CATALOG_ENABLED", "1")

    from e2m2e.data.catalog import CatalogStore
    from e2m2e.data.catalog.baseline import import_baseline

    if args.download:
        url = os.environ.get("E2M2E_BASELINE_URL", DEFAULT_BASELINE_URL)
        fd, name = tempfile.mkstemp(prefix="baseline-", suffix=".zip")
        os.close(fd)
        zip_path = pathlib.Path(name)
        logger.info("下载基线数据集：%s → %s", url, zip_path)
        with urllib.request.urlopen(url) as response, zip_path.open("wb") as out:
            shutil.copyfileobj(response, out)
    else:
        zip_path = args.zip

    with tempfile.TemporaryDirectory(prefix="tod-baseline-") as tmp:
        extracted = pathlib.Path(tmp)
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(extracted)
        imported = import_baseline(CatalogStore(str(catalog_dir)), _bundle_dir(extracted))

    logger.info("导入完成：%d 条记录 → %s", imported, catalog_dir)
    if args.download:
        zip_path.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
