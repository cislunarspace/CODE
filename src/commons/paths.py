"""跨层共享的路径常量与辅助工具。

Path constants and helpers shared across layers.
"""

import logging
import os
from pathlib import Path

from src.commons.kernels import user_kernel_dir

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

OUTPUT_DIR: Path = _REPO_ROOT / "output"

# 轨道库 catalog 默认目录（e2m2e 5.8.0，issue #375）：与 output/ 平级。
# sidecar 场景 cwd 不稳定，不能依赖 e2m2e Config 的相对默认（./catalog）；
# 改指其他目录经环境变量 E2M2E_CATALOG_DIR（由 Rust 壳注入）。
# Default orbit-library catalog directory (e2m2e 5.8.0, issue #375), sibling to output/.
# The sidecar cwd is unstable, so the relative default of e2m2e Config (./catalog) cannot
# be relied on; redirect via the E2M2E_CATALOG_DIR env var (injected by the Rust shell).
CATALOG_DIR: Path = _REPO_ROOT / "catalog"

logger = logging.getLogger(__name__)

__all__ = [
    "CATALOG_DIR",
    "OUTPUT_DIR",
    "detect_kernel_dir",
    "ensure_output_dir",
    "find_project_root",
    "safe_resolve_within",
    "user_config_dir",
]


def find_project_root(start: Path | None = None) -> Path:
    """从给定起点向上遍历，直到找到项目根目录。

    项目根目录定义为包含 pyproject.toml 或 .git 的目录。

    Args:
        start: 起始目录，默认使用调用者的 __file__ 所在目录

    Returns:
        项目根目录的绝对路径

    Raises:
        FileNotFoundError: 无法找到项目根目录

    English: walk upward from the given start until the project root is
    found. The project root is the directory containing pyproject.toml
    or .git. Args: ``start`` — starting directory, defaults to the
    caller's ``__file__`` directory. Returns: absolute path of the
    project root. Raises FileNotFoundError when no root is found.
    """
    current = (start or Path(__file__)).resolve().parent
    markers = ("pyproject.toml", ".git")

    for _ in range(20):  # 限制遍历深度，防止无限循环
        if any((current / marker).exists() for marker in markers):
            return current
        parent = current.parent
        if parent == current:
            break
        current = parent

    raise FileNotFoundError(f"无法从 {start or __file__} 找到项目根目录（包含 {markers} 的目录）")


def safe_resolve_within(user_path: str, allowed_root: Path) -> Path | None:
    """安全解析用户路径，验证其位于 allowed_root 内。

    Args:
        user_path: 用户提供的路径字符串
        allowed_root: 允许访问的根目录

    Returns:
        解析后的绝对路径；若路径在 allowed_root 外则返回 None

    English: safely resolve a user-supplied path, verifying it lies
    inside ``allowed_root``. Args: ``user_path`` — user-provided path
    string; ``allowed_root`` — root directory access is allowed within.
    Returns: the resolved absolute path, or None when the path lies
    outside allowed_root.
    """
    resolved = Path(user_path).expanduser().resolve()
    try:
        resolved.relative_to(allowed_root.resolve())
    except ValueError:
        return None
    return resolved


def ensure_output_dir(output_dir: str = "output") -> None:
    """确保输出目录存在。

    Ensure the output directory exists.
    """
    os.makedirs(output_dir, exist_ok=True)


def user_config_dir() -> Path:
    """用户配置目录（Windows ``%APPDATA%``，其余平台 XDG 配置目录）。

    Rust 侧 assistant store 沿用同一路径约定（src-tauri/src/assistant/
    store.rs，ADR 0023）。

    User configuration directory (Windows ``%APPDATA%``; XDG config
    directory elsewhere). The Rust assistant store follows the same path
    convention (src-tauri/src/assistant/store.rs, ADR 0023).
    """
    if os.name == "nt":
        base = os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming"
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config"
    return Path(base) / "cislunar-code"


def detect_kernel_dir() -> str:
    """探测 SPICE 内核目录。

    优先级：``$SPICE_KERNEL_DIR`` -> ``<repo>/kernels/`` -> 用户数据目录
    默认位置 -> ``<repo>/../e2m2e/kernels/``；找不到返回空串。

    （配置文件层 kernels_dir.txt 已随 #415 删除：生产由 Rust 壳在
    import e2m2e 前钉死环境变量，硬契约见 #414 第 5 条。）

    注意：本函数只判断目录存在，不校验内核完整性；完整性判断见
    ``src.commons.kernels.kernel_dir_usable``。

    e2m2e 改为 pip 安装后，其内部闰秒内核（``.tls``）的自动搜索路径按源码仓库
    布局计算父目录（``parents[3]``），在 site-packages 布局下指向错误位置，导致
    ``SPICE(NOLEAPSECONDS)``、轨道设计失败。规避：调用方须在 import e2m2e 之前
    把本函数返回值写入 ``SPICE_KERNEL_DIR``（e2m2e 的第二搜索路径），现行做法见
    ``src-tauri/src/lib.rs`` 与 ``tests/conftest.py``。

    English: detect the SPICE kernel directory. Priority:
    ``$SPICE_KERNEL_DIR`` -> ``<repo>/kernels/`` -> user-data default
    location -> ``<repo>/../e2m2e/kernels/``; returns an empty string
    when nothing is found. (The kernels_dir.txt config layer was removed
    with #415: production pins the env var in the Rust shell before
    importing e2m2e — hard contract, #414 item 5.) Note: this function
    only checks directory existence, not kernel completeness — see
    ``src.commons.kernels.kernel_dir_usable`` for that. After e2m2e
    moved to a pip install, its internal leap-second kernel (``.tls``)
    auto-search path computes the parent directory per the source-repo
    layout (``parents[3]``), which points to the wrong place under
    site-packages and causes ``SPICE(NOLEAPSECONDS)`` and orbit-design
    failures. Workaround: callers must write this function's return
    value into ``SPICE_KERNEL_DIR`` (e2m2e's second search path)
    *before* importing e2m2e — see ``src-tauri/src/lib.rs`` and
    ``tests/conftest.py`` for the current practice.
    """
    env_val = os.environ.get("SPICE_KERNEL_DIR", "")
    if env_val and Path(env_val).is_dir():
        return env_val

    # 本项目自带 kernels/（小内核入库，.bsp 由 scripts/download_kernels.py 补）
    # This project ships its own kernels/ (small kernels checked in; .bsp fetched by
    # scripts/download_kernels.py).
    own = _REPO_ROOT / "kernels"
    if own.is_dir():
        return str(own)

    # 用户数据目录默认位置（GUI 引导下载的落点）
    # Default user-data location (where GUI onboarding downloads land).
    user_dir = user_kernel_dir()
    if user_dir.is_dir():
        return str(user_dir)

    # 回退：同父目录的 e2m2e 源码仓库内核（开发机历史布局）
    # Fallback: kernels in a sibling e2m2e source checkout (historical dev-machine layout).
    candidate = _REPO_ROOT.parent / "e2m2e" / "kernels"
    if candidate.is_dir():
        return str(candidate)
    return ""
