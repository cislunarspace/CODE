import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CanvasToolbar } from "./CanvasToolbar";

const baseProps = {
  projection: "3d" as const,
  center: "barycenter" as const,
  frame: undefined as "synodic" | "inertial" | undefined,
  contentMode: undefined as "all" | "cr3bp" | "ephemeris" | undefined,
  recording: false,
  onProjectionChange: vi.fn(),
  onCenterChange: vi.fn(),
  onFrameChange: vi.fn(),
  onContentModeChange: vi.fn(),
  onFitView: vi.fn(),
  onExportAnimation: vi.fn(),
  onExportPng: vi.fn(),
  onOpenSettings: vi.fn(),
};

function setup(overrides: Partial<typeof baseProps> = {}) {
  const props = { ...baseProps, ...overrides };
  render(<CanvasToolbar {...props} />);
  return props;
}

describe("CanvasToolbar component", () => {
  it("渲染全部投影与中心选项及操作按钮", () => {
    setup();
    for (const name of ["3D", "XY", "XZ", "YZ"]) {
      expect(screen.getByRole("radio", { name })).toBeDefined();
    }
    for (const name of ["质心", "地心", "月心", "L1", "L2"]) {
      expect(screen.getByRole("radio", { name })).toBeDefined();
    }
    expect(screen.getByRole("button", { name: /适配/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /导出动画/ })).toBeDefined();
  });

  it("切换投影与中心触发对应回调", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("radio", { name: "XY" }));
    expect(props.onProjectionChange).toHaveBeenCalledWith("xy");
    fireEvent.click(screen.getByRole("radio", { name: "月心" }));
    expect(props.onCenterChange).toHaveBeenCalledWith("moon");
  });

  it("点击适配/导出动画/设置触发对应回调", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /适配/ }));
    expect(props.onFitView).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /导出动画/ }));
    expect(props.onExportAnimation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle("图表显示设置"));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("叠加模式开关已由双层模型移除（不再渲染 switch）", () => {
    setup();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("录制中导出按钮呈 loading", () => {
    setup({ recording: true });
    const btn = screen.getByRole("button", { name: /导出动画/ });
    expect(btn.className).toContain("ant-btn-loading");
  });
});

// —— 分组分隔与 PNG 导出（#450）——
// Group separators and PNG export (#450).

describe("CanvasToolbar 分组与 PNG 导出（#450）", () => {

  it("投影/视图系/绘制内容/中心四组之间有 3 个竖向分隔符", () => {
    const { container } = render(<CanvasToolbar {...baseProps} />);
    const seps = container.querySelectorAll(".ant-divider-vertical");
    expect(seps.length).toBe(3);
  });

  it("PNG 导出按钮触发 onExportPng 回调", () => {
    const props = setup({ onExportPng: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /导出图片/ }));
    expect(props.onExportPng).toHaveBeenCalledTimes(1);
  });

  it("未传 onExportPng 时不渲染 PNG 按钮（可选能力）", () => {
    const { onExportPng: _omit, ...rest } = baseProps;
    render(<CanvasToolbar {...rest} />);
    expect(screen.queryByRole("button", { name: /导出图片/ })).toBeNull();
    cleanup();
  });

});

// —— 绘制内容切换（eph-fig）——
// The content switch (eph-fig).

describe("CanvasToolbar 绘制内容切换", () => {
  it("默认渲染全部/CR3BP/星历选项，缺省选中全部", () => {
    setup();
    expect((screen.getByRole("radio", { name: "全部" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "CR3BP" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "星历" }) as HTMLInputElement).checked).toBe(false);
  });

  it("切换绘制内容触发 onContentModeChange", () => {
    const props = setup({ onContentModeChange: vi.fn() });
    fireEvent.click(screen.getByRole("radio", { name: "星历" }));
    expect(props.onContentModeChange).toHaveBeenCalledWith("ephemeris");
    fireEvent.click(screen.getByRole("radio", { name: "CR3BP" }));
    expect(props.onContentModeChange).toHaveBeenCalledWith("cr3bp");
  });

  it("contentMode 受控选中", () => {
    setup({ contentMode: "ephemeris" });
    expect((screen.getByRole("radio", { name: "星历" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "全部" }) as HTMLInputElement).checked).toBe(false);
  });
});

// —— 视图系切换（#428）——
// The view-frame switch (#428).

describe("CanvasToolbar 视图系切换", () => {
  it("默认渲染会合系/惯性选项，缺省选中会合系", () => {
    setup();
    expect(screen.getByRole("radio", { name: "会合系" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "惯性 (GCRS)" })).toBeDefined();
    expect((screen.getByRole("radio", { name: "会合系" }) as HTMLInputElement).checked).toBe(true);
  });

  it("切换视图系触发 onFrameChange", () => {
    const props = setup({ onFrameChange: vi.fn() });
    fireEvent.click(screen.getByRole("radio", { name: "惯性 (GCRS)" }));
    expect(props.onFrameChange).toHaveBeenCalledWith("inertial");
  });

  it("惯性视图下月心/L1/L2 居中禁用，会合视图全部可用", () => {
    setup({ frame: "inertial" });
    for (const name of ["月心", "L1", "L2"]) {
      expect((screen.getByRole("radio", { name }) as HTMLInputElement).disabled).toBe(true);
    }
    for (const name of ["质心", "地心"]) {
      expect((screen.getByRole("radio", { name }) as HTMLInputElement).disabled).toBe(false);
    }

    cleanup();
    setup({ frame: "synodic" });
    for (const name of ["质心", "地心", "月心", "L1", "L2"]) {
      expect((screen.getByRole("radio", { name }) as HTMLInputElement).disabled).toBe(false);
    }
  });
});
