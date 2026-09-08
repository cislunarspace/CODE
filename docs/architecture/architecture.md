# transfer-orbit-design 架构设计

> 本文描述 transfer-orbit-design（以下简称 tod）的**最终形态**架构。逐项架构决策见 `docs/adr/`。

## 总体定位

tod 是 **e2m2e 的 GUI 前端**。它不实现任何轨道力学算法，只做三件事：

1. **调用**：通过 e2m2e Facade API 发起计算任务（任务轨道设计、轨道族生成、轨道保持、轨道预报、转移轨道设计、稳定性分析、时空坐标转换）。
2. **管理**：追踪用户工作会话中的全部计算产物（轨道、轨道族、转移结果），提供结构化的数据导航和管线串联。
3. **呈现**：将计算结果以内嵌可视化的方式展示在主窗口中，支持 3D/2D 轨道图、多轨道叠加、地月系统标注。

用户不需要知道 e2m2e 的内部结构，也不需要手动管理文件路径。tod 把 e2m2e 的能力封装为选工件 → 选操作 → 看结果的三步交互。

## 总体分层

自 ADR-0014 起，GUI 为 Tauri 架构（Rust 壳 + React 前端），e2m2e 经
sidecar 子进程驱动（协议 = e2m2e ADR 0035：信封 JSON 行 + 二进制帧）。
原 PyQt 四层中的表现层/入口层已被替换，数据层与执行层的纯 Python 部分
保留为领域资产。

```
React 前端（frontend/） ←Tauri IPC→ Rust 壳（src-tauri/）
                                        ↕ stdio 协议（两条独立链路）
                                   e2m2e serve-stdio（开发期 uv 拉起；分发期为打包进安装器的
                                   transfer-orbit-design-sidecar，见分发节）
                                   e2m2e mcp-serve（标准 MCP，仅 AI 助手链路使用）
```

| 层 | 位置 | 职责 |
|:---|:---|:---|
| 前端 | `frontend/src/` | React 组件：项目树、参数面板（schema 自动表单）、Three.js 画布、助手边栏、i18n、图表设置 |
| Rust 壳 | `src-tauri/src/` | sidecar 进程管理（拉起/重试/进度事件）、Tauri command、agent loop（LLM 流式 + 最小 MCP client）、项目状态（内存 Artifact 容器） |
| sidecar 协议 | e2m2e 侧 | `serve-stdio`：信封 JSON 行 + f32/f64 二进制帧（大数组），见 e2m2e ADR 0035；`mcp-serve`：标准 MCP stdio（同步计算在线程池，可并发） |
| 领域层（Python） | `src/engine/`、`src/commons/`、`src/model/` | facade_bridge / catalog_service / 单位换算 / 内核管理，e2m2e 语义的 Python 侧资产，工具脚本与测试继续使用 |

**关键机制**：

- **schema 驱动表单**：工具入参 schema 构建期导出（`tools/export_tool_schemas.py` → `frontend/src/toolSchemas/`），参数面板自动生成；升级 e2m2e 后重跑导出。`toolSchemas/*.json` 由上游导出管线生成，其中提及的 ADR 编号均指 **e2m2e 侧编号空间**，与本仓 `docs/adr/` 编号无关（不改导出产物，改了会被下次导出覆盖）。
- **帧即渲染**：sidecar 二进制帧由 Rust 壳转成 JSON 数字数组过 IPC，前端重建为
  `Float32Array` 直进 Three.js `BufferAttribute`，无中间文件格式；族成员初态 +
  period 由前端 CR3BP 传播器重采样整条轨迹（方程对齐 e2m2e，有回归测试）。
- **视图保持**：布局不变的重绘不重置相机；每批新轨迹数据到达做一次视图适配
  （按包围盒复位相机，5% 余量），此后重绘保持用户视角（CONTEXT.md 领域语义）。

## AI 助手链路（ADR 0022/0023/0025/0026）

