# ADR 0032：AI 会话运行时切换为 pi（RPC 取代 ACP）

**状态**：已接受
**日期**：2026-10-02
**关联**：ADR 0030（omp 基座，本篇取代其运行时选择，保留为历史）；ADR 0022（功能定位与分级确认，白名单语义延续）；ADR 0023（MCP 拓扑，桥接服务器语义不变）；ADR 0027（宿主情景工具，不变）

## 背景

omp（can1357/oh-my-pi）随应用分发的资产在 230–278 MB 量级，占安装包体积大头，用户明确反馈臃肿。pi（earendil-works/pi-coding-agent）v1.0.0 预编译资产 43–45 MB，功能面覆盖应用所需（模型接入、凭据、会话持久化、思考流、agent loop、扩展机制）。协议面：omp 走私有 ACP 方言（elicitation 审批表单、xd 设备路径、eval 包装漂移，见 ADR 0030 的两次实测记录），漂移风险持续；pi 原生 RPC（`pi --mode rpc`）是文档化的 stdin/stdout JSONL 协议，命令/响应/事件三层清晰。

pi v1.0.0 实测契约（本机安装与 `.d.ts` 核对，非文档转述）：

- 命令 `{"id","type",…}` → 响应 `{"id","type":"response","command","success","data"}`，按 id 多路复用；会话事件（`message_update`/`tool_execution_start|end`/`agent_end`/`agent_settled` 等）无 id 直接流式；
- 扩展层（TypeScript，`--extension <path>` 经 jiti 免编译加载）可 `pi.registerMcpServer(name, config)`（config 含 `command/args/cwd/exposure/timeout`）注册会话级 MCP 服务器、`pi.on("tool_call", …)` 拦截审批（事件字段 `toolCallId`/`toolName`/`input`，返回 `{block, reason}` 可阻断）；RPC 下 `ctx.ui.select` 经 `extension_ui_request`/`extension_ui_response` 子协议到达客户端；
- 工具命名 `mcp__<server>__<tool>`（双下划线），无 omp 的数字消毒改名；
- RPC 无列出会话的命令：会话文件 `~/.pi/agent/sessions/--<path>--/<timestamp>_<id>.jsonl`（首行 SessionHeader），`PI_CODING_AGENT_SESSION_DIR` 可覆盖目录；`switch_session` 按 `sessionPath` 加载、`get_messages` 取全量消息用于回放。

## 决策

1. **pi 为唯一会话运行时**（取代 omp）。模型/凭据/thinking 由 pi 原生配置（`~/.pi/agent/auth.json`、`models.json`、`settings.json`）管理，本应用不保存。omp 侧会话 JSONL 留在原地不迁移（omp 卸载与否用户自决），应用内不可见。
2. **拉起参数**：`pi --mode rpc --no-extensions --extension builtin:mcp --extension <tod-bridge.ts> --no-builtin-tools`。`--no-builtin-tools` 使模型只有 tod 工具（延续 ADR 0022 工具纪律）；`--no-extensions` 不加载用户个人扩展（RPC 会话由应用驱动，个人扩展属意外代码面），显式 `-e builtin:mcp` 保住内置 MCP 支持、`-e <tod-bridge.ts>` 加载桥接扩展。用户级 `~/.pi/agent/mcp.json` 的个人服务器仍会被 builtin:mcp 读入——非 tod 工具统一走审批卡（fail-closed），不静默放行。
3. **会话目录**：`PI_CODING_AGENT_SESSION_DIR=<用户配置目录>/pi-sessions`，与终端 pi 会话隔离；切换器列表由 Rust 扫描该目录（RPC 无列表命令），逐文件读 SessionHeader 与消息计数。
4. **审批**：pi 无内建权限系统，审批闸做在桥接扩展的 `tool_call` 拦截里：只读白名单（`catalog_query`/`catalog_get`/`scenario_list`/`valid_ranges`）免确认直跑，其余一律 `ctx.ui.select` 出卡（extension_ui_request → Rust → 前端工具卡片 → 用户批准/拒绝 → extension_ui_response 回传）。select 不传 timeout——应用取消（abort）会使对话框按 undefined 解析 → 扩展视为拒绝，fail-closed。
5. **引导**：pi 原生 `prompt` + `streamingBehavior:"steer"`（排队到当前轮工具批后继续，上下文保留），取代 omp 的“新 prompt 顶掉当前轮”假引导。停止按钮走 `abort`。
6. **工具命名**：`mcp__tod__<tool>`（双下划线），领域指令直接引用工具名。
7. **MCP 超时**：registerMcpServer 配置 `timeout: 3600`（秒）——pi 默认 60s 每请求超时会杀掉 design_orbit 级长计算。
8. **配置面**：`get_available_models`/`get_available_thinking_levels`/`get_state` → Rust 构造前端线形（无 omp 的 "mode" 项）；`set_model`/`set_thinking_level` 下发。期望缓存与建会话统一下发逻辑沿用。

## 考虑过的选项

- **继续 omp 钉版升级（v18.4.10）**（否决）：用户否决，体积与私有协议漂移两大动因都不消除。
- **pi SDK 进程内集成**（否决）：要求 Node/Bun 宿主，桌面壳是 Rust。
- **pi `--mode json`**（否决）：单向输出无命令通道，无法审批/配置/切换会话。
- **审批闸做在 Rust 侧解析事件**（否决）：pi 扩展的 `tool_call` 拦截是文档化阻断点，参数与阻断都在进程内完成，客户端无需理解工具协议。

## 后果

- 事件转换层按 pi 事件形状重写（`message_update.assistantMessageEvent.text_delta.delta` → delta 等）；审批机制从协议 elicitation 变扩展拦截，`extension_ui_request` 的 select 对话框成为唯一审批通道。
- 回放改走 `switch_session` + `get_messages`：把消息数组折成回放事件序列（替代 omp session/load 回放流）；应用内已打开会话仍走本地事件日志重放。
- 会话列表不再有协议命令支撑：目录扫描自持（首行解析坏文件跳过）。
- 分发体积 230–278 MB → 43–45 MB（三平台预编译 zip/tar.gz）。
- `scripts/smoke_pi_rpc.py` 取代 `scripts/smoke_omp_acp.py` 成为真实链路冒烟闸（握手/白名单/审批卡/steer/abort/会话切换）。
