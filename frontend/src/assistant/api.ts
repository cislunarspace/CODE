// AI 助手的前端封装：Tauri command 调用 + assistant-event 事件类型。
// Frontend wrapper for the AI assistant: Tauri command calls plus assistant-event types.
// 设计依据：pi RPC 基座（会话/模型/凭据/思考配置由 pi 原生管理，本应用
// 只做 RPC 客户端与事件转发，ADR 0032）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 会话配置单项（模型/思考等 select；Rust 侧由 pi 原生配置构造）。 */
export interface AssistantConfigOption {
  id: string;
  name: string;
  category?: string;
  type?: string;
  currentValue?: string | null;
  options?: { value: string; name: string; description?: string }[];
}

/** 会话索引行（Rust 目录扫描 pi-sessions 的传输形状） */
export interface SessionMeta {
  id: string;
  title: string | null;
  updatedAt: string | null;
  messageCount: number | null;
}

export interface AssistantInfo {
  /** pi 可执行文件是否可解析（false = 空态：未安装/不可执行） */
  piConfigured: boolean;
  /** RPC 进程是否存活（懒启动：未用过时为 false，不代表故障） */
  connected: boolean;
  /** 当前会话 id（null = 尚未建立会话，首条消息时懒创建） */
  sessionId: string | null;
  sessions: SessionMeta[];
  /** 会话配置面（Rust 从 pi 原生配置构造：模型/思考选项与当前值） */
  configOptions: AssistantConfigOption[];
  /** 是否有回复进行中或未决审批 */
  running: boolean;
  /** pi 可执行路径（设置分区展示） */
  piPath: string | null;
  /** 检测到旧版模型服务配置残留：提示迁移（模型与 key 在 pi 重新配置） */
  legacyConfig: boolean;
}

export type AssistantEventPayload =
  /** 重建指令：清空当前显示序列（切换/新建/清空与回放开头） */
  | { kind: "reset" }
  /** 用户气泡（live 与回放同一路径：后端统一发，前端不本地补） */
  | { kind: "user_message"; text: string }
  | { kind: "delta"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_proposed"; callId: string; tool: string; arguments: unknown }
  | { kind: "tool_started"; callId: string; tool: string; arguments: unknown }
  | {
      kind: "tool_done";
      callId: string;
      tool: string;
      ok: boolean;
      summary: {
        status?: string;
        recordId?: string;
        familyId?: string;
        scenarioFile?: string;
        error?: { message?: string };
      };
    }
  | { kind: "message_done"; usage?: { total_tokens?: number } | null }
  | { kind: "interrupted" }
  | { kind: "error"; message: string };

export async function assistantGetState(): Promise<AssistantInfo> {
  return invoke("assistant_get_state");
}

export interface SelectionContext {
  /** 画布选择的结构化描述（后端并入发给 pi 的正文，不进用户气泡） */
  [key: string]: unknown;
}

export async function assistantSend(
  message: string,
  selection: SelectionContext | null,
): Promise<void> {
  await invoke("assistant_send", { message, selection });
}

/** 确认/拒绝一次工具审批；返回 false = 该键已无挂起等待（重复点击等） */
export async function assistantConfirmTool(
  callId: string,
  approved: boolean,
): Promise<boolean> {
  return invoke("assistant_confirm_tool", { callId, approved });
}

/** 请求中断当前轮（后端发 abort）；返回是否有轮次在跑 */
export async function assistantCancel(): Promise<boolean> {
  return invoke("assistant_cancel");
}

/** 清空当前会话（pi 无 reset 能力：落位为新建，旧会话留作历史） */
export async function assistantClearHistory(): Promise<void> {
  await invoke("assistant_clear_history");
}

/** 新建会话并切换过去（受门禁）；返回新会话 id */
export async function assistantNewSession(): Promise<string> {
  return invoke("assistant_new_session");
}

/** 切换会话（get_messages 折成回放事件流重建 UI；失败保持原会话） */
export async function assistantSwitchSession(sessionId: string): Promise<void> {
  await invoke("assistant_switch_session", { sessionId });
}

/** 设置一项会话配置（model/thinking；值域由 pi 原生配置决定） */
export async function assistantSetConfigOption(
  configId: string,
  value: string,
): Promise<void> {
  await invoke("assistant_set_config_option", { configId, value });
}

/** 打开 pi 原生配置流程（终端运行交互式 pi）；失败带 stderr/原因 */
export async function assistantOpenPiSetup(): Promise<string> {
  return invoke("assistant_open_pi_setup");
}

/** 订阅助手事件流；返回退订函数。 */
export async function onAssistantEvent(
  cb: (payload: AssistantEventPayload) => void,
): Promise<() => void> {
  const unlisten = await listen<AssistantEventPayload>("assistant-event", (event) => {
    cb(event.payload);
  });
  return unlisten;
}
