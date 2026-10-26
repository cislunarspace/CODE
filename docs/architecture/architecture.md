# CODE 架构设计

本文描述 CODE（Cislunar Orbit DesignEr，系统名 cislunar-code）的当前架构。逐项架构决策见 `docs/adr/`。4.9.0 及以前的发布名 transfer-orbit-design 只在历史记录与旧配置迁移中使用。

## 总体定位

CODE 是 e2m2e 的桌面前端。它不实现任务设计与修正算法，只做三件事：

1. 调用：把用户的工具选择与参数交给 e2m2e，发起任务轨道设计、轨道族生成、轨道保持、轨道预报、转移轨道设计、时空坐标转换、分区边界计算。
2. 管理：把计算产物写入轨道库，维护多维分类与谱系指针，让后续工具能引用上游记录。
3. 呈现：在三维画布上叠加结果层与固定层，提供时间轴、区域图层、轨道信息。

用户不需要了解 e2m2e 的内部结构，也不需要手动管理产物文件路径。少数工具接受显式路径输入，例如时空坐标转换的 `ephemeris_path`。界面把一次工作组织为定基准、定任务、填参数、求解、校核、入库、情景。

## 分层与进程边界

界面链路为 React 前端经 Tauri IPC 调 Rust 壳，Rust 壳经 stdio 与 e2m2e 进程通信。计算链路走 `serve-stdio`，AI 助手链路走标准 MCP 的 `mcp-serve`，两条链路相互独立。

| 层 | 位置 | 职责 |
|---|---|---|
| 前端 | `frontend/src/` | 文档标签、三维画布、参数停靠、项目树、助手边栏、i18n、图表设置 |
| Rust 壳 | `src-tauri/src/` | sidecar 进程管理、Tauri command、pi RPC 适配、MCP 桥接、项目状态、更新检查 |
| sidecar 协议 | e2m2e 侧 | `serve-stdio` 用信封 JSON 行描述结构、二进制帧传大数组。`mcp-serve` 提供标准 MCP stdio 工具接口 |
| 领域层 | `src/engine/`、`src/commons/`、`src/model/` | facade_bridge、catalog_service、单位换算、内核管理，供脚本与测试使用 |

关键机制有三条。

- schema 驱动表单：工具入参 schema 在构建期由 `tools/export_tool_schemas.py` 导出到 `frontend/src/toolSchemas/`，参数停靠按 schema 生成表单。升级 e2m2e 后重跑导出。导出产物中的 ADR 编号指 e2m2e 的编号空间，与本仓 `docs/adr/` 无关。
- 帧即渲染：sidecar 二进制帧由 Rust 壳转成 JSON 数字数组过 IPC，前端重建为 `Float32Array` 交给 Three.js 的 `BufferAttribute`，不落中间文件。族成员初态与周期由前端 CR3BP 传播器按周期重采样整条轨迹，方程与 e2m2e 对齐并有回归测试。
- 视图保持：内容变化时按包围盒适配一次，按对角线长度的 5% 向每侧扩展。除投影切换外，其余重绘保持用户视角。投影切换把相机位置重置为对应投影的默认位置。

## AI 助手链路

会话运行时是随应用分发的 pi，以 `pi --mode rpc` 启动，协议为 stdin/stdout JSONL。模型服务、凭据、思考档位、provider 登录由 pi 原生配置管理，应用不保存这些内容。会话文件落在应用配置目录的 `pi-sessions/`，由 `PI_CODING_AGENT_SESSION_DIR` 指定，与终端 pi 会话隔离。Rust 后端在 `src-tauri/src/assistant/`，负责 RPC 传输、pi 进程管理、事件转换、审批请求转发。pi 会话事件统一转换为 `assistant-event` 推给前端。引导走 pi 原生 steer，停止走 abort。

工具链路从桥接扩展开始。pi 进程加载 `src-tauri/resources/assistant/tod-bridge.ts`，扩展注册名为 tod 的 MCP 服务器，并拉起本二进制的 `--assistant-mcp-bridge` 模式。该模式由 `mcp.rs` 的最小 JSON-RPC stdio 客户端连接 `e2m2e mcp-serve`，同时暴露宿主情景工具。工具名形如 `mcp__tod__<工具名>`。

审批闸在扩展的 `tool_call` 拦截中。只读白名单（`catalog_query`、`catalog_get`、`scenario_list`、`valid_ranges`）免确认直接执行，其余工具经 `extension_ui_request` 子协议生成工具卡片，用户批准或拒绝。审批协议不携带改后参数。应用取消时对话框按 undefined 解析，扩展视为拒绝，保持 fail-closed。会话切换由 Rust 扫描会话目录，经 `switch_session` 与 `get_messages` 重建对话流。