agent loop 宿主在 Rust 后端（`src-tauri/src/assistant/`：llm / prompt /
store / summary）：reqwest 调 OpenAI 兼容协议（SSE 流式），流式增量经
Tauri event 推前端；API key 存 OS keychain（keyring crate），不进 webview
JS 上下文。工具调用走独立常驻的 `mcp-serve` 进程（Rust 侧 `mcp.rs` 实现
initialize / tools/list / tools/call 三个方法的最小 JSON-RPC stdio client），
进程管理沿用 ADR 0019 的懒启动＋崩溃自愈＋Job Object 兜底。并发语义：
AI 只读查询（mcp-serve 线程池）与画布长计算（serve-stdio 串行单例）互不
阻塞。工具结果进 LLM 上下文前过摘要层，轨迹等大数组不进上下文，只带
record_id 与诊断摘要；计算与改库工具的调用在前端以工具卡片分级确认，
只读查询免确认。会话以 JSONL 持久化在用户配置目录
（`sessions/<id>.jsonl`），支持多会话切换与续聊回放。

## 顶层结构（最终形态）

```
transfer-orbit-design/
├── frontend/              # React 前端（Vite + TS + Three.js）
│   └── src/               # 组件、schema 驱动表单、i18n、画布、助手边栏、录制导出
├── src-tauri/             # Rust 壳（Tauri 2）
│   ├── src/sidecar/       # 帧解析（frames）+ 子进程管理（process）
│   ├── src/assistant/     # agent loop（llm / prompt / store / summary）
│   ├── src/mcp.rs         # 最小 MCP stdio client（连 mcp-serve）
│   ├── src/cmd.rs         # Tauri command（工具执行/目录查询/项目状态）
│   └── tests/             # 协议夹具测试 + 真实子进程集成测试
├── src/                   # Python 领域层（纯 Python，无 Qt）
│   ├── model/             # Project/Artifact（数据类）
│   ├── engine/            # facade_bridge / catalog_service
│   ├── commons/           # 跨层常量与共享工具
│   │   ├── constants.py   # DU/TU/物理常量
│   │   ├── units.py       # 单位换算（年/月/日/TU、km/DU）
│   │   ├── kernels.py     # 内核下载/可用性判断（CLI 与 GUI 共用）
│   │   └── paths.py       # 内核/库目录探测
│   └── __init__.py
├── docs/                  # 文档
│   ├── adr/               # 架构决策记录
│   ├── architecture/      # 架构说明
│   └── source/            # Sphinx 源（docs/README.md 说明维护流程）
├── tests/                 # Python 领域层测试（commons/engine/model 分层）
├── scripts/               # 独立工具脚本（download_kernels.py / smoke_mcp_serve.py）
├── catalog/               # 轨道库（e2m2e catalog，产物持久化源；设置可改指）
└── pyproject.toml
```

**删除的旧代码**（大爆炸替换）：

| 旧目录 | 原因 |
|---|---|
| `tod/gui/` | 被 `src/view/` + `src/app/` 替代 |
| `tod/generates/` | 被 e2m2e Facade API 直调替代 |
| `tod/transfers/` | 被 e2m2e Facade API 直调替代 |
| `tod/scripting/` | SCRIPT_ENTRY 机制废弃 |
| `tod/commons/e2m2e_compat.py` | 不再需要旧路径兼容 |
| `plot/`（顶层） | v3.2.1 起 e2m2e 删除 `tools/viz`；本仓曾收编为 `src/commons/viz/` 自维护，随 #415 删除（包外零使用零覆盖） |
| `src/engine/persistence.py` + `src/model/discovery.py` | catalog 之外的产物落盘/扫描链路，只被测试消费（#415） |

## 第1层 数据层 `src/model/`

### Artifact

一次计算的产出物。纯数据类，不依赖 Qt 或 e2m2e。

```python
@dataclass
class Artifact:
    artifact_id: str        # catalog 产物取 record_id；非 catalog 产物为 UUID 前 8 位
    artifact_type: str      # "orbit" | "family" | "transfer" | "ephemeris"
    label: str              # 用户可见名称
    orbit_type: str         # DRO/Halo/NRHO/...
    source_tool: str        # 产生此 Artifact 的 Facade 方法名（catalog_promote 为提升成员）
    record_id: str | None   # 轨道库记录 id（e2m2e catalog，issue #375）
    state_data: ndarray     # 状态矩阵 (n, 6)，用于可视化（catalog_get 懒加载填充）
    times: ndarray          # 时间向量 (n,)
    output_path: Path | None # 遗留字段（transfer 遗留分区扫描使用，扫描已随 #415 删除）
    extra: dict             # 元数据（分类、谱系指针、tags/note、星历四件套等）
    created_at: datetime    # 创建时间
```

