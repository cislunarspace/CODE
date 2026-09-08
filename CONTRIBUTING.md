# 贡献指南

感谢关注 transfer-orbit-design。本仓库接受贡献：报告 Bug、提出功能建议、改进文档与测试、提交代码，都欢迎。

本仓库遵循**提案先行**：动手写代码之前先发 Issue 提案，得到维护者回应再动手；小改动（错别字、修法唯一的明显 bug）可以直接提 PR。Issue 与 PR 的正文结构（Problem / Proposal / 上下文，PR 的五段式）见仓库 [AGENTS.md](AGENTS.md) 的「issue / PR / 评论的格式」一节，本文不重复，只补充它没覆盖的部分：Issue 分类、标签体系与推进面板。

技术讨论就事论事，对事不对人。提交即表示你同意以 Apache 2.0 许可（与仓库一致）授权你的贡献。AI 生成的 issue 与 PR：标题最前面加 `[AI Generated]` 标记（位于类型标签之前），正文首行注明工具。**未正确标记的，不予受理，不开展进一步工作和实施。**

## 提 Issue

发帖前先检索 README、文档与既有 Issue / PR——搜得到的，评论到既有帖子里，不发新帖。

Issue 分五类，各有一套模板，按要提交的内容选择：

| 类型 | 用途 |
|---|---|
| Bug | 记录现有预期行为的失效 |
| Feature | 新增或有意改变可观察行为 |
| Idea | 尚未承诺实施、但具有行动可能的想法 |
| Research | 形成结论、证据或决策 |
| Task | 明确的非 Feature、非 Bug 工作 |

标题以类型标签开头，后接说清对象和目的的一句话，不写方案。Issue 用 `[FEAT]` / `[BUG]` / `[IDEA]` / `[RESEARCH]` / `[TASK]`（与所选模板对应，模板已预填）；PR 用意图标签 `[FEAT]` / `[FIX]` / `[DOC]` / `[TEST]` / `[CLEANUP]` / `[DEP]`（与 kind 对应）。优先级、状态等其余元信息不进标题，由 Project 字段承载。

使用问题、想法探讨与一般性讨论走 [Discussions](https://github.com/cislunarspace/CODE/discussions)，不占用 Issue。需要维护者拍板的点在正文单独列出（**待拍板**）；后来在 PR 里落地的，合并前回 Issue 评论拍板结果——决策记在 Issue，不记在 PR 描述里。

## 提 Pull Request

Fork 并建分支，改动完成后本地跑测试（`uv run pytest`、前端与 Rust 壳按改动范围各跑各的），然后开 PR 指向 `master`。PR 标题带意图标签（见上方标题约定）并回应 Issue 标题，正文按模板五段（Summary / Motivation / Changes / Why this is safe / Test plan），`Closes #NN` 置顶（合并即自动关闭 Issue，面板随关闭流转）；与 Issue 方案不一致的落法单独一段交代原因，说不清对账的，Closes 改 Refs。一个 PR 只做一件事。

## 标签体系

标签回答两个独立的问题：改动是什么意图（`kind/*`），实质影响哪个领域（`area/*`）。打标是维护者的职责，贡献者不必操心。

**`kind/*`——PR 恰好一个**，记录主导意图：

| 标签 | 含义 |
|---|---|
| `kind/feature` | 新增或有意改变行为 |
| `kind/bug-fix` | 修正错误行为 |
| `kind/doc` | 文档为主要意图 |
| `kind/testing` | 只动测试或测试基建 |
| `kind/cleanup` | 不改行为地维护或简化（含重构） |
| `kind/dependency` | 更新依赖，无其他主导意图 |

**`area/*`——PR 至少一个**，命名实质影响的持久领域：`area/gui`（React 前端界面与交互）、`area/tauri`（Rust 壳、sidecar 编排与打包更新）、`area/catalog`（轨道库页面与数据）、`area/plot`（绘图与可视化）、`area/i18n`（界面文案本地化）、`area/domain`（领域模型与术语映射）、`area/data`（数据完整性与缓存）、`area/docs`（文档）、`area/infra`（构建、CI、发布与脚本）。

领域清单是开放的：现有描述确实盖不住新的持久领域时，维护者新建 `area/<kebab-case>`；不为单个 PR、临时事项或个人建域。

Issue 不用 kind 标签，分类由模板创建时自动打的标签承担（`type/*` 五种，与上表五类对应）；`area/*` 对 Issue 可选。`ready-for-agent`、`ready-for-human`、`needs-triage`、`needs-info` 是分诊标签，记录一项工作交给谁、卡在谁那里，与两轴标签正交。

## Project 流水线

本仓库与 [e2m2e](https://github.com/cislunarspace/CODE-core) 共用一块推进面板「[cislunarspace Issue Management](https://github.com/users/ouyangjiahong26/projects/1)」，Repository 字段区分来源，两个仓的工作同屏排序：

| 状态 | 含义 |
|---|---|
| Inbox | 新到，待分诊 |
| Backlog | 已确认，未排期 |
| Ready | 已排期，可开工 |
| In progress | 实现中 |
| In review | 等评审 |
| Done | 完成（对应 Issue 关闭原因 Completed） |
| No action | 不处理（对应关闭原因 Not planned） |

状态与 Issue 开合自动对应：Done 与 No action 是终态，分别要求 Issue 以 Completed 与 Not planned 关闭；重开的 Issue 回到 Inbox。每条 Issue 还带 `Priority`（P0–P3，可不设）与 `Start Date`（开工日期）两个字段，由维护者维护。
