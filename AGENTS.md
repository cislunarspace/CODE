# Repository Guidelines

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
- **依赖门槛**（见下方编码准则第 8 节）：先用已有依赖与标准库，新增依赖须说明原因。

## Testing & QA

三套栈并存：pytest（`tests/`）、cargo test（`src-tauri/tests/` + 源文件尾 `#[cfg(test)]`）、vitest（`frontend/src/` 同目录 `*.test.ts(x)`）。命令见 Development Commands。

- marker 只有 `spice`（需 SPICE 内核真算）与 `slow`；日常跑 `-m "not spice"`，真路径冒烟 `uv run pytest tests/engine/test_facade_bridge_e2m2e_smoke.py -m spice`。
- **CI 只跑 Python**（`-m "not spice"`）；cargo test 与 npm test 不在任何 workflow，改 Rust / 前端必须本地跑对应测试。
- Rust 侧：无 Python 环境用 `cargo test --manifest-path src-tauri/Cargo.toml -- --skip sidecar`；`assistant_acp` 依赖 python3 且须串行跑。
- 命名与组织：Python `test_<module>.py` 镜像 `src/`，方法 `test_<行为>_<期望>`；前端 `describe` / `it` 用中文并带 issue 号；Rust 集成测试一文件一主题放 `src-tauri/tests/`，golden 夹具在 `src-tauri/tests/fixtures/`。
- 断言：标量 `pytest.approx`、数组 `np.testing.assert_allclose`（atol 1e-6 量级）、Rust f32 容差 1e-6。随机数不设种子——不断言随机值，只断言形状或由输入推导的期望。
- 共享设施：`tests/conftest.py`（注入 `SPICE_KERNEL_DIR`、Agg 后端、隔离 `CATALOG_DIR`）、`tests/engine/conftest.py`（fake e2m2e 结果族、`mock_design_orbit`）。
- 打包冒烟：`scripts/smoke_mcp_serve.py`（release 发布闸）、`scripts/smoke_omp_acp.py`（omp ACP 链路）——手工或发布期跑，不进测试套件。
- 无覆盖率门槛；验证按下方编码准则第 5 节执行，修 bug 先写复现测试。

---

## 协作流程、写作要求与编码准则

以下为仓库既有约定，原文保留：`/loop-go` 循环工程、交流语言、写作要求与 issue / PR / 评论的格式、编码准则。

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

## 交流语言

始终使用中文与用户交流。代码、commit message、PR 描述等技术输出也用中文。

## 写作要求

所有面向人读的文本（注释、CONTEXT.md、ADR、issue 评论、PR 描述、agent brief、triage notes、Sphinx 文档、Agent 回复），遵守以下原则：

- **善于总结材料**：材料弄全弄准，去粗取精、去伪存真、由此及彼、由表及里，反映事物本质；不堆砌细节、不拼凑清单。
- **真懂才能写好**：反复改都写不清楚，往往是因为对所写的内容还不大懂；真懂了，才有高屋建瓴、势如破竹之势。
- **逻辑清晰**：整篇文章前后次序有逻辑，交代清楚。
- **用词准确**：相邻概念划清界限，不混用、不模糊。概念要抓住事物的本质、全体和内部联系，而非现象、片面和外部联系。
- **观点鲜明**：不堆砌凑数、聚沙成堆。不用夸大的修饰词（权威、强大、完整、单一事实来源之类），它们减损力量。
- **废话应当尽量除去**。
- **读得下去是基本要求**：文字通顺，让人读得下去、读后脑中有印象；读完脑中无印象，是极差的文章。
- **通俗、亲切，由小讲到大，由近讲到远，引人入胜**：先讲读者已知／当前的事物，再推到陌生／抽象的；忌一上来就宏大叙事或先搬死人、外国人。
- **与读者完全平等**：靠分析说服，不要装腔作势来吓人；老老实实办事。
- **动笔前想受众**：这篇东西给谁看？谁受益？怎样让更多人受益？

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

LLM 写代码时会犯一些可以预见的错误，同样几个，一遍又一遍。以下是规则，需要严格遵守。

### 1. 写代码前先读懂

LLM 产出烂代码最大的根源，就是写新代码之前没有读懂现有代码库。你看到一个任务，匹配到训练数据里的某个模式，就开始生成。这通常导致代码不贴合项目实际。

写任何东西之前：

- 把你要改的文件读一遍。不是略读，是读。
- 看看项目里别处是怎么做类似事情的。有范式就照着来；有工具函数已经做了一半你需要的事，就用它。
- 看文件顶部的 import，它们告诉你这个项目实际在用什么库。项目到处用 fetch，就别引入 axios；项目用原生方法，就别引入 lodash。
- 看测试文件，它们告诉你预期行为到底是什么。

如果你不是 100% 确定某个方法以这个确切签名存在，查文档或看项目里的真实源码。自信地用一个不存在的 API 或已移除的参数，是典型的知识幻觉。

如果你不确定这个项目里某件事是怎么做的，就说出来。我在代码库里没看到 X 的范式，是该照 Y 的做法来，还是另起炉灶？永远比瞎猜强。

