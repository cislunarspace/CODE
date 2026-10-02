// CODE 助手桥接扩展：注册 tod MCP 服务器 + 工具审批闸。
// 经 `pi --extension <本文件>` 加载（jiti 免编译）；Rust 壳注入
// TOD_APP_BIN（本应用二进制，--assistant-mcp-bridge 模式）与
// TOD_BRIDGE_CWD（桥接进程工作目录）。协议与 API 契约见 ADR 0032。
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 只读免确认白名单（ADR 0022 决策 4；valid_ranges 为纯读查询的扩展）。
// 工具名是桥接层原样转发的短名（mcp__tod__<短名>）。
const READ_ONLY: Record<string, true> = {
  catalog_query: true,
  catalog_get: true,
  scenario_list: true,
  valid_ranges: true,
};

// 审批卡载荷信封：Rust 端（events.rs APPROVAL_PREFIX）按前缀识别并解析
// 出工具与参数出卡片，两端成对维护。
const APPROVAL_PREFIX = "TOD_TOOL_APPROVAL ";

export default function (pi: ExtensionAPI) {
  // timeout 3600s：pi 默认每请求 60s 超时会杀掉 design_orbit 级长计算。
  // env 不显式传：子进程默认继承 pi 进程环境（Rust 已注入
  // TOD_RESOURCE_DIR / E2M2E_* / SPICE_KERNEL_DIR）。
  pi.registerMcpServer("tod", {
    command: process.env.TOD_APP_BIN!,
    args: ["--assistant-mcp-bridge"],
    cwd: process.env.TOD_BRIDGE_CWD,
    exposure: "direct",
    timeout: 3600,
    description: "e2m2e 轨道设计与轨道库工具、宿主情景工具",
  });
  // 审批闸（ADR 0032 决策 4）：白名单直跑，其余 select 出卡。
  // select 不传 timeout：应用 abort 时对话框按 undefined 解析 → 走拒绝，
  // fail-closed；选项文案与 Rust 端应答解析（“批准”/“拒绝”）成对。
  pi.on("tool_call", async (event, ctx) => {
    const short = event.toolName.match(/^mcp__tod__(.+)$/)?.[1];
    if (short && READ_ONLY[short]) return; // 只读免确认
    const title =
      APPROVAL_PREFIX +
      JSON.stringify({
        toolCallId: event.toolCallId,
        tool: event.toolName,
        arguments: event.input,
      });
    const choice = await ctx.ui.select(title, ["批准", "拒绝"]);
    if (choice !== "批准") {
      return { block: true, reason: `${event.toolName} 未获用户批准` };
    }
  });
}
