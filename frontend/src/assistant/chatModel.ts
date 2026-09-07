// 会话显示模型：把 live 事件流与回放事件流（同一 `AssistantEventPayload`
// 契约）增量归并为气泡 + 工具卡片。纯函数，便于单测。
// omp ACP 基座：后端是唯一事件源（含用户气泡），前端只折叠不重建。

import type { AssistantEventPayload } from "./api";
import type { ToolCardData } from "./ToolCardView";

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "tool"; card: ToolCardData };

/**
 * 折叠一条 live/回放事件到显示序列。返回新数组（不可变更新，配合 React）。
 */
export function foldEvent(items: ChatItem[], ev: AssistantEventPayload): ChatItem[] {
  switch (ev.kind) {
    // 重建指令：清空序列（回放序列以它开头，随后事件逐条重建）
    case "reset":
      return [];
    case "user_message": {
      const next = items.slice();
      const last = next[next.length - 1];
      if (last && last.kind === "user") {
        next[next.length - 1] = { kind: "user", text: last.text + ev.text };
      } else {
        next.push({ kind: "user", text: ev.text });
      }
      return next;
    }
    case "delta": {
      const next = items.slice();
      const last = next[next.length - 1];
      if (last && last.kind === "assistant") {
        next[next.length - 1] = { kind: "assistant", text: last.text + ev.text };
      } else {
        next.push({ kind: "assistant", text: ev.text });
      }
      return next;
    }
    case "thinking": {
      // 思考增量归并进末尾思考块；前面有正文/工具事件时开新块
      const next = items.slice();
      const last = next[next.length - 1];
      if (last && last.kind === "thinking") {
        next[next.length - 1] = { kind: "thinking", text: last.text + ev.text };
      } else {
        next.push({ kind: "thinking", text: ev.text });
      }
      return next;
    }
    case "tool_proposed":
      return upsertCard(items, {
        callId: ev.callId,
        tool: ev.tool,
        args: ev.arguments,
        status: "proposed",
      });
    case "tool_started":
      return updateCard(items, ev.callId, (c) => ({
        ...c,
        tool: ev.tool || c.tool,
        args: ev.arguments ?? c.args,
        status: "running",
        startedAt: Date.now(),
      }));
    case "tool_done":
      return updateCard(items, ev.callId, (c) => ({
        ...c,
        status: ev.ok ? "done" : "error",
        summary: ev.summary,
      }));
    case "error":
      // 运行期错误作为持久气泡留在会话流里（比一次性 toast 更有上下文）
      return [...items, { kind: "error", text: ev.message }];
    case "interrupted":
      // 中断不是错误：用户主动停止，界限标记留存在会话流里
      return [...items, { kind: "interrupted" }];
    case "message_done":
      return items;
    default:
      return items;
  }
}

/**
 * 折叠一段事件序列（回放重建 / 测试）。等价于逐条 foldEvent。
 */
export function foldAll(items: ChatItem[], events: AssistantEventPayload[]): ChatItem[] {
  return events.reduce(foldEvent, items);
}

function upsertCard(items: ChatItem[], card: ToolCardData): ChatItem[] {
  const idx = items.findIndex((i) => i.kind === "tool" && i.card.callId === card.callId);
  if (idx === -1) {
    return [...items, { kind: "tool", card }];
  }
  const next = items.slice();
  const existing = next[idx] as { kind: "tool"; card: ToolCardData };
  next[idx] = { kind: "tool", card: { ...existing.card, ...card } };
  return next;
}

function updateCard(
  items: ChatItem[],
  callId: string,
  f: (c: ToolCardData) => ToolCardData,
): ChatItem[] {
  const idx = items.findIndex((i) => i.kind === "tool" && i.card.callId === callId);
  if (idx === -1) {
    // 未知 callId 的终态（如重启打断的回放残留）：补一张终态卡片，不丢摘要
    const card = f({ callId, tool: "", args: null, status: "running" });
    return [...items, { kind: "tool", card }];
  }
  const next = items.slice();
  const existing = next[idx] as { kind: "tool"; card: ToolCardData };
  next[idx] = { kind: "tool", card: f(existing.card) };
  return next;
}