### Project

管理一次工作会话的全部 Artifact。**Project 不做持久化**，清单由轨道库 catalog 承担（`catalog_query` 供数）。

```python
class Project:
    name: str
    artifacts: list[Artifact]

    def add(artifact) -> None
    def remove(artifact_id) -> bool
    def get_by_id(artifact_id) -> Artifact | None
    def get_by_type(type) -> list[Artifact]
    def get_by_orbit_type(orbit_type) -> list[Artifact]
    def find_upstream(artifact) -> Artifact | None  # 读 extra["source_record_id"] 谱系追溯
    def has_broken_lineage(artifact) -> bool        # 上游已删（断链降级标记）
```

### Discovery（遗留分区扫描，已删）

转移轨道是 catalog 分类体系之外的产物（上游入库另行立项），曾过渡期沿用 `output/transfer/` 目录扫描（`engine.persistence` 落盘 + `model.discovery` 恢复）；链路只被测试消费、facade 未接线，已随 #415 删除，复活场景的正确载体是上游 record 化（e2m2e#574）。轨道 / 族 / 星历的文件名分类正则更早已随 catalog 接入删除（ADR 0008 修订 2026-08-19）。

## 第2层 执行层 `src/engine/`

### FacadeBridge

e2m2e Facade API 的薄封装。处理配置注入（kernel_dir / catalog_dir 经 `Config`）、异常翻译、catalog 读写转发。

```python
class FacadeBridge:
    def __init__(self, kernel_dir=None, catalog_dir=None, facade=None): ...

    def design_orbit(self, **params) -> OrbitDesignResultData:
        """经 Facade 调用 design_orbit，返回可跨线程传递的结果 DTO；
        产物自动入轨道库（record_id 回执）。"""

    def generate_family(self, **params) -> FamilyResultData: ...
    def analyze_stability(self, **params) -> StabilityResultData: ...
    def control_orbit(self, ephemeris_data, source_mu, **params) -> ControlResultData:
        """input_record_id 直连库中记录（Facade 解析星历段并写谱系），
        无记录时回退内存星历重建 EphemerisTable。"""

    # catalog 薄封装：catalog_query / catalog_get / catalog_tag /
    # catalog_delete / catalog_promote / catalog_export
```

**关键设计**：

- **各计算工具统一走 Facade 门面**（issue #375，完成 ADR 0011 缓解措施 3 的既定清理）：#312 起 Facade 响应携带完整几何字段（states/times/mu/ephemeris），#475（e2m2e 5.8.0）起产物自动入轨道库、`control_orbit` 支持 `input_record_id` 谱系输入。GUI 不再绕过门面直调算法层。
- **周期族成员只携带初态与周期**，桥接层按周期重采样供画布渲染（catalog 族记录懒加载复用同一辅助函数）。
- **e2m2e 5.6.5 起 `design_orbit` 首参为 `DesignOrbitRequest`**（散字段不再支持），Facade 校验请求；`duration` 由面板年单位换算为秒，Lissajous 固定注入 segmented 修正。
- **结果 DTO（Data Transfer Object）**：可跨线程边界传递的纯数据类，不持有 e2m2e 对象引用。包含 numpy 数组（状态矩阵、时间向量）、标量元数据与 `record_id`（入库回执）。
- **异常翻译**：e2m2e 异常 → 结构化错误码 + 用户友好消息（`src/engine/exceptions.py`）；Facade 接缝的 `e2m2e.api.OrbitError` 透传错误码。

### CatalogService

轨道库的 GUI 语义层（`catalog_service.py`）：摘要 → Artifact 映射（清单）、`catalog_get` 懒加载填充（design 双段 / family 成员堆叠与重采样 / control 星历减 μ）、标注 / 提升 / 导出 / 删除转发。GUI 测试用桩 bridge 或小型真实库，不重测上游。

### Workers

（原 QThread Worker 机制已随 PyQt UI 一并移除：计算任务经 Tauri command →
sidecar 子进程完成，线程管理由 Rust tokio 承担。）
## 前端与 Rust 壳

