# ADR 0029：贡献流程——type/kind/area 标签、五类模板与共用推进面板

**状态**：已接受
**日期**：2026-09-04
**关联**：AGENTS.md（issue / PR / 评论的格式——本 ADR 不改它的正文结构约定，只补它没覆盖的分类、标签与面板）；e2m2e 仓 ADR 0046（同一体系的先行决策）；GitHub 面板 ouyangjiahong26/projects/1

## 背景

仓库对外开放贡献，但流程缺位：没有 Issue 与 PR 模板，AGENTS.md 定下的正文结构（Problem / Proposal / 上下文、PR 五段）只约束读得到 AGENTS.md 的人，外部贡献者看不见；标签是历史积累的扁平集（feature、refactor、gui、tauri、cr3bp……约 20 个），意图与领域混在一个平面上，同一含义有 kind 与 area 两种用法（gui 既是界面领域又常与 refactor 连用表达"改界面"）；Issue 推进状态没有任何承载，翻列表靠记性。

姊妹仓 e2m2e 刚落地了同一套体系（ADR 0046）：五类 Issue 模板、type/kind/area 三组标签、七态 Project 面板。两个仓是一个程序的两半（e2m2e 出算法，本仓出 GUI），工作经常跨仓成对出现——#609 的本仓侧与 GUI 侧就是一例。

## 决策

### 1. 正文结构沿用 AGENTS.md，模板把它焊死

五套 Issue 模板（Bug / Feature / Idea / Research / Task）正文一律 Problem / Proposal / 上下文 三段加待拍板行，PR 模板按 Closes 置顶 + Summary / Motivation / Changes / Why this is safe / Test plan 五段。模板是 AGENTS.md 格式约束的外化，不改写它。

### 2. type/kind/area 三组标签，与 e2m2e 同构

- Issue 分类由模板创建时自动打 type/*（个人仓库没有组织仓库的原生 Issue Type）；
- PR 恰好一个 kind/*（闭集六种，与 e2m2e 相同；refactor 并入 kind/cleanup）；
- PR 至少一个 area/*（开放集），初版九个按本仓持久领域：gui、tauri、catalog、plot、i18n、domain、data、docs、infra。旧扁平标签全部删除，开放 issue 先迁移再删（#483→type/bug+area/gui，#482→type/idea+area/gui，#470→type/task+area/catalog+area/gui）。

### 3. 与 e2m2e 共用一块推进面板

面板「e2m2e Issue Management」更名为「cislunarspace Issue Management」，两个仓的 Issue 同进一块板，Repository 字段区分来源。七态流水线、Priority、Start Date、内置自动化（入板→Inbox、关闭→Done、重开→Inbox、PR 联动）全部沿用，不再新开面板。

### 4. Discussions 开启

使用问题与想法探讨走 Discussions，不占用 Issue；模板选择器页（config.yml）指向它，blank issue 关闭。

## 备选

- **本仓独立一块面板**：与 e2m2e 完全对称，但跨仓工作要看两处、内置自动化要再配一遍；单人维护两仓，一屏看全胜过对称。
- **沿用扁平标签集**：不迁移、只加前缀组——新旧并存会让同一含义有两种写法，查询语义长期含混。
- **照抄 e2m2e 模板**（一句话 + 折叠）：与本仓 AGENTS.md 已定的三段式冲突，两套结构并存必有一套被无视。

## 后果

- 新增：CONTRIBUTING.md、五套 Issue 模板与 config.yml、PR 模板、type/kind/area 标签、Discussions。
- 变更：README 与 README.zh-CN 贡献节指向 CONTRIBUTING.md；开放 issue 标签迁移；约 26 个旧标签删除（含默认集 bug/enhancement/documentation/wontfix/invalid/question，语义分别由 type/*、kind/*、面板终态 No action 与 needs-info 承担）。
- 不变：AGENTS.md 的正文结构、评论格式、提案先行流程；分诊标签（needs-triage、needs-info、ready-for-agent、ready-for-human）；duplicate、good first issue、help wanted。
- 代价：标签与面板状态仍靠维护者手工维护（与 e2m2e ADR 0046 决策 5 相同的取舍）；PR 量增大或规则漂移出现时，再评估 policy 自动化。
