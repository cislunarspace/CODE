// SOP 步骤带回归（ADR 0034）：阶段渲染与当前阶段标记、阶段取值文案、点阶段执行
// 该阶段动作、阻断项列出原因并提供“去补”，无阻断项时不渲染阻断区。
// SOP step strip regression (ADR 0034): stages render with the current one marked,
// per-stage values show, clicking a stage performs that stage's action, blockers
// list their cause with a remedy, and no blocker row appears when nothing blocks.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SopBar, type SopBarProps } from "./SopBar";
import { I18nProvider } from "./i18n";
import { SOP_STAGES, type SopBlocker } from "./sop";

const renderBar = (over: Partial<SopBarProps> = {}) => {
  const props: SopBarProps = {
    mode: "light",
    stages: SOP_STAGES.map((key, index) => ({ key, done: index < 2, current: index === 2 })),
    values: { task: "轨道族生成" },
    blockers: [],
    onStageClick: vi.fn(),
    onFix: vi.fn(),
    ...over,
  };
  render(
    <I18nProvider>
      <SopBar {...props} />
    </I18nProvider>,
  );
  return props;
};

describe("SOP 步骤带", () => {
  it("七个阶段全部渲染，当前阶段带序号与名称，阶段取值跟随显示", () => {
    renderBar();
    for (const key of SOP_STAGES) {
      expect(screen.getByTestId(`sop-stage-${key}`)).toBeTruthy();
    }
    // 第三格是当前阶段（填参数），本用例把它设为 current
    expect(screen.getByTestId("sop-stage-params").textContent).toContain("填参数");
    expect(screen.getByTestId("sop-stage-task").textContent).toContain("轨道族生成");
  });

  it("点阶段把阶段键回传（跳步由调用方决定落点）", () => {
    const { onStageClick } = renderBar();
    fireEvent.click(screen.getByTestId("sop-stage-run"));
    expect(onStageClick).toHaveBeenCalledWith("run");
  });

  it("无阻断项时不渲染阻断区", () => {
    renderBar();
    expect(screen.queryByTestId("sop-blockers")).toBeNull();
  });

  it("阻断项列出原因与明细，点“去补”回传补救类型", () => {
    const blockers: SopBlocker[] = [
      { key: "epoch", labelKey: "sop.block.epoch", fix: "pick-epoch", detail: "tli_epoch" },
    ];
    const { onFix } = renderBar({ blockers });
    const row = screen.getByTestId("sop-blockers");
    expect(row.textContent).toContain("不可运行");
    expect(row.textContent).toContain("未确定参考历元");
    expect(row.textContent).toContain("tli_epoch");
    fireEvent.click(screen.getByTestId("sop-fix-epoch"));
    expect(onFix).toHaveBeenCalledWith("pick-epoch");
  });

  it("多个阻断项各自一个补救入口", () => {
    const blockers: SopBlocker[] = [
      { key: "epoch", labelKey: "sop.block.epoch", fix: "pick-epoch", detail: "" },
      { key: "params", labelKey: "sop.block.params", fix: "fill-params", detail: "轨道圈数: 必填" },
      { key: "upstream", labelKey: "sop.block.upstream", fix: "pick-record", detail: "" },
    ];
    renderBar({ blockers });
    expect(screen.getByTestId("sop-fix-epoch")).toBeTruthy();
    expect(screen.getByTestId("sop-fix-params")).toBeTruthy();
    expect(screen.getByTestId("sop-fix-upstream")).toBeTruthy();
  });
});
