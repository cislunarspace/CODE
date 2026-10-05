// CanvasOrbitList / buildOrbitListItems 测试（#469）：清单行渲染、交互回
// 调、色样与实际渲染色同口径（含 Jacobi colormap 与惯性视图灰显）。图注
// 从画布迁出后，这些用例接替 OrbitCanvas.test 中的图例用例（#460）。
// Tests for CanvasOrbitList / buildOrbitListItems (#469): row rendering,
// interaction callbacks, and swatches mirroring the real render colors
// (Jacobi colormap, inertial-view graying). With the legend moved off the
// canvas, these succeed the legend cases in OrbitCanvas.test (#460).

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasOrbitList } from "./CanvasOrbitList";
import { buildOrbitListItems } from "./orbitListItems";

const CYCLE = ["#4c72b0", "#dd8452", "#55a868", "#c44e52", "#8172b3"];

describe("buildOrbitListItems（#469）", () => {
  it("无标签项不进清单；色样按色环循环取色", () => {
    const items = buildOrbitListItems({
      count: 3,
      labels: ["甲轨道", "", "乙轨道"],
      colorCycle: CYCLE,
    });
    // 空标签项被过滤（filter !!item.label），色样按原行序取色
    // The empty-label entry is filtered (filter !!item.label); swatches
    // still follow the original row order.
    expect(items.map((it) => it.label)).toEqual(["甲轨道", "乙轨道"]);
    expect(items[0].color).toBe(CYCLE[0]);
    expect(items[1].color).toBe(CYCLE[2]);
  });

  it("无标签行过滤后 trajIndex 回指原行号（#476 聚焦/详情索引空间）", () => {
    const items = buildOrbitListItems({
      count: 3,
      labels: ["甲轨道", "", "乙轨道"],
      colorCycle: CYCLE,
    });
    // 清单第 2 行（乙轨道）回指数据第 3 行；聚焦/预览/详情都以 trajIndex
    // 与画布拾取对齐
    // List row 2 (乙轨道) points back at data row 3; focus/preview/details
    // all align with canvas picking via trajIndex.
    expect(items.map((it) => it.trajIndex)).toEqual([0, 2]);
  });

  it("有 Jacobi 值的轨迹用 colormap 色而非色环色（#435）", () => {
    const items = buildOrbitListItems({
      count: 2,
      labels: ["有值", "无值"],
      jacobi: [3.0, undefined],
      colorCycle: CYCLE,
    });
    expect(items[0].color).not.toBe(CYCLE[0]);
    expect(items[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(items[1].color).toBe(CYCLE[1]);
  });

  it("惯性视图下会合系产物灰显且色样去饱和；inertial_km 与带惯性段的不灰显（#428）", () => {
    const items = buildOrbitListItems({
      count: 3,
      labels: ["会合", "惯性", "转移弧"],
      colorCycle: CYCLE,
      frame: "inertial",
      dataFrames: ["synodic_nd", "inertial_km", "synodic_km"],
      inertialGeometries: [null, null, [[0, 0, 0]]],
    });
    expect(items.map((it) => it.grayed)).toEqual([true, false, false]);
    expect(items[0].color).not.toBe(CYCLE[0]);
    expect(items[1].color).toBe(CYCLE[1]);
    expect(items[2].color).toBe(CYCLE[2]);
  });

  it("会合视图下无灰显", () => {
    const items = buildOrbitListItems({
      count: 1,
      labels: ["甲"],
      colorCycle: CYCLE,
      frame: "synodic",
      dataFrames: ["synodic_nd"],
    });
    expect(items[0].grayed).toBe(false);
  });
});

describe("CanvasOrbitList（#469）", () => {
  const items = buildOrbitListItems({
    count: 2,
    labels: ["甲轨道", "乙轨道"],
    frameLabels: ["会合系无量纲", undefined],
    colorCycle: CYCLE,
  });

  it("逐行渲染名称、色样与数据系标注", () => {
    render(
      <CanvasOrbitList items={items} focusIndex={null} onFocusChange={() => {}} onPreviewChange={() => {}} />,
    );
    expect(screen.getByText("甲轨道")).toBeTruthy();
    expect(screen.getByText("乙轨道")).toBeTruthy();
    expect(screen.getByText("会合系无量纲")).toBeTruthy();
    const swatches = document.querySelectorAll("[data-testid='orbit-swatch']");
    expect(swatches).toHaveLength(2);
  });

  it("空清单不渲染", () => {
    const { container } = render(
      <CanvasOrbitList items={[]} focusIndex={null} onFocusChange={() => {}} onPreviewChange={() => {}} />,
    );
    expect(container.querySelector("[data-testid='canvas-orbit-list']")).toBeNull();
  });

  it("悬停触发预览回调（进入/离开），点击切换聚焦（#460 同口径）", () => {
    const onFocus = vi.fn();
    const onPreview = vi.fn();
    render(<CanvasOrbitList items={items} focusIndex={null} onFocusChange={onFocus} onPreviewChange={onPreview} />);
    const row = screen.getByText("甲轨道").closest("[data-orbit-item]") as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(onPreview).toHaveBeenCalledWith(0);
    fireEvent.mouseLeave(row);
    expect(onPreview).toHaveBeenCalledWith(null);
    fireEvent.click(row);
    expect(onFocus).toHaveBeenCalledWith(0);
  });

  it("交互回调携带 trajIndex 而非清单行序（#476）：含无标签行时间隙", () => {
    const gapItems = buildOrbitListItems({
      count: 3,
      labels: ["甲轨道", "", "乙轨道"],
      colorCycle: CYCLE,
    });
    const onFocus = vi.fn();
    const onPreview = vi.fn();
    render(<CanvasOrbitList items={gapItems} focusIndex={null} onFocusChange={onFocus} onPreviewChange={onPreview} />);
    const row = screen.getByText("乙轨道").closest("[data-orbit-item]") as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(onPreview).toHaveBeenCalledWith(2);
    fireEvent.click(row);
    expect(onFocus).toHaveBeenCalledWith(2);
  });

  it("聚焦项色样带描边标记；点击聚焦项解除聚焦", () => {
    const onFocus = vi.fn();
    render(<CanvasOrbitList items={items} focusIndex={1} onFocusChange={onFocus} onPreviewChange={() => {}} />);
    const rows = document.querySelectorAll("[data-orbit-item]");
    expect(rows[1].getAttribute("data-focused")).toBe("true");
    expect(rows[0].getAttribute("data-focused")).toBe("false");
    fireEvent.click(rows[1] as HTMLElement);
    expect(onFocus).toHaveBeenCalledWith(null);
  });

  it("灰显项附不可画注记（惯性视图，#428）", () => {
    const grayedItems = buildOrbitListItems({
      count: 2,
      labels: ["会合", "惯性"],
      colorCycle: CYCLE,
      frame: "inertial",
      dataFrames: ["synodic_nd", "inertial_km"],
      inertialGeometries: [null, null],
    });
    render(
      <CanvasOrbitList
        items={grayedItems}
        focusIndex={null}
        unavailableNote="会合系几何，惯性视图下不可画"
        onFocusChange={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    expect(document.querySelectorAll("[data-testid='orbit-unavailable']")).toHaveLength(1);
  });
});