### 2. 动手前先想清楚

没想清楚到底要做什么之前，别开始写代码。

**把假设说出来。** 用户说加个鉴权，可能指 session cookie、JWT、OAuth、basic auth，或其他五种东西。别默默选一个。说我假设你要的是基于 JWT 的鉴权，带 refresh token，存在 httpOnly cookie 里。如果你想要别的，告诉我。

**点明取舍。** 几乎每个实现选择都有代价。加缓存就拿内存换速度，还引入了缓存失效这件此后得操心的事。写之前说清楚，用户可能说其实我不要这个复杂度。

**做了架构决策，要标出来。** 这些选择难以撤销，用户应当知道。

**存在多种做法时，简要地列出来。** 两种，顶多三种，带上推荐。A 更简单，但处理不了边界情况 X。B 全 cover，但引入对 Z 的依赖。除非你预期 X 真会发生，否则我选 A。

**有搞不懂的地方，停下。** 别用听起来像那么回事的代码去填糊涂。直接说哪里搞不懂，问。

### 3. 避免过度工程

写解决问题所需的最少代码，不是理论上能解决问题的最少代码，而是此刻真正解决这个具体问题的最少代码。

过度工程的冲动很强。抵制它。典型表现：

**过早抽象。** 用户要的只是 `sendWelcomeEmail(user)`，你却写了一个带策略模式、支持多家供应商的 EmailService。以后真需要更多，他们会开口。

```python
# 差
class EmailService:
    def __init__(self, provider: EmailProvider, template_engine: TemplateEngine):
        self.provider = provider
        self.template_engine = template_engine

    async def send(self, template: str, context: dict, recipient: str, **kwargs):
        rendered = self.template_engine.render(template, context)
        await self.provider.send(recipient, rendered, **kwargs)


# 好
async def send_welcome_email(user):
    body = f"Welcome {user.name}! Your account is ready."
    await send_email(to=user.email, subject="Welcome", body=body)
```

重复远比错误的抽象便宜。先 copy-paste 两次，再谈抽象。

**投机式的错误处理。** 为不可能发生的错误包 try/catch，对永远不为 null 的值加 null 检查，每一行都是别人得读懂的一行。只处理真正会发生的错误。

**没必要的可配置性。** 你把 batch size 做成参数，把重试次数做成可配置，为永远不会变的东西加环境变量。每个配置项都是某人要做的一个决定、要设对的一个值。在有真正的理由之前，硬编码。

**死灵活性。** 只有一个实现的接口、只有一个子类的抽象基类，有成本（认知开销、间接层），在第二个实现真正出现之前零收益。

检验：不熟项目的人问这干嘛要这么抽象，而答案是万一我们需要……，那就是过度工程了。万一我们需要不是需求，是对未来的猜测，而对未来的猜测通常是错的。

### 4. 精准改动

改现有代码时，diff 越小越好。你改的每一行都可能引入 bug、都得有人 review、还会永远留在 git blame 里。

**别动没让你动的东西。** 修函数 A 的 bug，注意到函数 B 的变量名很怪，别管。函数 C 的注释有个错别字，别管。import 顺序不合你意，别管。你的活是修函数 A 的 bug。

**贴合现有风格。** 文件用单引号你就用单引号，用 `snake_case` 你就用 `snake_case`，没分号就别加分号。文件内的一致性胜过你的个人偏好。

**收拾自己留下的，不收拾别人的。** 你的改动让某个 import 没用了，就删掉。但仅限你的改动导致的，既存的死代码不归你管。

**别重新格式化。** 别对原本没用 prettier 的文件跑 prettier，别把 4 空格缩进改成 2 空格，别把原本不按字母序的 import 重排。重新格式化制造海量 diff，淹没你真正的改动。

检验：diff 里每一行改动都能直接对应到被要求的事上。有既然都进来了，顺手……的，撤掉。

### 5. 验证

能跑的代码和你以为能跑的代码之间，差的就是测试。

**修 bug 时先写测试。** 先写一个能复现 bug 的测试，看它挂，然后修 bug，看它过。这是唯一能证明你确实修好了、而不是让症状消失的办法。

**按改动范围分层验证。** 先跑受影响模块的测试和必要静态检查；改前能跑的同范围检查改后也应通过。跨模块、共享契约、基础设施、依赖升级，或影响范围无法可靠判断时，再扩大到相关集成测试、全量测试或 CI 指定的回归套件。改前就失败的，说出来，别让你的改动替既存失败背锅。

**测行为，不测实现。** 检查构造函数有没有设好属性的测试一文不值；检查校验是否真的拦住坏输入的测试才有价值。

**想想 happy path 之外的情况。** API 返回 500 时怎样？文件不存在时？用户提交空表单时？

**写不了测试，就说明原因。** 数据库调用跟业务逻辑紧耦合，没法轻松测，这是个可能需要重构的信号。别默默跳过测试然后指望没事。

### 6. 目标驱动