组件级说明见源码：`frontend/src/`（App 三栏布局、ParamsPanel schema 表单、
OrbitCanvas Three.js 画布、CatalogFilterBar、助手边栏（assistant/：
AssistantSidebar、ChatView、SessionSwitcher、ToolCardView）、i18n、
chartSettings）与 `src-tauri/src/`（sidecar 模块、assistant 模块、mcp.rs、
cmd.rs、state.rs、project.rs）。

i18n 机制保留、覆盖随缘——新 UI 文案不强制过 `t()`（双语覆盖面拍板见
#415：不承诺组件文案全量双语）。

## 依赖方向规则

界面链路（单向，无环）：

```
frontend/    →  @tauri-apps/api（IPC）   # 前端不直接 import e2m2e，不碰进程
src-tauri/   →  tokio 子进程 + stdio 协议 # Rust 壳只做编排，不做轨道力学
sidecar      →  e2m2e Facade              # 算法只进 sidecar
```

Python 领域层（供脚本与测试使用，不在界面链路上；唯一例外：
`scripts/download_kernels.py` 使用 commons.kernels）：

```
src/engine/  →  src/model/（仅 Artifact/Project 类型）+ src/commons/ + e2m2e
src/model/   →  numpy（纯数据）
src/commons/ → 无内部依赖（commons 是叶子，只被上层引用）
```

**硬规则**：

1. `src/model/` 不 import `src/engine/`。
2. `src/engine/` 不 import 任何 GUI 框架（Qt 依赖已随 PyQt UI 移除）。
3. `src/commons/` 是叶子：只被上层引用，自身不引用 `src/model/`、`src/engine/`。
4. 前端与 Rust 壳不 import e2m2e 或 `src/`：界面要算的东西一律走 sidecar 协议。

## 可视化架构

画布为 Three.js（`frontend/src/OrbitCanvas.tsx`），单一坐标系：会合系（质心
归一化），物理单位（km）数据经单位归一入画。内容分**结果层**与**固定层**
双层（CONTEXT.md 领域语义）：

```
WebGLRenderer + OrbitControls（旋转/缩放/平移）
└── Scene
    ├── 参照层（不参与取景适配）：坐标轴与网格、地月空间分区图层
    │   （regionLayer.ts，e2m2e spatiography_boundaries 几何）
    └── content Group（固定层在前、结果层在后）
        ├── 轨迹线（THREE.Line + BufferAttribute，按数据源直达或重采样）
        ├── 地球 / 月球（NASA 贴图 + Phong 光照与晨昏线，真实半径比例）
        └── L1 / L2 平动点（Sphere + 文字 Sprite）
```

渲染数据多条来路：族生成响应的成员初态经前端 CR3BP 传播器
（`frontend/src/cr3bp.ts`，方程对齐 e2m2e，有回归测试）按 period 重采样整条
轨迹；轨道库记录经 `catalog_get` 取成员 xyz 进固定层；工具结果的轨迹数组
（含转移弧、星历段）经 `trajectoryParsing.ts` 按响应结构解析，位置按「et 秒 /
历元 UTC」两级时刻基准（timeBasis.ts）对齐时间轴。新轨迹数据到达时自动
适配一次（按包围盒复位相机，5% 余量），此后重绘与设置变更保持用户视角
（视图保持）。

配色：携带 Jacobi 常数的轨迹按当前取值范围归一后 coolwarm 着色（附颜色条），
无值轨迹回退颜色循环（seaborn muted，chartSettings 可改）；图例逐条标注轨迹
数据系（会合无量纲 / 会合物理 km / 地心惯性 km，随轨迹解析层携带）。动画导出
经 captureStream + MediaRecorder 编码 webm（画布自转 8 秒），不引入编码依赖。

## 管线串联

产物间的因果关系经轨道库谱系指针持久化（重启不断）：下游产物记录
`source_record_id`，重启后由 `catalog_query` + `catalog_get` 恢复清单与轨迹。
全部任务工具的界面已接通（issue #398 已关闭；轨道稳定性后因上游 placeholder 状态移出注册表，#416）：族生成 → 入库 → 浏览叠加的链路可用，选中产物 → 发起下游工具的输入引用经谱系记录衔接。

## 工具范围（当前）

