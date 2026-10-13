# ADR 0035：恢复 wontfix 分诊标签

**状态**：已接受
**日期**：2026-10-13
**关联**：ADR 0029（本 ADR 取代它关于 wontfix 删除的处置，其余决策不变）；`docs/agents/triage-labels.md`；CONTRIBUTING.md 的标签体系与 Project 流水线两节

## 背景

ADR 0029 落地 type/kind/area 标签体系时删除了 GitHub 默认集里的 wontfix，把“不予处理”的语义交给面板终态 No action 承担，并把不重建写进 `docs/agents/triage-labels.md` 与 AGENTS.md。

分诊技能以五个状态角色描述工作：needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix。前四个在本仓都有同名标签，只有 wontfix 没有落点。`docs/agents/triage-labels.md` 因此要写一条例外，把该角色人工翻译成面板状态，角色与标签不再一一对应。

## 决策

恢复 wontfix 标签，分诊角色到标签的映射重新完整。

- 新建 GitHub 标签 `wontfix`，描述 This will not be worked on，颜色 `#ffffff`。
- 分诊到 wontfix 时打上该标签，issue 以 Not planned 原因关闭，面板 Status 置为 No action。No action 仍是终态的唯一承载者，标签只表达分诊判断，不替代面板状态。
- 同步更新 `docs/agents/triage-labels.md` 的映射表与 CONTRIBUTING.md 的分诊标签清单。
- ADR 0029 的其余决策不动：五类模板、type/kind/area 标签、与 e2m2e 共用面板、Discussions。

## 备选

- **维持无对应标签**：映射表继续写例外，分诊时人工把角色翻译成面板状态。标签确实与 No action 语义重叠，代价是角色的落点不完整，读状态机的人要多过一层映射。
- **把 wontfix 映射到既有标签**：现有分诊标签里没有语义相等者。needs-info 表示等待补充信息，与“不予处理”意思相反。

## 后果

- 新增：GitHub 标签 `wontfix`。
- 变更：`docs/agents/triage-labels.md` 的映射表、CONTRIBUTING.md 的标签体系一节、ADR 0029 的状态行。
- 不变：面板七态与 No action 终态、type/kind/area 体系、其余四个分诊标签、提案先行与模板体系。
- 代价：“不予处理”这件事在标签与面板状态两处记录，分诊时两者一起落，长期可能不一致。
