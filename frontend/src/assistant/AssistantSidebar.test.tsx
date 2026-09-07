// AssistantSidebar 交互回归（#450）：
// - IME 组合中（isComposing）回车不发送——中文输入法选词回车不再发出半截话
// - 非组合回车照常发送
// - 发送失败（命令异常）时草稿恢复到输入框
// - 清空会话需 Popconfirm 确认，确认后才调用后端清空
// AssistantSidebar interaction regressions (#450):
// - Enter during IME composition (isComposing) never sends — no more half-typed
//   pinyin fired off by candidate confirmation
// - Enter outside composition sends as before
// - a failed send restores the draft into the input box
// - clearing the session requires a Popconfirm before the backend call

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { AssistantSidebar } from "./AssistantSidebar";
import {
  assistantGetState,
  assistantSend,
  assistantClearHistory,
  assistantCancel,
  type AssistantEventPayload,
} from "./api";

vi.mock("./api", () => ({
  assistantGetState: vi.fn().mockResolvedValue({
    ompConfigured: true,
    connected: true,
    sessionId: "s1",
    sessions: [{ id: "s1", title: null, updatedAt: null, messageCount: null }],
    thinkingLevel: "standard",
    running: false,
    ompPath: "/usr/bin/omp",
  }),
  onAssistantEvent: vi.fn().mockImplementation(async (cb: (payload: { kind: string }) => void) => {
    lastHandler = cb;
    return () => {};
  }),
  assistantSend: vi.fn().mockResolvedValue(undefined),
  assistantCancel: vi.fn().mockResolvedValue(true),
  assistantConfirmTool: vi.fn().mockResolvedValue(true),
  assistantClearHistory: vi.fn().mockResolvedValue(undefined),
  assistantNewSession: vi.fn().mockResolvedValue("s2"),
  assistantSwitchSession: vi.fn().mockResolvedValue(undefined),
  assistantSetThinkingLevel: vi.fn().mockResolvedValue(undefined),
  assistantOpenOmpSetup: vi.fn().mockResolvedValue(""),
}));

beforeAll(() => {
  const mm = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("matchMedia", mm);
  window.matchMedia = mm as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom 不实现 scrollIntoView（ChatView 自动滚动调用）
  // jsdom does not implement scrollIntoView (called by ChatView's auto-scroll).
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

/** 最近一次订阅的助手事件处理器（测试用它注入 live 事件）。 */
/** The latest subscribed assistant-event handler (tests inject live events
 *  through it). */
let lastHandler: ((payload: { kind: string }) => void) | undefined;

// 卸载组件并清掉 localStorage 残留，避免跨用例污染（语言/草稿）
// Unmount and clear localStorage leftovers (language/draft) across cases.
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(assistantSend).mockReset();
  vi.mocked(assistantSend).mockResolvedValue(undefined);
});

function setup() {
  render(
    <AssistantSidebar
      selection={null}
      onArtifactProduced={vi.fn()}
      onOpenRecord={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
}

/** 向输入框派发带 isComposing 的 Enter keydown（React 合成事件的 nativeEvent 即它）。 */
/** Dispatch an Enter keydown carrying isComposing (React's synthetic nativeEvent is it). */
function pressEnter(composing: boolean) {
  const box = screen.getByRole("textbox") as HTMLTextAreaElement;
  const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  Object.defineProperty(ev, "isComposing", { value: composing });
  fireEvent(box, ev);
}

async function typeDraft(text: string) {
  await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
}

describe("AssistantSidebar 发送（#450）", () => {
  it("IME 组合中回车不发送", async () => {
    setup();
    await typeDraft("把NRHO家族画出来");
    pressEnter(true);
    expect(assistantSend).not.toHaveBeenCalled();
  });

  it("非组合回车照常发送", async () => {
    setup();
    await typeDraft("把NRHO家族画出来");
    pressEnter(false);
    await waitFor(() => expect(assistantSend).toHaveBeenCalled());
    expect(vi.mocked(assistantSend).mock.calls[0][0]).toBe("把NRHO家族画出来");
  });

  it("发送失败时草稿恢复到输入框", async () => {
    vi.mocked(assistantSend).mockRejectedValueOnce(new Error("backend down"));
    setup();
    await typeDraft("失败的草稿");
    pressEnter(false);
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("失败的草稿"),
    );
  });
});

describe("AssistantSidebar 清空确认（#450）", () => {
  it("清空按钮先出确认，确认后才调用 assistantClearHistory", async () => {
    setup();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "清空会话" }));
    // 确认框文案出现，后端尚未调用
    // The confirm copy appears; the backend has not been called yet.
    expect(await screen.findByText("清空后不可恢复，确定清空当前会话？")).toBeDefined();
    expect(assistantClearHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清 空" }));
    await waitFor(() => expect(assistantClearHistory).toHaveBeenCalledTimes(1));
  });
});