## 顶层结构

```
CODE/
├── frontend/              # React 前端（Vite + TypeScript + Three.js）
│   └── src/               # 文档标签、schema 表单、画布、助手边栏、i18n、图表设置
├── src-tauri/             # Rust 壳（Tauri 2）
│   ├── src/sidecar/       # 帧解析与子进程管理
│   ├── src/assistant/     # pi RPC 适配、事件转换、宿主情景工具
│   ├── src/mcp.rs         # 最小 MCP stdio 客户端
│   ├── src/cmd.rs         # Tauri command
│   ├── src/state.rs       # Tauri 托管状态
│   ├── src/project.rs     # 项目状态
│   ├── src/stats.rs       # 系统性能采样
│   └── tests/             # 协议夹具与真实子进程集成测试
├── src/                   # Python 领域层
│   ├── model/             # Artifact 与 Project 数据类
│   ├── engine/            # facade_bridge、catalog_service、异常翻译、viz_adapter.py
│   └── commons/           # 常量、单位换算、内核与路径探测
├── docs/                  # 架构说明、ADR 与 Sphinx 源
├── tests/                 # Python 领域层测试
├── scripts/               # 内核下载、基线导入与发布冒烟脚本
├── catalog/               # 脚本与测试使用的轨道库，GUI 使用用户配置目录
└── pyproject.toml
```

## 数据模型

`Artifact` 是一次计算的产物，纯数据类，不依赖 e2m2e 对象。

```python
@dataclass
class Artifact:
    artifact_id: str         # catalog 记录 id，非 catalog 产物取 UUID 前 8 位
    artifact_type: str       # "orbit" | "family" | "transfer" | "ephemeris"
    label: str               # 用户可见名称
    orbit_type: str          # DRO/HALO/NRHO/...
    source_tool: str         # 产生此产物的工具名
    record_id: str | None    # 轨道库记录 id
    state_data: ndarray      # 状态矩阵 (n, 6)，catalog_get 懒加载填充
    times: ndarray           # 时间向量 (n,)
    output_path: Path | None # 遗留字段，仅供转移遗留分区
    extra: dict              # 分类、谱系指针、标签、备注、星历元数据
    created_at: datetime     # 创建时间
```

`Project` 管理一次会话中已加载的 Artifact，提供按 id、类型与轨道类型查询，以及沿 `extra["source_record_id"]` 追溯上游。项目本身不持久化，清单由轨道库承担，重启后经 `catalog_query` 恢复。

## 执行层

### FacadeBridge

e2m2e Facade API 的薄封装，负责配置注入、异常翻译与 catalog 读写转发。全部计算工具统一走 Facade 门面，不绕过门面直调算法层。结果 DTO 是可跨线程传递的纯数据类，含 numpy 数组、标量元数据与 `record_id` 或 `family_id` 入库回执。

- 周期族成员只携带初态与周期，桥接层按周期重采样供画布渲染，catalog 族记录复用同一辅助函数。
- e2m2e 5.6.5 起 `design_orbit` 首参为 `DesignOrbitRequest`。`duration` 由面板的年单位换算为秒，Lissajous 固定注入分段修正。
- 异常统一翻成结构化错误码与用户消息，例如 `CORRECTION_DIVERGED`、`PROPAGATION_FAILED`、`BACKEND_UNAVAILABLE`、`KERNEL_NOT_FOUND`、`INVALID_PARAMS`。原则是不伪造成功。

### CatalogService

轨道库的 GUI 语义层，负责摘要到 Artifact 的映射、`catalog_get` 懒加载填充、标注、提升、导出与删除转发。design 记录按双段填充，family 记录按成员堆叠并重采样，control 记录减去 μ。GUI 测试用桩 bridge 或小型真实库，不重测上游。

## 前端与 Rust 壳

前端组件说明见源码。`App.tsx` 组织顶栏、SOP 步骤带、侧边栏、文档标签、参数停靠、助手边栏与时间轴。`ParamsPanel` 按 schema 生成表单，`OrbitCanvas` 负责 Three.js 画布，`CatalogFilterBar` 与 `RecordDetailPanel` 服务轨道库，`assistant/` 下是助手边栏、对话流、会话切换与工具卡片。界面语言固定为简体中文，词典只有一份中文 `Record<string, string>`（ADR 0031）。

