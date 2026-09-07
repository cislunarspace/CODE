// chatModel 单测：live/回放事件折叠（omp ACP 基座：后端是唯一事件源，
// 回放与实时流同一契约，前端只折叠）。

import { describe, it, expect } from "vitest";
import { foldAll, foldEvent, type ChatItem } from "./chatModel";
import type { ToolCardData } from "./ToolCardView";
import type { AssistantEventPayload } from "./api";

function kinds(items: ChatItem[]): string[] {
  return items.map((i) => i.kind);
}

function toolCard(item: ChatItem): ToolCardData {
  if (item.kind !== "tool") throw new Error("expected tool item");
  return item.card;
}

describe("reset / user_message", () => {
  it("reset 清空序列（回放开头）", () => {
    const seeded = foldEvent([], { kind: "user_message", text: "旧问题" });
    const out = foldEvent(seeded, { kind: "reset" });
    expect(out).toEqual([]);
  });

  it("user_message 累并成用户气泡（多条块拼接）", () => {
    let items = foldEvent([], { kind: "user_message", text: "回放：最早" });
    items = foldEvent(items, { kind: "user_message", text: "的问题" });
    expect(items).toEqual([{ kind: "user", text: "回放：最早的问题" }]);
  });

  it("用户气泡后接助手气泡，不互相并块", () => {
    let items = foldEvent([], { kind: "user_message", text: "问" });
    items = foldEvent(items, { kind: "delta", text: "答" });
    expect(kinds(items)).toEqual(["user", "assistant"]);
  });
});

describe("foldEvent 流式折叠", () => {
  it("delta 增量归并进同一助手气泡", () => {
    let items = foldEvent([], { kind: "delta", text: "你" });
    items = foldEvent(items, { kind: "delta", text: "好" });
    expect(items).toEqual([{ kind: "assistant", text: "你好" }]);
  });

  it("thinking 归并成块，正文出现后开新块", () => {
    let items = foldEvent([], { kind: "thinking", text: "想" });
    items = foldEvent(items, { kind: "thinking", text: "一下" });
    items = foldEvent(items, { kind: "delta", text: "答" });
    items = foldEvent(items, { kind: "thinking", text: "再想" });
    expect(kinds(items)).toEqual(["thinking", "assistant", "thinking"]);
    expect((items[0] as { text: string }).text).toBe("想一下");
  });

  it("工具卡片 proposed → running → done（带 recordId 摘要）", () => {
    let items: ChatItem[] = foldEvent([], {
      kind: "tool_proposed",
      callId: "1001",
      tool: "cr3bp_compute",
      arguments: { mu: 0.012 },
    });
    items = foldEvent(items, { kind: "tool_started", callId: "1001", tool: "", arguments: null });
    items = foldEvent(items, {
      kind: "tool_done",
      callId: "1001",
      tool: "cr3bp_compute",
      ok: true,
      summary: { recordId: "rec-7", status: "ok" },
    });
    const card = toolCard(items[0]);
    expect(card.status).toBe("done");
    expect(card.summary?.recordId).toBe("rec-7");
  });

  it("tool_done ok=false 落失败态并保留 error 摘要", () => {
    const items = foldEvent([], {
      kind: "tool_done",
      callId: "9",
      tool: "x",
      ok: false,
      summary: { error: { message: "参数越界" } },
    });
    const card = toolCard(items[0]);
    expect(card.status).toBe("error");
  });

  it("工具卡片后新开助手气泡", () => {
    let items = foldEvent([], { kind: "tool_started", callId: "1", tool: "t", arguments: {} });
    items = foldEvent(items, { kind: "delta", text: "结果" });
    expect(kinds(items)).toEqual(["tool", "assistant"]);
  });

  it("运行期错误落持久错误气泡；中断落界限标记", () => {
    let items = foldEvent([], { kind: "error", message: "连接断开" });
    items = foldEvent(items, { kind: "interrupted" });
    expect(kinds(items)).toEqual(["error", "interrupted"]);
  });

  it("message_done 不改变显示序列", () => {
    const items = foldEvent([{ kind: "assistant", text: "a" }], {
      kind: "message_done",
      usage: { total_tokens: 3 },
    });
    expect(items).toEqual([{ kind: "assistant", text: "a" }]);
  });
});

describe("回放序列（reset + 逐条重建）", () => {
  it("foldAll 重建完整时间线：用户/正文/思考/工具卡片", () => {
    const replay: AssistantEventPayload[] = [
      { kind: "reset" },
      { kind: "user_message", text: "画 halo" },
      { kind: "thinking", text: "选工具" },
      { kind: "tool_proposed", callId: "100", tool: "halo_compute", arguments: { Az_km: 8000 } },
      { kind: "tool_started", callId: "100", tool: "", arguments: null },
      {
        kind: "tool_done",
        callId: "100",
        tool: "halo_compute",
        ok: true,
        summary: { recordId: "rec-r" },
      },
      { kind: "delta", text: "完成" },
      { kind: "message_done", usage: null },
    ];
    const items = foldAll([], replay);
    expect(kinds(items)).toEqual(["user", "thinking", "tool", "assistant"]);
    const card = toolCard(items[2]);
    expect(card.status).toBe("done");
    expect(card.summary?.recordId).toBe("rec-r");
  });
});