中栏工具面板接通 8 个工具：轨道族生成、任务轨道设计、参数空间扫描（catalog_sweep）、轨道保持、轨道预报、转移轨道设计、时空坐标转换、分区边界（spatiography_boundaries，产出进画布区域图层；前端 `TOOL_REGISTRY` 注册，经通用 `run_tool` 通道下发；轨道稳定性因上游 placeholder 状态移出注册表，#416）。17 个工具 schema（含 7 个 catalog 操作与 3 个分区解析工具）已全部导出，catalog 操作的界面分布：query/get 服务目录浏览与轨迹叠加，sweep 在工具面板，delete 在项目树右键菜单，export 在筛选栏「导出包」，promote/tag 在记录详情面板。AI 助手经 mcp-serve 调用同一套 e2m2e 工具，不受注册表限制。
原则不变：不承诺 GUI 承载 e2m2e 全部算法能力，需要脚本化工作流时直接使用
[e2m2e CLI](https://github.com/cislunarspace/CODE-core)。

## 分发

发行版为 Windows NSIS 安装器（currentUser 免管理员）与 MSI，以及 Linux
（amd64/aarch64）AppImage/deb/rpm：
Tauri 主程序 + `transfer-orbit-design-sidecar`（PyInstaller onefile 打包的
e2m2e serve-stdio，`packaging/transfer_orbit_design_sidecar.spec`）+ SPICE
内核（含行星历，随 Git LFS 入库），三者经 resources 映射进安装目录。分发期
Rust 壳从 resource 目录拉起 sidecar（`packaged_sidecar_command`），cwd 指向
resource 根，e2m2e Config 的 `kernels/`、`catalog/` 按 cwd 相对解析（可用
`SPICE_KERNEL_DIR` / `E2M2E_CATALOG_DIR` 环境变量覆盖）。桌面端自动更新经
`@tauri-apps/plugin-updater` 基于 GitHub Releases 的 latest.json（ADR 0018）。
发布管线见 `.github/workflows/release.yml`（tag `v*` 触发：元数据校验 →
lint → 测试 → Windows NSIS+MSI 与 Linux（amd64/aarch64）AppImage/deb/rpm
构建，各构建作业直传 GitHub Release → 收尾作业核对产物数量、生成
`checksums.txt` 与签名更新清单 latest.json 后回传）。版本 bump 时
`pyproject.toml`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`（
AboutModal 读运行时版本）与 `frontend/package.json` 四处及 CHANGELOG 小节
同步修改，`packaging/scripts/validate-release.sh` 在发布期把关一致。

## 依赖

- **运行时**：numpy, scipy（Python 领域层）；Rust/Tauri 2 + Node/Vite（前端与壳，各自锁文件管理）
- **e2m2e**：PyPI 依赖（`e2m2e[mcp]>=5.9.0`：#522/#525/#526 sidecar 契约、
  5.8.10 state_frame 数据系标注、5.9.0 分区解析三工具；`[mcp]` extra 供 mcp-serve，
  ADR 0023）；界面链路经 serve-stdio 直连 Facade，`src/engine/facade_bridge.py` 供脚本与测试
- **calcephpy**：经 e2m2e→r2s2 传递依赖（Windows 用预编译 wheel，见 `pyproject.toml` 的 `[tool.uv.sources]`）
- **打包**：PyInstaller（sidecar onefile）+ cargo-tauri（NSIS 安装器）

## 测试策略

| 层级 | 测试类型 | 覆盖目标 |
|---|---|---|
| model/ | 单元测试 | Artifact CRUD、Project 查询、Discovery 扫描 |
| engine/ | 集成测试 | FacadeBridge → e2m2e（真实参数模型签名）、持久化落盘、异常翻译 |
| commons/ | 单元测试 | 单位换算、内核下载/可用性判断、路径探测 |
| frontend/ | 单元测试（vitest） | CR3BP 传播器（对齐 e2m2e 方程的回归）、轨迹解析/时刻基准、助手会话模型、区域图层、Jacobi 色标等 |
| src-tauri/ | 单元 + 集成（cargo test） | 帧解析、sidecar 拉起/崩溃自愈、真实子进程协议往返 |

e2m2e 本身已通过其自身测试套件验证，tod 不重复测试 e2m2e 的计算正确性。tod 的测试关注界面行为、协议与数据流。
