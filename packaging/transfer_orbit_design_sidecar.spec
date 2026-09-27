# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for transfer-orbit-design sidecar（e2m2e serve-stdio，ADR 0035）。

onefile + windowed：单文件便于 tauri resources（binaries/* 通配）随安装器
分发；windowed 避免 Windows 上被 GUI 拉起时闪控制台窗口，协议走
stdin/stdout 管道不受影响。

与退役的旧 GUI spec（TransferOrbitDesign.spec，PyQt 时代）不同：sidecar
自带全部 e2m2e 依赖；SPICE 内核不打包，安装目录 resources 自带 kernels/
小内核，cwd 由 Tauri 壳指向 resource 根（e2m2e Config 按 cwd 相对解析），
.bsp 星历内核沿用 scripts/download_kernels.py 按需获取。

注意：依赖包自带的 data 文件必须逐包收编——collect_data_files 只收单个
包。R2S2 的 lte440.bsp/lte440.tpc（轮子内置月球精密星历）在包 import 时
经 CalcephBin.open 打开，漏收则 design_orbit 等星历链路工具全部报
"No ephemeris files are opened"（4.6.0 及之前版本的实际缺陷，发布流水线
的 sidecar 冒烟步骤即为此守卫）。

基线数据集（ADR 0036/0047）：e2m2e 5.9.5 起基线 CR3BP 族移出 wheel，release
流水线在构建前把 zip 下到 packaging/baseline/，这里整目录收进包（不解压，
首启由 sidecar_main 导入）。目录缺失只告警——本地临时构建不受罚，发布闸
由 smoke 的 --baseline 把关。

构建：uv run pyinstaller packaging/transfer_orbit_design_sidecar.spec --noconfirm
产物：dist/transfer-orbit-design-sidecar(.exe)，随后复制到 src-tauri/binaries/ 供 tauri 打包。
"""

import logging
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# SPECPATH 是 spec 所在目录（packaging/）
spec_dir = Path(SPECPATH).resolve()

datas = collect_data_files("e2m2e") + collect_data_files("R2S2")
baseline_dir = spec_dir / "baseline"
if baseline_dir.is_dir() and any(baseline_dir.glob("*.zip")):
    datas += [(str(baseline_dir), "baseline")]
else:
    logging.warning(
        "packaging/baseline/ 内无基线 zip，包内不含预置族；"
        "release 流水线应在构建前下载（见 .github/workflows/release.yml）"
    )
binaries = []
hiddenimports = [
    # calcephpy（e2m2e→r2s2 传递依赖）为 C 扩展包，可能经懒加载躲过静态分析
    "calcephpy",
    # e2m2e CLI 与协议层入口（serve-stdio 路径）
    "e2m2e.api.cli.main",
    "e2m2e.api.sidecar",
    "e2m2e.api.facade",
    "e2m2e.api.config",
    # 标准 MCP 服务端（mcp-serve 路径，本仓 ADR 0023）：mcp SDK 经 e2m2e
    # 函数级懒加载引入，静态分析可能漏抓，显式收编
    "mcp",
    "anyio",
]
# mcp.cli 依赖 typer（mcp[cli] extra，构建环境 --group build 不装）；
# serve-stdio 不经过 CLI（e2m2e api/mcp 只用 mcp.server / mcp.types），
# 收集时排除 mcp.cli，否则 collect_submodules 导入即炸。
# mcp.cli needs typer (mcp[cli] extra, absent from the --group build env);
# serve-stdio never goes through the CLI (e2m2e api/mcp only uses
# mcp.server / mcp.types), so exclude mcp.cli from collection.
hiddenimports += (
    collect_submodules("e2m2e")
    + collect_submodules("r2s2")
    + collect_submodules("mcp", filter=lambda name: not name.startswith("mcp.cli"))
    + collect_submodules("anyio")
)

a = Analysis(
    [str(spec_dir / "sidecar_main.py")],
    pathex=[str(spec_dir.parent)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="transfer-orbit-design-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)