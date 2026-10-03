// ToolCardView 回归测试（#444）：
// - scenario_write 完成卡（summary 携带 scenarioFile）出「应用情景」按钮，
//   点击回调 onApplyScenario(path)——与「查看产物入树」同语义的跳转入口
// - 非 scenario_write 工具 / 无 scenarioFile 的完成卡不出该按钮
// ToolCardView regression tests (#444):
// - a done scenario_write card (summary carrying scenarioFile) shows the
//   "apply scenario" button, calling onApplyScenario(path) — the
//   same-semantics jump entry as "view artifact into tree"
// - done cards of other tools, or without scenarioFile, never show it.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolCardView, type ToolCardData } from "./ToolCardView";

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
});

const PATH = "C:\\Users\\dev\\AppData\\Roaming\\cislunar-code\\scenarios\\nrho-set.json";

function card(partial: Partial<ToolCardData>): ToolCardData {
  return {
    callId: "c1",
    tool: "scenario_write",
    args: {},
    status: "done",
    ...partial,
  };
}

describe("ToolCardView 应用情景按钮（#444）", () => {
  it("scenario_write 完成卡出「应用情景」，点击回调路径", () => {
    const onApplyScenario = vi.fn();
    const onOpenRecord = vi.fn();
    render(
      <ToolCardView
        card={card({ summary: { status: "ok", scenarioFile: PATH } })}
        onOpenRecord={onOpenRecord}
        onApplyScenario={onApplyScenario}
      />,
    );
    const btn = screen.getByText(/应用情景/);
    fireEvent.click(btn);
    expect(onApplyScenario).toHaveBeenCalledWith(PATH);
    expect(onOpenRecord).not.toHaveBeenCalled();
    // 文件名（而非全路径）随按钮展示
    // The button shows the file name (not the full path).
    expect(screen.getByText(/nrho-set\.json/)).toBeDefined();
  });

  it("done 卡需先展开（折叠态点行展开后可见按钮）", () => {
    render(
      <ToolCardView
        card={card({ summary: { status: "ok", scenarioFile: PATH } })}
        onOpenRecord={vi.fn()}
        onApplyScenario={vi.fn()}
      />,
    );
    // done 卡的动作按钮与「查看产物」同位：折叠态也常显（点击行展开参数详情）
    // A done card's action button sits like "view artifact": always visible
    // even collapsed (clicking the row expands the args detail).
    expect(screen.getByText(/应用情景/)).toBeDefined();
  });

  it("其他工具或无 scenarioFile 的完成卡不出该按钮", () => {
    const { rerender } = render(
      <ToolCardView
        card={card({ tool: "design_orbit", summary: { status: "ok", scenarioFile: PATH } })}
        onOpenRecord={vi.fn()}
        onApplyScenario={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("design_orbit"));
    expect(screen.queryByText(/应用情景/)).toBeNull();

    rerender(
      <ToolCardView
        card={card({ summary: { status: "ok" } })}
        onOpenRecord={vi.fn()}
        onApplyScenario={vi.fn()}
      />,
    );
    expect(screen.queryByText(/应用情景/)).toBeNull();
  });
});