每个任务在动手前都该有清晰的成功标准。标准模糊，就把它变具体；变不出具体的，就问。

把模糊任务转成可验证的：

- 加校验 → 拦掉邮箱缺失或非法的输入，返回 400 并说明哪里错了，为这两种情况都加测试
- 修 bug → 写一个复现上报行为的测试，让它通过，确认现有测试仍通过
- 提升性能 → 先 profile，定位瓶颈，修那一个具体问题，再测一次

超过一步的活，执行前先说出计划：

```
计划：
1. 用 migration 加新的数据库列
2. 更新 model 包含新字段
3. 改 API endpoint 以接受并返回该字段
4. 为该字段加校验
5. 为新行为写测试
6. 跑受影响模块的测试和静态检查；若改动跨模块或影响范围不清，再扩大回归范围
```

这让用户能在你浪费时间之前逮到思路失误，也逼你自己把步骤想过一遍。

### 7. 调试

出了问题不工作时，别猜。调查。

**把错误信息读完。** 整条，包括 stack trace。看到错误就立刻基于类型生成修复，根本不读它说了什么，这是常见的坏毛病。一个 TypeError 可能指一百种情况，信息和 stack trace 告诉你是哪一种。

**先复现。** 复现不了就没法验证修复。我觉得这应该能修好不是调试，是赌博。

**一次只改一处。** 改了三处然后 bug 没了，你不知道是哪一处修好的，也不知道另外两处有没有引入新 bug。改一处，测。再改一处，测。

**没搞懂根因之前，别加 workaround。** 一个值意外为 null，搞清楚它为什么是 null。null 检查也许能防崩溃，但底下的 bug 还在，以后会换个样子冒出来。

**卡住了就说。** 我试了 X 和 Y 都没用，我看到的是这些，觉得问题可能在 Z 但没把握。这比默默瞎试 20 轮有用得多。

### 8. 依赖

加依赖之前先想想。你加的每一个依赖都是一段你不掌控的代码，却要永久成为项目的一部分，得维护、更新、审计安全问题。代价几乎总比看上去高。

加包之前：

- 项目已有的东西能不能做？有 axios 就别加 node-fetch，有 date-fns 就别加 moment。
- 标准库能不能做？`Array.prototype.map` 不需要 lodash，`crypto.randomUUID()` 存在就不需要 uuid。
- 看最近提交日期和 issue 情况，判断它是否还在维护。
- 它多大？为了格式化日期加个 500KB 的包，多半不值。

真要加时说明原因。默默往 package.json 塞包，不行。

### 9. 沟通

你怎么就代码沟通，跟代码本身一样重要。

**说你做了什么、为什么。** 我把校验逻辑抽到单独的函数里，因为它在三个 endpoint 里重复了。这也让它能独立测试。用户不用逐行读就懂了这次改动。

**标出顾虑。** 这个能跑，但对列表里每一项都打一次数据库，列表一大就会慢。要不要我改成批量？这种主动沟通能在以后省下几个小时。

**精确说出你不确定的是什么。** 我不确定这个库支不支持流式响应，有用。我觉得这应该能行，没用。差别在于前者让用户清楚该去验证什么。

**别解释用户已经知道的事。** 把解释的层次对齐到用户展现出来的知识水平。

**commit message 要具体。** Fix bug 毫无用处。修好用户查询里的空指针，当邮箱含大写字符时才能让下一个人清楚发生了什么。

**commit title 不用破折号。** 标题分隔用冒号或逗号，不用破折号（——）。

### 10. 常见失败模式

这些是我最常看到的模式。如果你逮住自己在干其中任何一件，停下来重新想想。

**厨房水槽。** 让你加一个功能，你顺手重构半个代码库。别。做那一件事。

**错误的抽象。** 你为一个只在一处存在的问题，造了一个漂亮的通用方案。先 copy-paste 两次，再谈抽象。

**隐形决策。** 你做了架构选择，却没有把它作为一项决策标出来。用户应当知道你做了它。

**乐观路径。** 你写的代码把 happy path 处理得完美，对其他一切要么忽略要么崩溃。想想 API 返回 500 时会怎样。文件不存在时。用户提交空表单时。

**知识幻觉。** 你自信地用一个并不存在的 API、一个两个版本前就被移除的参数、或一个想象出来的库特性。如果你不是 100% 确定某个方法以这个确切签名存在，就说出来。查文档。看项目里的真实源码。

**风格漂移。** 你用自己偏好的风格写代码，而不是贴合项目。在 OOP 代码库里写函数式。在函数式代码库里写类。在 JavaScript 项目里写 TypeScript 范式。贴合代码库，不是贴合你的偏好。

**失控重构。** 你开始修一处。它碰到另一处。那处又碰到另一处。二十分钟后你改了 15 个文件，不确定自己最初要干什么。如果修复开始级联，停下。告诉用户发生了什么。继续之前先取得同意。

这些准则起作用的标志是：diff 里不必要改动更少、因过度复杂而返工更少、澄清问题发生在实现之前而不是犯错之后。
