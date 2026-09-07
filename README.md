# transfer-orbit-design - 地月空间轨道设计 GUI

[![Release](https://img.shields.io/github/v/release/cislunarspace/transfer-orbit-design?label=release)](https://github.com/cislunarspace/transfer-orbit-design/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/cislunarspace/transfer-orbit-design/ci.yml?branch=master&label=CI)](https://github.com/cislunarspace/transfer-orbit-design/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python&logoColor=white)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

transfer-orbit-design 是 [e2m2e](https://github.com/cislunarspace/e2m2e) 的 GUI 前端。e2m2e 提供地月空间轨道设计所需的动力学模型、修正器、延拓器与转移算法，本仓库把它们封装成可视化桌面应用。v4.0.0 起 GUI 为 Tauri 2 架构：React 前端负责界面，Rust 壳负责进程编排，e2m2e 以 sidecar 子进程运行（stdio JSON 行 + 二进制帧协议）：界面不碰算法，算法不进界面。

## 安装

### 桌面应用（Windows / Linux）

从 [GitHub Releases](https://github.com/cislunarspace/transfer-orbit-design/releases) 下载对应平台的安装包：Windows x64 用 `transfer-orbit-design_<版本>_x64-setup.exe`（NSIS 安装器，免管理员权限，安装到当前用户目录）或 `.msi`；Linux amd64 / aarch64 用 AppImage、`deb` 或 `rpm`。所有安装包内含 e2m2e 运行时（transfer-orbit-design-sidecar）与全套 SPICE 内核（含行星历），开箱即用。下载后请对照 `checksums.txt` 校验。已安装的应用自动接收应用内更新：AppImage 与 Windows 安装包由更新插件直接替换（更新包不含内核，首次安装的内核原地复用）；deb/rpm 安装在应用内下载完整安装包并经系统包管理器安装（需输入管理员密码）。

### 开发环境

要求 Python >= 3.13、Node.js >= 20、Rust 稳定版工具链，包管理用 [uv](https://docs.astral.sh/uv/)：

```bash
uv sync                        # Python 依赖（e2m2e[mcp]>=5.9.0 等）
npm ci --prefix frontend       # 前端依赖
npx --prefix frontend tauri dev     # 开发模式启动：Vite 热更新 + Rust 壳拉起 sidecar
```

## SPICE 内核

SPICE 内核随 Git LFS 随仓库分发（克隆后位于 `kernels/`），安装包也已随带；纯 CR3BP 工具用不到行星历。需要另行准备的场景（精简环境、自备数据）：

- **自动下载**：`uv run python scripts/download_kernels.py`，幂等拉取到 `kernels/`；
- **手动下载**：从 e2m2e 的 [`kernels-v1` release](https://github.com/cislunarspace/e2m2e/releases) 解压到 `kernels/`（sidecar 工作目录下的相对路径）；
- **自备数据**：`$SPICE_KERNEL_DIR` 指向已有内核目录（优先级最高）。

官方来源：[NASA NAIF](https://naif.jpl.nasa.gov/naif/data.html)（备用）。

## 快速开始

1. 启动后左栏默认项目页签；切到轨道库页签自动加载全库，过滤栏可按族类型、平动点、Jacobi 与振幅区间、标签组合筛选。
2. 中栏工具面板：下拉选择工具（轨道族生成 / 任务轨道设计 / 参数空间扫描 / 轨道保持 / 轨道预报 / 转移轨道设计 / 时空坐标转换 / 分区边界），参数表单按工具的 JSON Schema 自动生成，点执行。
3. 轨道族生成选族类型（Halo / NRHO / Axial / Lissajous / SPO / LPO / Horseshoe / DRO），按族显示对应参数（振幅上下限、近月点高度、相位等）；其余工具各自渲染参数表单。
4. 结果轨迹随即出现在右侧画布：左键拖拽旋转、滚轮缩放；适配按钮按轨迹包围盒复位视角。轨道库记录可钉入固定层（多选同屏），与结果层对照显示。
5. 右侧助手边栏在 omp 完成原生配置后可对话式发起计算（见「AI 助手」）；界面固定简体中文。

## 能力

- **工具面板**：八个工具接入：轨道族生成、任务轨道设计、参数空间扫描、轨道保持、轨道预报、转移轨道设计、时空坐标转换、分区边界（地月空间分区参照层）。轨道稳定性暂不接入（上游 e2m2e 将其标为 placeholder，空参 schema）。参数表单由各工具的 JSON Schema 自动生成（字段裁剪、范围与默认值随 e2m2e 模型走），经通用工具执行通道（Rust `run_tool` 命令）直达 sidecar，错误直显；执行前防呆校验（必填与数值范围，内联标红）。转移设计的参数面板按转移类型联动显隐，LGA/WSB 提交时自动取选中轨道工件换算到会合系物理单位注入目标星历。
- **AI 助手（omp 会话运行时，ADR 0022/0030）**：右侧可折叠、可拖宽的助手边栏。模型服务与 API key 由 omp 原生配置管理（BYOK：在 omp 里自备 key；应用设置面板只显示 omp 入口状态与打开 omp 配置的按钮，不收集不保存密钥）。助手由随应用分发的 omp（ACP 协议）承载会话与 agent loop，工具经应用桥接调 e2m2e 与宿主情景工具。工具调用分级确认：只读查询免确认直接执行，计算与改库工具先出工具卡片待确认/拒绝（审批协议不带改参）。会话跨重启由 omp 回放恢复，多会话可切换续聊；思考等级按会话三档（关/标准/深度）。助手触发的产物与手动运行语义一致：同一轨道库与画布叠加。开发期需本机 omp（`TOD_OMP_BIN` 或 PATH），安装版随包分发固定版本 omp。
- **轨道族生成**：八族（七族 + DRO）周期延拓/参数采样，成员轨迹逐条渲染。
- **轨道库浏览**：产物自动入 e2m2e 轨道库（catalog 多维分类），多维过滤查询；记录多选同屏绘制，可写备注、加星标；标注、族成员提升、导出包与删除的界面入口齐备。
- **画布**：Three.js 3D 视图，内容分结果层（当前计算产物，随计算替换）与固定层（钉住的库记录，软上限 5 条提示）双层。NASA 贴图天体（真实半径比例、Phong 光照与晨昏线）、XYZ 坐标轴与网格参照层、地月空间分区图层（Rosengren Primer 分区边界：Hill/SOI/Battin 等参照几何）；轨迹按 Jacobi 常数 coolwarm 着色＋颜色条，无值回退颜色循环；图例逐条标注轨迹数据系（会合无量纲 / 会合物理 km / 地心惯性 km）。时间轴播放/拖动驱动画布时刻标记沿轨迹走查，机动事件（出发/到达脉冲）以 chip 标注、点击跳转；图表设置（线宽/标注/坐标轴与分区图层开关/背景/量程）持久化、webm 动画导出。

## 数据流与产物

画布计算的数据流：参数表单 → Rust 命令 → e2m2e sidecar（JSON 行信封 + 二进制帧，e2m2e ADR 0035）→ 产物自动入轨道库 → 项目树/画布经 `catalog_query` / `catalog_get` 取用。AI 助手是并行的第二条链路：omp（ACP）→ 应用 MCP 桥接 → `mcp-serve` 调同一套工具，只读查询与画布长计算互不阻塞（ADR 0030）。

产物持久化在 `catalog/` 目录（开发期仓库根 `catalog/`；安装版在安装目录下）。轨道库是 e2m2e catalog 格式（多维分类、谱系指针），可以直接被 e2m2e 或其他宿主打开；`output/` 仅保留转移遗留分区与脚本场景。

## 文档

在线文档：<https://cislunarspace.github.io/transfer-orbit-design/zh/>

本地构建：

```bash
uv sync --extra docs
uv run sphinx-build -b html -D language=zh docs/source docs/build/html
```

## 测试与代码规范

```bash
uv run pytest tests/ -m "not spice"     # Python 领域层
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 壳与 sidecar 协议
npm --prefix frontend run test          # 前端（vitest）
uv run ruff check . && uv run pyright   # Python 静态检查
```

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[Apache 2.0](LICENSE)