Rust 壳的模块划分见顶层结构。`sidecar/` 管帧与进程，`assistant/` 管 pi RPC，`mcp.rs` 是 MCP 客户端，`cmd.rs` 暴露 Tauri command，`state.rs` 持有 Tauri 托管状态，`update.rs` 管更新检查。

## 依赖方向

界面链路单向，无环。

| 调用方 | 被调用方 | 约束 |
|---|---|---|
| `frontend/` | `@tauri-apps/api` | 前端不直接 import e2m2e，不碰进程 |
| `src-tauri/` | sidecar stdio 协议 | Rust 壳只做编排，不做轨道力学 |
| sidecar | e2m2e Facade | 算法只进 sidecar |

Python 领域层供脚本与测试使用，不在界面链路上。唯一例外是 `scripts/download_kernels.py` 使用 `src/commons/kernels.py`。

| 模块 | 允许依赖 |
|---|---|
| `src/engine/` | `src/model/` 的 Artifact 与 Project 类型、`src/commons/`、e2m2e |
| `src/model/` | numpy |
| `src/commons/` | 无内部依赖，是叶子 |

硬规则：

1. `src/model/` 不 import `src/engine/`。
2. `src/engine/` 不 import 任何 GUI 框架。
3. `src/commons/` 只被上层引用，自身不引用 `src/model/` 或 `src/engine/`。
4. 前端与 Rust 壳不 import e2m2e 或 `src/`。界面需要的计算一律走 sidecar 协议。

## 跨层硬契约

以下五条跨层不变量违反即坏，改动前先看对应实现或注释。

1. `import e2m2e` 之前必须把内核目录写入 `SPICE_KERNEL_DIR`，见 `src-tauri/src/lib.rs` 的 setup 与 `tests/conftest.py`。
2. 单位换算的唯一来源是 `src/commons/units.py`。`DU_KM=384400`，`TU_SECONDS≈375190.26`（约 4.3425 天），由 e2m2e 模板常量导出。不得另立换算常量。前端的 TU 有两种口径，见 `frontend/src/paramOverlay/index.ts` 的注释。
3. 时间的唯一绝对基准是 et 秒（J2000 TDB），`frontend/src/timeBasis.ts` 是换算的唯一出口（ADR 0021）。
4. 质心归一（画布）与地心归一（算法层）的换算点是 `centroid_normalized_states`（减 μ）。理想化会合系到惯性系的旋转在 `viz_adapter` 与 `trajectoryParsing` 两处必须同口径。
5. `serde_json` 的 `preserve_order` 不能关，二进制帧的帧序依赖它，见 `src-tauri/Cargo.toml` 的注释。

## 可视化架构

画布是 Three.js 视图，支持会合系与惯性 GCRS 两个视图系。数据按数据系标签解析，物理 km 除以 `DU_KM` 后入画。画布内容分结果层与固定层，另有不参与取景适配的参照层。

```
Scene
├── 参照层：坐标轴与网格、地月空间分区图层
└── content Group
    ├── 固定层轨迹
    ├── 结果层轨迹
    ├── 地球与月球（NASA 贴图、Phong 光照、真实半径比例）
    └── L1、L2 平动点
```

轨迹数据有多条来路。族生成响应的成员初态经前端 CR3BP 传播器按周期重采样整条轨迹。轨道库记录经 `catalog_get` 取成员数据进固定层。工具结果含转移弧与星历段，由 `trajectoryParsing.ts` 按响应结构解析，物理 km 数据除以 `DU_KM` 归一后入画，时刻按 et 秒或历元 UTC 两级基准对齐时间轴。新轨迹到达、固定层增减或内容模式切换时自动适配一次，除投影切换外，其余重绘保持用户视角。

配色上，携带 Jacobi 常数的轨迹按当前取值范围归一后以 coolwarm 色带着色，附画布轨道清单与颜色条。无值轨迹回退颜色循环。画布轨道清单逐条标注数据系（会合无量纲、会合物理 km、地心惯性 km），数据系由解析层携带，不随视图选择改变。动画导出经 captureStream 与 MediaRecorder 编码 webm，不引入编码依赖。

## 管线串联

产物间的因果关系经轨道库谱系指针持久化。下游产物记录 `source_record_id`，重启后由 `catalog_query` 与 `catalog_get` 恢复清单与轨迹。族生成、入库、浏览叠加的链路可用，选中产物可以发起下游工具，输入引用经谱系记录衔接。上游记录被删时谱系断链，产物本身仍可用。

## 工具范围

