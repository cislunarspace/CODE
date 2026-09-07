// OrbitInfoPanel / buildOrbitInfo 测试（#476）：详情装配（类型/数据系/
// Jacobi/点数/时间跨度/来源）与面板渲染（含空态指引）。字段值在
// buildOrbitInfo 完成本地化与格式化，面板只渲染——测试分两层对应。
// Tests for OrbitInfoPanel / buildOrbitInfo (#476): details assembly
// (type/frame/Jacobi/points/span/source) and panel rendering (including the
// empty-state guidance). Field values are localized and formatted inside
// buildOrbitInfo — the panel only renders — so the tests mirror that split.

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { OrbitInfoPanel } from "./OrbitInfoPanel";
import { buildOrbitInfo, formatTimeSpan } from "./orbitListItems";
import { translations } from "./i18n";

// antd Descriptions 的 useBreakpoint 依赖 matchMedia（jsdom 无实现）
// antd Descriptions' useBreakpoint needs matchMedia (absent in jsdom).
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
});

const t = (key: string) => translations[key] ?? key;

describe("buildOrbitInfo", () => {
  it("族成员段：类型/数据系/Jacobi/点数/跨度/来源齐全", () => {
    const info = buildOrbitInfo({
      item: { label: "DRO 成员", frame: "会合系无量纲" },
      data: { points: 800, times: [0, 100000, 200000], jacobi: 3.047, role: "cr3bp" },
      source: { layer: "pinned", id: "rid-a", label: "DRO (1 成员)" },
      t,
    });
    expect(info).toEqual({
      label: "DRO 成员",
      kind: "CR3BP 参考轨道",
      frame: "会合系无量纲",
      jacobi: 3.047,
      points: 800,
      timeSpan: formatTimeSpan(200000),
      source: "固定层·库记录 rid-a",
    });
  });

  it("无段语义/无 Jacobi/无时刻：对应字段缺省", () => {
    const info = buildOrbitInfo({
      item: { label: "转移弧" },
      data: { points: 50, times: [] },
      source: { layer: "result", id: "", label: "" },
      t,
    });
    expect(info.kind).toBeUndefined();
    expect(info.frame).toBeUndefined();
    expect(info.jacobi).toBeUndefined();
    expect(info.timeSpan).toBeUndefined();
    expect(info.source).toBe("本次运行产物");
  });

  it("星历段与候选来源", () => {
    const info = buildOrbitInfo({
      item: { label: "#2" },
      data: { points: 30, times: [0, 3600], role: "ephemeris" },
      source: { layer: "candidate", id: "cand-2", label: "#2" },
      t,
    });
    expect(info.kind).toBe("星历段");
    expect(info.timeSpan).toBe("1.0 h");
    expect(info.source).toBe("转移候选 #2");
  });

  it("formatTimeSpan 分档：秒 / 小时 / 天", () => {
    expect(formatTimeSpan(59)).toBe("59 s");
    expect(formatTimeSpan(7200)).toBe("2.0 h");
    expect(formatTimeSpan(86400 * 2.5)).toBe("2.5 d");
  });
});

describe("OrbitInfoPanel", () => {
  it("空态显示操作指引", () => {
    render(<OrbitInfoPanel info={null} />);
    expect(screen.getByTestId("orbit-info-panel").textContent).toContain(
      translations["orbit_info.empty"],
    );
  });

  it("逐字段渲染：标题为轨道名，无时刻显示占位", () => {
    render(
      <OrbitInfoPanel
        info={{
          label: "DRO 成员",
          kind: "CR3BP 参考轨道",
          frame: "会合系无量纲",
          jacobi: 3.047,
          points: 800,
          source: "固定层·库记录 rid-a",
        }}
      />,
    );
    const panel = screen.getByTestId("orbit-info-panel");
    expect(panel.textContent).toContain("DRO 成员");
    expect(panel.textContent).toContain("CR3BP 参考轨道");
    expect(panel.textContent).toContain("3.047000");
    expect(panel.textContent).toContain("800");
    expect(panel.textContent).toContain("无时刻");
    expect(panel.textContent).toContain("固定层·库记录 rid-a");
  });
});
