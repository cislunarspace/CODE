// SessionSwitcher 测试：富行（标题 + 消息数·相对时间）、当前会话兜底
// 显示、新建按钮与切换上报、门禁禁用。

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionSwitcher } from "./SessionSwitcher";
import type { SessionMeta } from "./api";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const now = new Date();
const sessions: SessionMeta[] = [
  {
    id: "s-old",
    title: "昨天的问题",
    updatedAt: new Date(now.getTime() - 26 * 3600_000).toISOString(),
    messageCount: 12,
  },
  {
    id: "s-fresh",
    title: null,
    updatedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
    messageCount: 3,
  },
];

function setup(overrides: Partial<Parameters<typeof SessionSwitcher>[0]> = {}) {
  const props = {
    sessions,
    currentId: "s-fresh",
    disabled: false,
    onSwitch: vi.fn(),
    onNew: vi.fn(),
    ...overrides,
  };
  render(<SessionSwitcher {...props} />);
  return props;
}

describe("SessionSwitcher", () => {
  it("下拉行显示标题与「消息数 · 相对时间」，无标题显示未命名会话", () => {
    setup();
    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect(screen.getAllByText("未命名会话").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("12 条 · 1 天前")).toBeDefined();
    expect(screen.getByText("3 条 · 5 分钟前")).toBeDefined();
  });

  it("选择会话上报 id，新建按钮回调 onNew", () => {
    const props = setup();
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("昨天的问题"));
    expect(props.onSwitch).toHaveBeenCalledWith("s-old");
    fireEvent.click(screen.getByTitle("新建会话"));
    expect(props.onNew).toHaveBeenCalledTimes(1);
  });

  it("当前会话不在索引中时兜底出现在下拉（不凭空消失）", () => {
    setup({ currentId: "s-not-in-list" });
    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect(screen.getAllByText("未命名会话").length).toBeGreaterThanOrEqual(1);
  });

  it("门禁禁用时下拉与新建都不可用", () => {
    setup({ disabled: true });
    expect(
      screen.getByRole("combobox").closest(".ant-select")?.classList.contains("ant-select-disabled"),
    ).toBe(true);
    expect((screen.getByTitle("新建会话") as HTMLButtonElement).disabled).toBe(true);
  });
});