左侧工具列表接通八个工具：轨道族生成、任务轨道设计、参数空间扫描、轨道保持、轨道预报、转移轨道设计、时空坐标转换、分区边界。轨道族生成、任务轨道设计、参数空间扫描、轨道保持、转移轨道设计的结果入轨道库。轨道预报与时空坐标转换只进结果层。分区边界产出进画布区域图层，不入库。工具由前端 `TOOL_REGISTRY` 注册，经通用 `run_tool` 通道下发 sidecar。

21 个工具 schema 已全部导出，包括 6 个 catalog 操作、5 个分区解析工具、6 个核心计算工具、2 个无参查询工具、2 个任务级工具。任务级工具 `low_thrust_preliminary`、`mission_architecture_search` 不进 GUI 表单，留档供 AI 助手链路。catalog 操作的界面分布是：query 与 get 服务轨道库浏览与轨迹叠加，sweep 在左侧工具列表，delete 在项目树右键菜单，export 在过滤栏，tag 在记录详情面板。AI 助手经 mcp-serve 调用同一套 e2m2e 工具，不受注册表限制。

GUI 不承诺承载 e2m2e 的全部算法能力。需要脚本化工作流时直接使用 [e2m2e CLI](https://github.com/cislunarspace/CODE-core)。

## 分发

发行版包括 Windows NSIS 安装器（currentUser 免管理员）、MSI，以及 Linux amd64、aarch64 的 AppImage、deb、rpm。安装目录包含 Tauri 主程序、`cislunar-code-sidecar` 与 SPICE 内核。sidecar 由 PyInstaller onefile 打包，spec 为 `packaging/cislunar_code_sidecar.spec`，datas 逐包收 e2m2e 与 R2S2 星历。内核随 Git LFS 入库，安装包也随带。

分发期 Rust 壳从 resource 目录拉起 sidecar，cwd 指向 resource 根，e2m2e Config 的 `kernels/` 按 cwd 相对解析，可用 `SPICE_KERNEL_DIR` 覆盖。轨道库目录不看 cwd，启动时由 `configure_catalog_env` 注入用户配置目录，预设 `E2M2E_CATALOG_DIR` 时以预设为准。

桌面端自动更新经 `@tauri-apps/plugin-updater` 基于 GitHub Releases 的 `latest-code.json`（ADR 0018，文件名断代见 ADR 0033）。发布管线在 `.github/workflows/release.yml`，由 `v*` tag 触发，依次做元数据校验、lint、测试、三平台构建、资产直传、产物数量核对、`checksums.txt` 与更新清单生成。版本 bump 时同步修改 `pyproject.toml`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`frontend/package.json` 四处、CHANGELOG 小节，`packaging/scripts/validate-release.sh` 在发布期把关一致。

## 测试策略

| 层级 | 测试类型 | 覆盖目标 |
|---|---|---|
| `src/model/` | 单元测试 | Artifact CRUD、Project 查询 |
| `src/engine/` | 集成测试 | FacadeBridge 到 e2m2e、catalog 读写、异常翻译 |
| `src/commons/` | 单元测试 | 单位换算、内核下载、可用性判断、路径探测 |
| `frontend/` | 单元测试（vitest） | CR3BP 传播器、轨迹解析、时刻基准、助手会话模型、区域图层、Jacobi 色标 |
| `src-tauri/` | 单元与集成测试（cargo test） | 帧解析、sidecar 拉起、崩溃自愈、真实子进程协议往返 |

CI 只跑 Python 测试与静态检查。Rust 与前端测试需要在本地跑。e2m2e 自身已通过其测试套件验证，CODE 不重复测试 e2m2e 的计算正确性。CODE 的测试关注界面行为、协议与数据流。

## 依赖

- 运行时：numpy、scipy 供 Python 领域层使用。Rust 侧为 Tauri 2，前端为 Node、Vite、Three.js，各自用锁文件管理。
- e2m2e：`e2m2e[mcp]>=5.9.8`。`[mcp]` extra 供 mcp-serve 使用（ADR 0023）。界面链路经 serve-stdio 直连 Facade，`src/engine/facade_bridge.py` 供脚本与测试使用。
- calcephpy：经 e2m2e 到 r2s2 的传递依赖。Windows 使用预编译 wheel，见 `pyproject.toml` 的 `[tool.uv.sources]`。
- 打包：PyInstaller 产 sidecar onefile，cargo-tauri 产 NSIS 安装器。pi 固定版本随包分发，版本号在 `release.yml` 的 env 中维护。
