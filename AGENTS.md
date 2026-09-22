# AGENTS.md

上半部分是仓库技术指南（架构、命令、代码约定），下半部分是协作流程、写作要求与编码准则。

## Project Overview

CODE（cislunar orbit designer）是 [e2m2e](https://github.com/cislunarspace/CODE-core) 的 Tauri 2 桌面 GUI。e2m2e 提供动力学模型、修正器、延拓器、转移算法与轨道库（catalog），本仓库只做界面、进程编排、打包分发，**不含数值求解器**。硬边界：界面不碰算法，算法不进界面。旧 PyQt GUI 已废弃，`docs-old-pyqt-gui-inventory.md` 是冻结的历史台账，只作对照参考。许可 Apache-2.0。

## Architecture & Data Flow

三层结构加一条旁路：

- **前端** `frontend/`（React 18 + Ant Design 6 + Three.js）：界面、3D 画布、AI 助手边栏。
- **Rust 壳** `src-tauri/`（Tauri 2）：进程编排、IPC、打包与更新。
- **e2m2e sidecar**：`serve-stdio` 子进程，唯一的算法执行者。
- **Python 领域层** `src/`：e2m2e 语义的 Python 资产，**只供脚本与测试**，GUI 运行时链路不经过它（见 `docs/architecture/architecture.md`）。

计算主链（点执行到画布）：

```
ParamsPanel（frontend/src/schema.ts:TOOL_REGISTRY 的 JSON Schema 生成表单）
→ App.tsx:handleRunTool（validateToolParams 防呆；LGA/WSB 注入 target_ephemeris）
→ invoke("run_tool") → cmd.rs::run_tool → state.rs:request_with_retry（崩溃自愈一次）
→ SidecarHandle（单任务串行）→ e2m2e serve-stdio
→ 响应 = 信封 JSON 行 + N 个二进制帧（帧序 = data.arrays 中 null 占位键顺序）
→ trajectoryParsing.ts → OrbitCanvas（Three.js）；data.record_id 非空则登记 ProjectState
```

- 帧格式见 `src-tauri/src/sidecar/frames.rs`：`magic 0x324D_3245 | dtype(f32/f64) | ndim | shape | data`。
- 事件名只有三个：`sidecar-progress`、`assistant-event`、`update-download-progress`。
- 产物自动入 e2m2e catalog（`catalog/` 目录），取用走 `catalog_query` / `get_artifact`（后者懒加载大数组）。
- **AI 助手是并行的第二条链路**：`assistant_send` → `omp acp` → 本二进制 `--assistant-mcp-bridge`（MCP 桥）→ `e2m2e mcp-serve` + 宿主工具（`scenario_write` / `scenario_list`）。只读工具（`assistant/events.rs:READ_ONLY_TOOLS`）免确认，其余出工具卡片审批；凭据永不进前端。
- 契约同步机制：唯一 codegen 是 `tools/export_tool_schemas.py`（e2m2e Pydantic request → `frontend/src/toolSchemas/<tool>.json`，**升级 e2m2e 后必须重跑**）；Rust ↔ TS 类型无 codegen，靠 `cmd.rs` ↔ `sidecarApi.ts` 手工对偶；跨层数值常量手工同步并在注释标注（`paramOverlay` 的 `TU_SECONDS=375676.97` 与 `cr3bp.ts` 的 `375190.26` 是两种口径，勿混用）。

## Key Directories

| 目录 | 用途 |
|---|---|
| `src/model/` `src/engine/` `src/commons/` | Python 领域资产：数据类（`Artifact`/`Project`）、e2m2e 接缝（`facade_bridge`/`catalog_service`/`exceptions`）、单位/常量/路径/内核 |
| `src-tauri/src/` | Rust 壳：`cmd.rs`（22 个 Tauri command）、`sidecar/`（帧协议客户端）、`assistant/`（omp ACP 适配）、`state.rs`、`update.rs` |
| `frontend/src/` | React 界面；组件 `PascalCase.tsx`，逻辑模块 `camelCase.ts` |
| `tests/` `src-tauri/tests/` `frontend/src/*.test.tsx` | 三套测试，与实现同树 |
| `packaging/` | PyInstaller sidecar spec、release 配置、`scripts/validate-release.sh` |
| `scripts/` `tools/` | 手工/发布期脚本（不进测试套件）与 codegen |
| `docs/` | `adr/`（决策记录正典）、`architecture/`、`specs/`、`source/`（Sphinx）、`development.md`（写作与日志规范） |
| `kernels/` `data/` | SPICE 内核（Git LFS）、CR3BP 数据集 |
| `catalog/` `output/` | 运行期产物目录，不提交 |

## Development Commands

```bash
# 环境
uv sync                            # Python 依赖（Python 3.13）
npm ci --prefix frontend           # 前端依赖
npx --prefix frontend tauri dev    # 开发模式：Vite :1430 + Rust 壳 + sidecar

# 测试
uv run pytest tests/ -m "not spice"                # Python（CI 同款）
cargo test --manifest-path src-tauri/Cargo.toml    # Rust 壳与协议
npm --prefix frontend run test                     # 前端（vitest）

# 静态检查（CI 同款）
uv run ruff check . && uv run ruff format --check . && uv run pyright

# 文档
uv sync --extra docs
uv run sphinx-build -b html -D language=zh docs/source docs/build/html

# 工具脚本
uv run python scripts/download_kernels.py        # 补 SPICE 内核（幂等）
uv run python tools/export_tool_schemas.py       # e2m2e schema → frontend/src/toolSchemas/
uv run python scripts/smoke_mcp_serve.py         # sidecar 打包冒烟（release 发布闸）
```

版本号须四处一致且 CHANGELOG 有对应小节：`pyproject.toml`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`frontend/package.json`；`packaging/scripts/validate-release.sh` 强制校验。

## Code Conventions & Common Patterns

- **语言**：文档、注释、docstring、回复用中文；命令、路径、代码标识符不翻译。Python docstring 用 Google style，`src/` 每个生产模块必须有模块级 docstring（规范与示例见 `docs/development.md`）。脚本输出用 `logging` 不用 `print`；CLI help 须回答参数控制什么、默认值、单位三问。
- **格式**：`.editorconfig`（Python 4 空格，YAML/JSON/TOML 2 空格，LF）；ruff 行长 100（`tests/ docs/ scripts/ tools/` 不检查）；TypeScript strict（`tsc -b`）。前端无 prettier/eslint、Rust 无 rustfmt/clippy 配置——不要引入格式化重排制造噪音 diff。
- **命名**：Python `snake_case` 模块/函数、`PascalCase` 类、结果 DTO 用 `…ResultData` 后缀、常量 `UPPER_SNAKE`；Rust 类型 `PascalCase`、常量 `SCREAMING_SNAKE`、文件头 `//!` 重在讲为什么；TS 组件 `PascalCase.tsx`、逻辑模块 `camelCase.ts`。IPC struct 用 `#[serde(rename_all = "camelCase")]`，例外 `EphemerisSegment` 故意 snake_case（与 e2m2e `EphemerisTable` 同形，共用解析）；发给 sidecar 的 `arguments` 保持 snake_case（e2m2e request 字段原名）。
- **错误处理**：Python 统一 `OrbitError(code, message, cause)`，`translate_exception` 翻译 e2m2e 异常（`CORRECTION_DIVERGED` / `PROPAGATION_FAILED` / `BACKEND_UNAVAILABLE` / `KERNEL_NOT_FOUND` / `INVALID_PARAMS` …）；Rust 内部 `anyhow`、跨 IPC `Result<T, String>`；前端 `formatToolError` + antd toast + 表单内联标红。原则：不伪造成功、坏文件明确报错（`scenario.ts:parseScenario`），可选数据软失败降级（如 `moonTrackFromResponse` 返回 null）。
- **异步**：Python 纯同步（无 asyncio）；Rust tokio，mpsc + oneshot，sidecar 单任务串行、MCP 按 id 多路复用并发，进程级配置经 `OnceLock` 在 app setup 注入；前端 async/await + Tauri API 动态 import + effect 竞态取消。
- **依赖注入 / 状态**：Tauri managed state（`SidecarState` / `ProjectState` / `AssistantState`）+ `State<'_>`；Python 构造器注入（`FacadeBridge(kernel_dir, catalog_dir)`、`CatalogService(bridge)`）；前端无 store 库，`App.tsx` 单组件 `useState` 集中 + `localStorage`（`tod-*` 键）。
- **硬契约**（违反即坏，改动必守）：
  1. **`import e2m2e` 之前**把内核目录写入 `SPICE_KERNEL_DIR`（见 `src-tauri/src/lib.rs` setup、`tests/conftest.py`）；
  2. 单位换算唯一来源 `src/commons/units.py`（`DU_KM=384400`、`TU_SECONDS≈375676.97`），禁止另立换算常量；前端 TU 有两种口径，见 `frontend/src/paramOverlay/index.ts` 注释；
  3. 时间唯一绝对基准是 et 秒（J2000 TDB），`frontend/src/timeBasis.ts` 是换算唯一出口（ADR 0021）；
  4. 质心归一（画布）与地心归一（算法层）的换算点是 `centroid_normalized_states`（减 μ）；理想化会合系到惯性系旋转在 `viz_adapter` / `trajectoryParsing` / `cr3bp` 三处必须同口径（#477）；
  5. `serde_json` 的 `preserve_order` 不能关（帧序契约，见 `src-tauri/Cargo.toml` 注释）。
- **领域术语以 `CONTEXT.md` 为正典**（单条轨道、轨道族、参考历元、工具注册……），写代码与文档前先对齐术语表；注释内联 issue/ADR 编号（`#452`、`ADR 0013`）是全仓惯例。

## Important Files

- **入口**：`src-tauri/src/main.rs`（`--assistant-mcp-bridge` 桥接分支）→ `src-tauri/src/lib.rs:run`；`frontend/src/main.tsx` → `frontend/src/App.tsx`；打包 sidecar 入口 `packaging/sidecar_main.py`；脚本与测试的 API 面 `src/engine/facade_bridge.py`。
- **配置**：`pyproject.toml`（ruff / pyright / pytest / uv 配置全在此）、`frontend/{package.json,vite.config.ts,tsconfig.json}`、`src-tauri/{Cargo.toml,tauri.conf.json}`、`packaging/tauri.release.conf.json` 与 `tauri.release.slim.conf.json`、`.github/workflows/{ci,docs,release}.yml`。
- **关键模块**：`src/engine/{facade_bridge,catalog_service,exceptions}.py`、`src/commons/{units,constants,paths,kernels}.py`、`src-tauri/src/{cmd,state,project,sidecar/process,sidecar/frames,assistant/mod,assistant/events}.rs`、`frontend/src/{schema,sidecarApi,trajectoryParsing,timeBasis,scenario,cr3bp}.ts` 与 `frontend/src/paramOverlay/`。
- **规范文档**：`docs/development.md`（docstring / CLI help / 日志规范）、`docs/architecture/architecture.md`（分层与依赖硬规则）、`docs/adr/`（决策记录，改架构前先查）。

## Runtime/Tooling Preferences

- **Python 3.13 钉死**（`>=3.13,<3.14`；calcephpy 预编译轮子只有 cp313，原因见 `pyproject.toml` 注释）。包管理只用 **uv**：`uv.lock` 入库、index 钉 `https://pypi.org/simple`；重锁用 `uv lock --upgrade-package calcephpy`；Windows 的 calcephpy 走 `[tool.uv.sources]` 预编译 wheel，勿删。
- **Node.js ≥ 20**（README），前端测试实际需要 ≥ 22.13（jsdom 30）。包管理用 **npm**（`package-lock.json` 入库），命令一律带 `--prefix frontend`。
- **Rust 稳定版工具链**，edition 2021，Tauri 2，`Cargo.lock` 入库。
- **打包**：PyInstaller onefile 产 sidecar（`packaging/transfer_orbit_design_sidecar.spec`，datas 逐包收 e2m2e 与 R2S2 星历——漏收即坏包）；release 分 slim（无 kernels，供更新通道）与全量（含 kernels，供新装）；omp 钉版本随包分发（`release.yml` env）。
- **依赖门槛**（见下方编码准则「审慎依赖」）：先用已有依赖与标准库，新增依赖须说明原因。

## Testing & QA

三套栈并存：pytest（`tests/`）、cargo test（`src-tauri/tests/` + 源文件尾 `#[cfg(test)]`）、vitest（`frontend/src/` 同目录 `*.test.ts(x)`）。命令见 Development Commands。

- marker 只有 `spice`（需 SPICE 内核真算）与 `slow`；日常跑 `-m "not spice"`，真路径冒烟 `uv run pytest tests/engine/test_facade_bridge_e2m2e_smoke.py -m spice`。
- **CI 只跑 Python**（`-m "not spice"`）；cargo test 与 npm test 不在任何 workflow，改 Rust / 前端必须本地跑对应测试。
- Rust 侧：无 Python 环境用 `cargo test --manifest-path src-tauri/Cargo.toml -- --skip sidecar`；`assistant_acp` 依赖 python3 且须串行跑。
- 命名与组织：Python `test_<module>.py` 镜像 `src/`，方法 `test_<行为>_<期望>`；前端 `describe` / `it` 用中文并带 issue 号；Rust 集成测试一文件一主题放 `src-tauri/tests/`，golden 夹具在 `src-tauri/tests/fixtures/`。
- 断言：标量 `pytest.approx`、数组 `np.testing.assert_allclose`（atol 1e-6 量级）、Rust f32 容差 1e-6。随机数不设种子——不断言随机值，只断言形状或由输入推导的期望。
- 共享设施：`tests/conftest.py`（注入 `SPICE_KERNEL_DIR`、Agg 后端、隔离 `CATALOG_DIR`）、`tests/engine/conftest.py`（fake e2m2e 结果族、`mock_design_orbit`）。
- 打包冒烟：`scripts/smoke_mcp_serve.py`（release 发布闸）、`scripts/smoke_omp_acp.py`（omp ACP 链路）——手工或发布期跑，不进测试套件。
- 无覆盖率门槛；验证按下方编码准则「验证行为」与「按根因修复」执行，修 bug 先复现。

---

## 协作流程、写作要求与编码准则

以下为仓库既有约定：`/loop-go` 循环工程、交流语言、写作要求与 issue / PR / 评论的格式、编码准则。其中交流语言、写作要求、编码准则三节经 sync-writing-standards 与规范源文件同步维护，其余各节原文保留。

### Loop Engineering

`/loop-go <任务>` 循环运行 builder（写/修代码）和 checker（跑全部检查）直到通过。工具文件按 harness 安装：pi 为 `.pi/agents/builder.md`、`.pi/agents/checker.md`；Claude Code 为 `.claude/agents/builder.md`、`.claude/agents/checker.md`、`.claude/commands/loop-go.md`。

## Loop 停止规则

以下规则约束 `/loop-go` 循环。builder、checker 和主循环都遵守。

### 停止条件

循环在以下任一情况停止：

1. 所有检查通过（checker 报 ALL GREEN）。
2. 达到最大轮数（5 轮），仍未全绿。
3. 同一失败连续出现两次，builder 可能在瞎猜，不是在修复。
4. 修复导致之前通过的检查失败，拆东墙补西墙。
5. builder 违反红线（弱化测试、删除/注释/跳过失败检查、未跑检查就声称已修复）。
6. checker 无法产出有效报告（找不到检查命令、输出无法解析、连续超时）。

### 红线

- builder 绝不弱化测试来让它通过；绝不删除、注释、跳过失败的检查；绝不在没有跑过检查的情况下声称已修复。
- checker 绝不意译失败信息（复制真实错误输出的关键行）；绝不省略失败项；绝不自己修复。
- 主循环绝不自己解读或过滤 checker 的失败报告，原样转发给 builder。

### 升级协议

循环停止后，向用户报告：轮次与停止原因、最后一次 builder 的改动摘要、checker 的完整失败报告（若有）。

由用户决定下一步：继续 / 放宽任务 / 手动介入。循环自行停止后，不静默重开新一轮。

## 写作要求

所有面向人读的文本（注释、CONTEXT.md、ADR、issue 评论、PR 描述、agent brief、triage notes、Sphinx 文档、Agent 回复）应当：

- 准确、清楚、简洁；先理解材料，再提炼结论。
- 按逻辑组织，区分相近概念；不用空泛、夸大的修饰语。
- 面向实际读者，从已知事实推到陌生结论；用分析说服，不装腔或堆砌。
- 全仓库文档不得使用直角引号「」，引号用弯引号（“”）。

## issue / PR / 评论的格式

写作要求管文字质量，本节管结构和流程。参照的范例：zoplicate 的 issue #222 与 PR #221（提案先行的完整链路）、btop 的 issue 模板（结构焊死、发帖前强制检索）。

### 流程：提案先行

- 动手写代码之前先发 issue 提案，末尾写明：我有可用实现（或打算实现），你点头我就提 PR。得到维护者回应再动手。小改动（错别字、明显 bug 且修法唯一）可以直接提 PR。
- 发 issue 前先搜：README、文档、既有 issue / PR 里可能已经有答案或正在进行的工作。搜得到的，评论到既有帖子里，不发新帖。

### issue

标题说清对象和目的，不写方案。正文三段：

- **Problem**：现状是什么、为什么不对。拿证据说话——引用 README、代码行、真实发生的实例，不写抽象抱怨。
- **Proposal**：打算怎么改，具体到可判断——关键参数和默认值、逃生开关（保守用户怎么退回现状）、为什么安全。有多个选项时给出推荐和理由。
- 交代上下文：和这项工作相关的前序 issue、commit、ADR，一条列清。

需要维护者拍板的点单独列出（**待拍板**），没写就视为没有。待拍板项后来在 PR 里落地的，合并前回 issue 评论拍板结果——决策记在 issue，不记在 PR 描述里，PR 会沉底。

创建与入板：

- 创建走 GitHub 的五类模板（Bug / Feature / Idea / Research / Task），标题前缀与 type 标签由模板预填。
- 面板唯一自动入板规则是子 issue，普通 issue 建成后不自动入板，须手动加入：

      gh project item-add 1 --owner ouyangjiahong26 --url <issue 的 URL>

  入板后状态自动置为 Inbox，不用手设；Inbox 之后的推进与 Priority、Start Date 由维护者手动维护（面板结构、状态语义与自动联动的完整说明见 CONTRIBUTING.md 的 Project 流水线一节）。

### PR

- 标题回应 issue 标题：解决哪个 issue，就用 issue 的那套词说同一件事，不许另起炉灶用实现手段重新命名。
- **Closes 置顶**，其后五段：
  - **Summary**：一段话讲做了什么。
  - **Motivation**：为什么值得做，呼应 issue 的 Problem。
  - **Changes**：逐文件讲改动点和动机，一行一个文件。
  - **Why this is safe**：为什么不会弄坏现有行为——不变量没动、逃生路径、边界情况。
  - **Test plan**：勾选框逐项报结果。只报事实：数字、命令、截图；既存失败如实标注 pre-existing，与本体改动关联不明也要说明。不写应当通过。
- 与 issue 方案不一致的落法，单独一段交代原因，不混进改动清单。说不清对账的，Closes 改 Refs。

### 评论

- **按身份说话**。仓库拥有者评审外部 PR：结论句式是我认可、需要改、此条撤回，不写建议式、商量式的口气；也不替对方解释他为什么这么做。
- 评论先立主线再展开：这条 PR / issue 到底在解决什么问题。文件职责、流程对账是支撑，不许反客为主。
- 修了什么，先讲问题的因果再讲改法，不列补丁清单。
- 收尾要简短闭环：合并、拒绝都两句话说完。靠分析说服，不靠篇幅。
- 不用引号包裹术语、不用破折号、不用装饰性符号。代码名直接写。
- **不代改他人提交的内容**。别人的 issue 正文、PR 描述、评论出了结构或表述问题，意见以评论形式给出，请作者自己改；维护者可以直接动的只有 PR 标题、标签、里程碑这类元数据。
- **AI 生成的内容须标识**。AI 生成的 issue 与 PR：标题最前面加 [AI Generated] 标记（位于类型标签之前），正文首行注明工具；未正确标记的不予受理。评论末尾附一行 generated by AI 并注明工具。

## 编码准则

- **先理解再改动**：完整阅读目标文件、相似实现和相关测试；不确定 API 或惯例时查源码或文档，不猜。
- **明确目标与决策**：需求或验收条件不明确时先澄清；架构选择、假设和关键取舍要说明。
- **保持简单**：只实现当前需求。复用已有模式；不为单一用例过早抽象、配置化或引入依赖。
- **精准修改**：只改与任务直接相关的代码，贴合既有风格；删掉本次修改产生的废弃代码，不重格式化无关内容。
- **完整迁移**：变更接口或行为时更新所有调用方、测试和文档；不保留无需求的兼容层。
- **按根因修复**：先复现并读完整错误信息；一次处理一个原因，不用吞异常或特判掩盖问题。
- **验证行为**：按影响范围运行相关检查；测试可观察行为、边界和错误路径，不测试实现细节。无法测试时说明原因并做可行的烟雾验证。
- **审慎依赖**：优先现有依赖和标准库；新增依赖前确认必要性、维护状态和成本，并说明理由。
- **清楚沟通**：说明做了什么、为什么、验证结果和已知风险；对不确定性给出具体事实，提交信息描述实际改动。
