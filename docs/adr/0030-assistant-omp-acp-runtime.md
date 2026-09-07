# ADR 0030：AI 会话以 omp 为基座（ACP 取代自建 agent loop）

**状态**：已接受
**日期**：2026-09-06
**关联**：ADR 0022（功能定位与分级确认，确认分级语义延续）；ADR 0023（Rust 宿主 agent loop + MCP 拓扑，本篇取代其 agent loop 决策）；ADR 0025（会话历史与多会话，存储事实源易主）；ADR 0026（思考等级，映射表改钉 omp 值域）；ADR 0027（宿主情景工具，实现迁移、语义不变）

## 背景

ADR 0023 落地的自建 Rust agent loop（OpenAI 兼容协议 SSE 流解析、工具编排、确认/中断、多会话 JSONL）与 omp 的能力大量重叠：omp 已有模型接入、凭据管理、会话持久化、思考流与 agent loop，且随应用可分发。两套会话事实源（应用 `sessions/*.jsonl` 与 omp session）并存导致协议适配层（provider 方言、思考映射、SSE 解析）持续双维护。

ACP（Agent Client Protocol）是 omp 原生暴露的 stdio 协议：换行 JSON-RPC，`initialize`/`session/new`/`session/prompt`/`session/update`/`session/cancel` 等标准方法。omp 18.1.11 实测契约（本机握手与工具调用行为，非文档转述）：

- `session/new` 接受 ACP `mcpServers` 条目，omp 代管子进程并发现工具；条目 `env` 必须给数组（缺失即内部错误）；
- MCP 工具以 `xd://mcp__<server>_<tool>` 设备暴露（工具名消毒：数字→下划线），调用走 xd 写；
- 工具审批有两个通道：`elicitation/create`（"Allow tool" 表单，客户端 initialize 声明 `elicitation.form` 能力才启用；应答 `{action:"accept", content:{value:"Approve"|"Deny"}}`）与 ACP 标准 `session/request_permission`（应答 selected optionId）；实测 MCP 工具走前者；
- 审批策略由 omp 配置 `tools.approvalMode` 与逐工具 `tools.approval.<name>` 决定，可经 `omp acp --config <yaml覆盖文件>` 按进程注入；
- `session/load` 回放历史为 `session/update` 通知流（user/agent/thought chunk + tool_call[_update]）；对已打开会话二次 load 不回放；
- `session/cancel` 通知使在飞 prompt 以 `stopReason: "cancelled"` 结束；
- 思考档位是 session 配置项（`session/set_config_option`，configId `thinking`，值域 off/auto/minimal/low/medium/high）。

## 决策

1. **omp 为唯一会话运行时**。应用删除自建 LLM client（`llm.rs`）、系统提示组装（`prompt.rs`）、结果投影（`summary.rs`）、模型配置与会话 JSONL 存储（`store.rs`）与 agent loop（旧 `mod.rs`）。模型服务、API key、provider、原生 thinking 配置一律由 omp 原生配置管理，应用不保存、不回读、不提供第二套配置（旧 `assistant.json`/`assistant.key` 只检测存在性用于迁移提示，不自动复制）。
2. **进程拓扑**：app 懒启动一个 `omp acp --config <审批覆盖文件>` 子进程，一个 ACP 进程服务多会话；omp 在 `session/new` 时按 ACP mcpServers 拉起本应用二进制的 `--assistant-mcp-bridge` 模式（MCP stdio 服务）：`tools/list` = mcp-serve 工具原样 + 宿主情景工具，`tools/call` 原样转发 mcp-serve（含自愈与进度）或本地执行宿主工具（ADR 0027 语义不变）。mcp-serve 命令经环境变量传递（无密钥），会话工作目录为应用配置目录（会话索引按它过滤，不混入用户 CLI 会话）。
3. **审批分级延续**（ADR 0022 决策 4）：只读白名单（catalog_query/catalog_get/scenario_list）经 omp 配置覆盖文件逐工具 `allow` 免确认；其余一律 always-ask，审批经 `elicitation/create` 映射为现有工具卡片（tool_proposed→确认/拒绝→Approve/Deny）。omp 审批协议不携带改后参数，改参能力随协议事实移除（参数全文展示供审阅）。
4. **事件模型单一转换**：所有 `session/update` 只在 Rust 侧转换一次为既有 `assistant-event` 载荷（delta/thinking/tool_*/message_done/interrupted/error），新增 `user_message`（用户气泡统一由事件流渲染）与 `reset`（重建指令）。回放（session/load）与实时流同一契约，前端不再解析任何历史文件格式。
5. **会话操作面**：新建=session/new；切换=session/load 回放（进程内二次切换走应用侧会话事件日志重放——omp 对已打开会话不回放）；清空=新建（omp 无 reset 能力，旧会话留作历史，不删 omp 原生文件）；中断=session/cancel（cancelled→interrupted 事件，废除"插入普通用户消息续跑"假中断）；思考三档固定映射 off→off、standard→medium、deep→high（不可用回退 medium 一次并显式报错）。
6. **分发**：发布包携带固定版本 omp（release 流水线下载钉版二进制进资源 `binaries/`）；开发构建 `TOD_OMP_BIN` 或 PATH。两者都没有时助手空态明确报"未安装"，不静默降级。

## 考虑过的选项

- **继续双栈（自建 loop 保底）**（否决）：两套会话事实源与 provider 适配的双维护正是本决策要消除的；保底意味着两套都得对。
- **omp RPC 模式（`--mode rpc`）而非 ACP**（否决）：RPC 是 omp 私有协议面，ACP 是其对外标准承诺；客户端不该耦合私有协议。
- **读 omp session JSONL 重建回放**（否决）：私有文件格式，版本漂移即碎；`session/load` 的标准回放已覆盖。
- **审批走 `session/request_permission`**（部分保留）：omp 18.1.11 的 MCP 工具实测走 elicitation 表单；标准 permission 路径实现为协议完备（同一挂起决定、不同应答形状），未来 omp 切换通道时无需改 UI。

## 后果

- 应用侧删除约 1200 行协议适配代码（SSE 解析/provider 方言/思考映射/会话 JSONL），新增约 900 行 ACP 客户端 + 桥接 + 转换层；协议演进风险转移到 omp（钉版分发）。
- 工具卡片失去改参入口（omp 审批协议无参数通道）；失去分数制进度条（omp 更新流不带 progressToken 分数），运行态回退耗时指示。
- 会话历史由 omp session 目录管理：应用重启后按 localStorage 的会话 id 索引 session/load 恢复；跨设备/手动导出语义暂缺（omp 侧能力，后续单独决策）。
- `scripts/smoke_omp_acp.py` 成为发布链路外的真实链路冒烟闸（握手/桥接/白名单/审批/取消/回放）。
