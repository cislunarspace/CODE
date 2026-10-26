# CODE（地月空间轨道设计工具）

![CODE](assets/banner.png)

[![Release](https://img.shields.io/github/v/release/cislunarspace/CODE?label=release)](https://github.com/cislunarspace/CODE/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/cislunarspace/CODE/ci.yml?branch=master&label=CI)](https://github.com/cislunarspace/CODE/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/badge/docs-online-2f6feb)](https://cislunarspace.github.io/CODE/zh/)
[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python&logoColor=white)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

CODE（Cislunar Orbit DesignEr）是 [e2m2e](https://github.com/cislunarspace/CODE-core) 的桌面前端，把地月空间轨道设计所需的动力学模型、修正器、延拓器与转移算法封装为可视化应用。e2m2e 以 sidecar 子进程运行，React 前端负责界面，Rust 壳负责进程编排、协议转换与状态管理。界面不实现任务设计与修正算法，渲染侧只做 CR3BP 族成员重采样。算法不依赖界面。

项目面向两类读者。用界面完成轨道设计、保持、预报与转移任务的工程人员从安装与快速开始读起，维护前端、协议与打包链路的开发者从开发一节读起。

## 安装

从 [GitHub Releases](https://github.com/cislunarspace/CODE/releases) 下载对应平台安装包：

- Windows x64：`CODE_<版本>_x64-setup.exe`（NSIS，免管理员，装到当前用户目录）或 `.msi`。
- Linux amd64 / aarch64：AppImage、`deb` 或 `rpm`。

安装包内含 e2m2e 运行时（sidecar）、AI 助手运行时（pi）与全套 SPICE 内核（含行星历），安装后即可计算。下载后可对照 `checksums.txt` 校验。

### 更新

应用启动后静默检查一次更新，顶栏菜单也可手动检查。AppImage 与 Windows 安装包由更新插件直接替换，更新包不含内核，首次安装的内核原地复用。deb/rpm 在应用内下载完整安装包，再交给系统包管理器安装。更新元清单为 `latest-code.json`。4.9.0 及更早版本使用的 `latest.json` 已冻结，不再接收新版本。

## 快速开始

界面围绕一条固定流程组织。顶栏下方的步骤带依次是定基准、定任务、填参数、求解、校核、入库、情景。步骤带不是向导，任何一步都可以直接点开，当前阶段与未满足的前置条件同时显示。

1. 定基准。工具参数中的历元字段就是参考历元。必填历元为空时，步骤带列出阻断项，执行按钮禁用。工具没有必填历元时，这一步自动完成。
2. 定任务。在左侧导航的工具列表选择工具。工具列表按用户目标命名，不按代码模块划分。
3. 填参数。右侧参数停靠按工具的 JSON Schema 生成表单，数值框可切换显示单位。画布轨道清单也停靠在这里。
4. 求解。提交前先做防呆校验，缺项与越界在字段旁标红。计算在 sidecar 子进程中进行，状态栏显示进度。
5. 校核。三维视图标签展示轨迹。切到轨道信息标签，核对类型、数据系、Jacobi 常数、点数、时间跨度、来源。
6. 入库。轨道族生成、任务轨道设计、参数空间扫描、轨道保持、转移轨道设计的结果自动写入轨道库，成为带多维分类与谱系指针的记录。轨道预报与时空坐标转换只进结果层，重启不保留。
7. 情景。在左侧项目树点记录旁的图钉，把它加入固定层，与后续结果同屏对照。固定层记录数大于零、时间轴处于 et 时钟模式且在时间轴上选定时刻时，可把该时刻存为参考历元并保存情景文件。

主页面顶部是可开关的文档标签，分别是三维视图、轨道信息、轨道库。关闭标签只收起内容，三维视图的场景与相机保持原状。右侧助手边栏可收起，收起期间会话与流式回复继续。界面语言固定为简体中文。

## 能力

### 工具

左侧工具列表接通八个工具。参数、默认值、取值域来自 e2m2e 的 Pydantic 模型，升级 e2m2e 后重新导出 schema 即可。界面不另维护 schema 文件，条件校验与默认值仍有少量手工同步。

| 工具 | 作用 |
|---|---|
| 轨道族生成 | 生成 Halo、NRHO、Axial、Lissajous、SPO、LPO、Horseshoe、DRO 族，成员轨迹逐条上画布并入库 |
| 任务轨道设计 | 按轨道类型、振幅、相位、历元生成单条 CR3BP 周期轨道或 ELFO 冻结轨道 |
| 参数空间扫描 | 按族、平动点、主参数维度组合成网格，批量生成并入库 |
| 轨道保持 | 以星历记录为输入做蒙特卡洛控制仿真，输出受控星历与 Δv 统计 |
| 轨道预报 | 由给定初值向未来或过去积分一段星历轨迹 |
| 转移轨道设计 | 设计 HMN、LGA、WSB、PCN 四类已接通的转移。下拉另列低推力分支，专属参数尚未在面板暴露 |
| 时空坐标转换 | 支持会合系与 J2000、J2000 与 EPPR、GCRS 与 EBCRS 三对坐标系之间的六组双向转换 |
| 分区边界 | 计算 Rosengren Primer 五省分区参照几何，供画布区域图层使用，不入轨道库 |

参数停靠按 `orbit_type` 裁剪字段，只显示当前族适用的参数。可空字段留空即不传值，布尔字段用勾选控制。转移设计按转移类型联动显隐参数：HMN 填写目标地心半径，LGA、WSB 需要先在项目树选中一条轨道记录，PCN 在到达模式与出发模式的两套参数化中恰选其一。转移类型下拉还列出 low_thrust，专属参数尚未在面板暴露，当前不要选用。求解失败时错误码与原因在界面提示中显示，不伪造成功。

### 轨道库

轨道族生成、任务轨道设计、参数空间扫描、轨道保持、转移轨道设计的结果自动进入 e2m2e 轨道库。轨道预报与时空坐标转换只进结果层，重启不保留。一条记录可同时包含 CR3BP 段与星历段，带族类型、平动点、Jacobi、振幅区间等系统分类，也带用户标签、星标、备注。族成员各自成记，通过 `family_id` 与 `member_index` 关联所属批次。下游产物用 `source_record_id` 指向上游记录，重启后谱系不断。

轨道库标签打开即查询全库，可按族类型、平动点、Jacobi 区间、仅看星标过滤。多条记录可同时钉入固定层叠加显示。记录详情面板编辑备注与标签，项目树右键菜单删除，过滤栏导出教学案例包。安装包随带一份基线族数据，首次启动时导入，同版本跳过，版本变化时整族替换，不覆盖用户自己的记录。

### 画布

画布是 Three.js 三维视图，支持会合系与惯性 GCRS 两个视图系。数据按数据系标签解析，物理 km 除以 `DU_KM` 后入画。内容分结果层与固定层：结果层是最近一次计算或查看的产物，固定层是从轨道库钉住的记录。两层共用时间轴与取景，新轨迹到达、固定层增减或内容模式切换时自动适配一次，手动旋转与缩放的视角在其余重绘中保持。投影切换会把相机位置重置为对应投影的默认位置。

画布绘制 NASA 贴图的地球与月球，半径按真实比例放大 3 倍，Phong 光照产生晨昏线。参照层包括坐标轴与网格、地月空间分区图层、L1、L2 平动点。携带 Jacobi 常数的轨迹按当前取值范围归一后以 coolwarm 色带着色，无值轨迹回退颜色循环。画布轨道清单逐条标注数据系，区分会合无量纲、会合物理 km、地心惯性 km，数据系不随视图选择改变。

时间轴驱动时刻标记沿轨迹走查。转移结果的出发与到达脉冲以 Δv 事件标记显示，点击跳到对应时刻。图表设置可调线宽、字号、Z 轴比例、背景、参照层开关，设置即时生效并持久化。导出动画支持自转与时间轴播放两种模式，默认 8 秒，按 30 fps 编码为 webm。

### AI 助手

右侧助手边栏是一个对话式 agent，会话运行时为随应用分发的 pi。模型服务、API key、思考档位由 pi 原生配置管理，应用不收集也不保存密钥。首次使用时在设置分区打开终端，运行交互式 pi 完成 provider 登录。输入区上方的配置条直接切换模型与思考档，选项与 pi 原生配置同源。

助手组装工具参数并调用 e2m2e 工具。只读查询免确认直接执行，计算与改库先出工具卡片，用户可查看参数、批准或拒绝。助手触发的产物与手动运行语义一致：同一轨道库、同一谱系、同一画布叠加。会话跨重启恢复，多段会话可切换续聊。

## 数据与产物

计算请求从参数表单出发，经 Tauri command 交给 Rust 壳，再由 stdio 协议发往 e2m2e sidecar。sidecar 用 JSON 行信封描述响应结构，用二进制帧传大数组。支持入库的产物自动进入轨道库，项目树与画布再经 `catalog_query` 与 `catalog_get` 取用。AI 助手是并行的第二条链路：pi 的 RPC 会话经桥接扩展进入应用 MCP 桥接，由 `mcp-serve` 调同一套 e2m2e 工具，与画布上的长计算互不阻塞。

轨道库 `catalog/` 位于用户配置目录。Windows 为 `%APPDATA%/cislunar-code/catalog`，Linux 为 XDG 配置目录下的同名路径。目录由 Rust 壳启动时显式指定，不随工作目录漂移，预设 `E2M2E_CATALOG_DIR` 时以预设为准。库内是 e2m2e catalog 格式，含多维分类与谱系指针，可被 e2m2e 或其他宿主直接打开。`output/` 仅保留转移遗留分区与脚本场景。

## 文档

在线文档：<https://cislunarspace.github.io/CODE/zh/>。本地构建：

```bash
uv sync --extra docs
uv run sphinx-build -b html -D language=zh docs/source docs/build/html/zh
```

- [CONTEXT.md](CONTEXT.md)：领域术语表，代码与文档的用词以它为正典。
- [docs/architecture/architecture.md](docs/architecture/architecture.md)：分层、数据流与跨层契约。
- [docs/development.md](docs/development.md)：文档、代码与测试标准。
- [docs/adr/](docs/adr/)：架构决策记录。
- [CONTRIBUTING.md](CONTRIBUTING.md)：提 Issue 与 PR 的流程。
- [CHANGELOG.md](CHANGELOG.md)：版本历史。

## 开发

### 环境与启动

需要 Python 3.13、Node.js 20 以上与 Rust 稳定版工具链。前端测试实际需要 Node.js 22.13 以上。Linux 另需 Tauri 前置的 GTK 与 WebKit 开发库，见 [Tauri 前置条件](https://tauri.app/start/prerequisites/)。Python 依赖用 [uv](https://docs.astral.sh/uv/) 管理，前端依赖用 npm。

```bash
uv sync                             # Python 依赖
npm ci --prefix frontend            # 前端依赖
npx --prefix frontend tauri dev     # 开发模式启动
```

启动方式有两种，区别在算法侧从哪来。

- 开发模式 `npx --prefix frontend tauri dev`：起 Vite 开发服务器（`127.0.0.1:1430`），以 debug 配置编译并运行 Rust 壳，Rust 壳再用 `uv run e2m2e serve-stdio` 在仓库根拉起 sidecar。算法走仓库源码，改 Python 不用打包。
- 打包模式：先用 `uv run --no-sync pyinstaller packaging/cislunar_code_sidecar.spec --noconfirm` 产出 sidecar 单文件，把 `dist/cislunar-code-sidecar`（Windows 为 `.exe`）复制到 `src-tauri/binaries/`，再执行 `npm --prefix frontend exec -- tauri build --config packaging/tauri.release.conf.json`。这一档的 sidecar 取 `binaries/` 内的 PyInstaller 产物，与安装包一致。

### 调试

- 界面：改前端源码由 Vite 热更新即刻生效，不必重启。窗口内右键可开 devtools。界面只在桌面窗口里完整可用，纯浏览器打开 `127.0.0.1:1430` 发不出计算，因为 Tauri IPC 不在。
- Rust：`tauri dev` 监听 `src-tauri/`，改动后自动重编译并重启。
- Python：sidecar 是常驻子进程，改完代码要重启应用才生效。它的 stderr 直接打在 `tauri dev` 的终端，排障先看这里。
- 助手链路：开发期需要本机 pi，由 `TOD_PI_BIN` 指定或从 PATH 查找。mcp-serve 同样由 `uv run e2m2e mcp-serve` 拉起。

### SPICE 内核

SPICE 内核经 Git LFS 随仓库分发，克隆后位于 `kernels/`，安装包也已随带。纯 CR3BP 工具不需要行星历。需要另行准备内核的场景有三种：

- 自动下载：`uv run python scripts/download_kernels.py`，幂等拉取到 `kernels/`。
- 手动下载：从 e2m2e 的 [`kernels-v1` release](https://github.com/cislunarspace/CODE-core/releases) 解压到 `kernels/`。
- 自备数据：用 `SPICE_KERNEL_DIR` 指向已有内核目录，优先级最高。

内核官方来源为 [NASA NAIF](https://naif.jpl.nasa.gov/naif/data.html)。

### 测试与静态检查

```bash
uv run pytest tests/ -m "not spice"                # Python 领域层
cargo test --manifest-path src-tauri/Cargo.toml    # Rust 壳与 sidecar 协议
npm --prefix frontend run test                     # 前端（vitest）
uv run ruff check . && uv run ruff format --check . && uv run pyright  # Python 静态检查
```

CI 只跑 Python 测试与静态检查。Rust 与前端测试需要在本地跑。没有 Python 环境时，Rust 测试加 `-- --skip sidecar`。`assistant_pi_rpc` 用例依赖本仓库的 uv 环境，必须串行执行。

## 贡献

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。动手写代码之前先发 Issue 提案，小改动可以直接提 PR。

## License

[Apache 2.0](LICENSE)