// —— 中断（#453）：生成中发送按钮变停止按钮，点击请求后端中断 ——
// Interruption (#453): while generating, the send button becomes a stop
// button that asks the backend to interrupt.

describe("AssistantSidebar 中断（#453）", () => {
  it("空闲时无停止按钮，发送中发送按钮变停止按钮", async () => {
    let resolveSend: () => void = () => {};
    vi.mocked(assistantSend).mockImplementationOnce(
      () => new Promise<void>((r) => (resolveSend = r)),
    );
    setup();
    await typeDraft("画一条 NRHO");
    // 空闲：只有发送按钮
    // Idle: only the send button.
    expect(screen.queryByRole("button", { name: "停止生成" })).toBeNull();
    pressEnter(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "停止生成" })).toBeDefined());
    resolveSend();
    await waitFor(() => expect(screen.queryByRole("button", { name: "停止生成" })).toBeNull());
  });

  it("点击停止按钮触发 assistantCancel，幂等可重复点击", async () => {
    let resolveSend: () => void = () => {};
    vi.mocked(assistantSend).mockImplementationOnce(
      () => new Promise<void>((r) => (resolveSend = r)),
    );
    setup();
    await typeDraft("画一条 NRHO");
    pressEnter(false);
    const stop = await screen.findByRole("button", { name: "停止生成" });
    fireEvent.click(stop);
    fireEvent.click(stop);
    await waitFor(() => expect(assistantCancel).toHaveBeenCalledTimes(2));
    resolveSend();
  });
});

// —— 中断续跑（#461）：中断标记旁的继续按钮以固定引导文本发送 ——
// Interrupt continue (#461): the continue button sends a fixed guided text.

describe("AssistantSidebar 中断续跑（#461）", () => {
  it("中断事件折叠后出现继续按钮，点击以固定引导文本调用 assistantSend", async () => {
    setup();
    await waitFor(() => expect(lastHandler).toBeDefined());
    act(() => lastHandler!({ kind: "interrupted" }));
    const btn = await screen.findByRole("button", { name: "继续" });
    fireEvent.click(btn);
    await waitFor(() => expect(assistantSend).toHaveBeenCalledTimes(1));
    expect(vi.mocked(assistantSend).mock.calls[0][0]).toBe("请从刚才中断的地方继续。");
  });

  it("回复生成期间不出继续按钮（running 门禁）", async () => {
    let resolveSend: () => void = () => {};
    vi.mocked(assistantSend).mockImplementationOnce(
      () => new Promise<void>((r) => (resolveSend = r)),
    );
    setup();
    await typeDraft("画一条 NRHO");
    pressEnter(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "停止生成" })).toBeDefined());
    act(() => lastHandler?.({ kind: "interrupted" }));
    expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
    resolveSend();
  });
});

// —— omp 空态（ADR 0030）：未配置时给出明确引导而不是崩溃/静默 ——

describe("AssistantSidebar omp 空态", () => {
  it("ompConfigured=false 时显示未安装引导，去设置按钮回调 onOpenSettings", async () => {
    vi.mocked(assistantGetState).mockResolvedValueOnce({
      ompConfigured: false,
      connected: false,
      sessionId: null,
      sessions: [],
      thinkingLevel: "standard",
      running: false,
      ompPath: null,
      legacyConfig: false,
    });
    const onOpenSettings = vi.fn();
    render(
      <AssistantSidebar
        selection={null}
        onArtifactProduced={vi.fn()}
        onOpenRecord={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(await screen.findByText(/未找到可用的 omp/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /去设置/ }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // 空态不出输入框（助手不可用，不提供假输入）
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

// —— 产物登记（ADR 0022 A1）：tool_done 的 recordId+tool 配对上抛 ——

describe("AssistantSidebar 产物登记", () => {
  it("tool_done(ok) 摘要带 recordId 时以 (recordId, tool) 回调产物登记", async () => {
    const produced = vi.fn();
    render(
      <AssistantSidebar
        selection={null}
        onArtifactProduced={produced}
        onOpenRecord={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    await waitFor(() => expect(lastHandler).toBeDefined());
    act(() =>
      lastHandler!({
        kind: "tool_done",
        callId: "c1",
        tool: "family_generate",
        ok: true,
        summary: { recordId: "rec-42" },
      } as AssistantEventPayload),
    );
    await waitFor(() => expect(produced).toHaveBeenCalledWith("rec-42", "family_generate"));
  });

  it("tool_done 摘要无 recordId 时不触发登记", async () => {
    const produced = vi.fn();
    render(
      <AssistantSidebar
        selection={null}
        onArtifactProduced={produced}
        onOpenRecord={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    await waitFor(() => expect(lastHandler).toBeDefined());
    act(() =>
      lastHandler!({
        kind: "tool_done",
        callId: "c2",
        tool: "catalog_query",
        ok: true,
        summary: { status: "ok" },
      } as AssistantEventPayload),
    );
    expect(produced).not.toHaveBeenCalled();
  });
});
