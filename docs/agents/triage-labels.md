# Triage Labels

技能以五个标准分诊角色来表述。本文件将这些角色映射到本仓库 issue tracker 中实际使用的标签字符串。

| 本技能集内的标签 | 本 tracker 中的标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 维护者需要评估此 issue |
| `needs-info` | `needs-info` | 等待报告者补充更多信息 |
| `ready-for-agent` | `ready-for-agent` | 规格完整，AFK agent 可直接开始 |
| `ready-for-human` | `ready-for-human` | 需要人工实现 |
| `wontfix` | 无对应标签 | 不予处理 |

当技能提到某个角色时（如“打上 AFK 就绪的分诊标签”），使用本表中对应的标签字符串。

`wontfix` 没有对应标签，这是 ADR 0029 的刻意选择：旧默认集里的 `wontfix` 已随标签迁移删除，其语义由面板终态 `No action` 承担。分诊到 `wontfix` 时，issue 以 Not planned 原因关闭，面板 Status 置为 `No action`，不重建该标签。

## 分类角色

两个分类角色由 issue 模板预填的 `type/*` 标签承担，分诊时只核对、不新增，也不改写模板已经打上的类型：

| 本技能集内的角色 | 本 tracker 中的标签 | 含义 |
| --- | --- | --- |
| `bug` | `type/bug` | 有东西坏了 |
| `enhancement` | `type/feature` | 新功能或有意改变行为 |

`type/idea`、`type/research`、`type/task` 是没有对应分类角色的类型，由 issue 模板选定。

`kind/*`（`kind/feature`、`kind/bug-fix`、`kind/doc`、`kind/testing`、`kind/cleanup`、`kind/dependency`）只用于 PR，与分诊角色正交；`area/*` 是可选区域标签，两类都不进状态机。标签体系全貌见 CONTRIBUTING.md 的标签体系一节。
