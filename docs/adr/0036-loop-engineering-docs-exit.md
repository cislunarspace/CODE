# ADR 0036：/loop-go 循环工程规则退出仓库文档

**状态**：已接受
**日期**：2026-10-13
**关联**：ADR 0029（同一批贡献流程治理）；PR #538（AGENTS.md 精简）

## 背景

AGENTS.md 曾用两节记录 `/loop-go` 循环工程：停止条件六条（全部检查通过、达到最大轮数、同一失败连续两次、修复导致回归、违反红线、checker 报告不可解析）、builder、checker 与主循环各自的红线，以及循环停止后的升级协议。引出这两节的文字写明工具文件按 harness 安装，pi 为 `.pi/agents/builder.md` 与 `.pi/agents/checker.md`，Claude Code 为 `.claude/agents/` 下的同名文件与 `.claude/commands/loop-go.md`。

这些工具文件从未进入本仓的版本控制，仓库树里也没有副本，`git ls-files` 检索无命中。

## 决策

仓库不再承载循环工程的规则，两节随 AGENTS.md 精简一并删除。规则随 harness 的 agent 与 command 定义走，仓库不复写一份，也不在本仓为它另立落点。

原文没有迁往其他文档。需要时从 git 历史取回，删除前一版的 AGENTS.md 含完整两节。

## 备选

- **留在 AGENTS.md**：规则与 harness 定义两处并存，改一处漏一处，两节与仓库其余内容也不存在引用关系。
- **迁入 CONTRIBUTING.md**：循环工程是维护者在本机跑开发循环的流程，不是面向外部贡献者的提交流程。写进贡献指南会让读者以为它是仓库流程的一部分。

## 后果

- 变更：AGENTS.md 删除 `### Loop Engineering` 与 `## Loop 停止规则` 两节。
- 不变：`docs/agents/` 三份技能配置、提案先行、标签体系、推进面板等贡献流程。
- 代价：harness 定义不在版本控制内时，循环工程的规则没有可追溯的落点。将来若要随仓分发，应把 `.pi/agents/` 与 `.claude/agents/` 下的定义纳入仓库，并另起 issue。
