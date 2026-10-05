// RecordDetailPanel hooks 规则回归测试（#437）。
//
// 复现：组件曾在全部 hooks 之前对空 record 早返回，首次选中记录时同一
// 组件实例的 hook 数量从 0 变为 6，React 抛
// "Rendered more hooks than during the previous render." 并带崩渲染树。

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordDetailPanel, type TransferCandidateView } from "./RecordDetailPanel";
import type { CatalogRecord } from "./catalogApi";

// jsdom 无 matchMedia / ResizeObserver，antd Descriptions 与 TextArea 需要
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
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

const RECORD_A: CatalogRecord = {
  record_id: "rec-a",
  orbit_family: "HALO",
  libration_point: 2,
  jacobi: 3.15,
  has_cr3bp: true,
  has_ephemeris: true,
  tags: ["候选", "A组"],
  note: "记录A的备注",
};

const RECORD_B: CatalogRecord = {
  record_id: "rec-b",
  orbit_family: "NRHO",
  libration_point: 1,
  jacobi: 3.01,
  family_id: "fam-b01",
  member_index: 2,
  has_cr3bp: true,
  has_ephemeris: false,
  tags: ["B标签"],
  note: "记录B的备注",
};

describe("RecordDetailPanel hooks 规则（#437）", () => {
  it("record 从 null 变为有效记录的 rerender 不抛错", () => {
    const view = render(<RecordDetailPanel record={null} />);
    expect(() => {
      view.rerender(<RecordDetailPanel record={RECORD_A} />);
    }).not.toThrow();
    // 详情内容确实渲染出来（record_id 出现在 copyable 文本中）
    expect(screen.getByText("rec-a")).toBeDefined();
  });

  it("record 为 null 时显示空态提示卡片", () => {
    render(<RecordDetailPanel record={null} />);
    expect(screen.getByText("记录详情")).toBeDefined();
    expect(screen.getByText(/请在上方项目树或轨道库中选中一条记录查看详情/)).toBeDefined();
  });

  it("在两条不同记录间切换时，标签与备注输入框同步为新记录的值", () => {
    const view = render(<RecordDetailPanel record={RECORD_A} />);
    const tagsInput = screen.getByPlaceholderText("标签 (逗号分隔)") as HTMLInputElement;
    const noteInput = screen.getByPlaceholderText("笔记说明...") as HTMLTextAreaElement;
    expect(tagsInput.value).toBe("候选, A组");
    expect(noteInput.value).toBe("记录A的备注");

    view.rerender(<RecordDetailPanel record={RECORD_B} />);
    expect(tagsInput.value).toBe("B标签");
    expect(noteInput.value).toBe("记录B的备注");
  });

  it("选中记录后再切回 null 也不抛错（hook 数量恒定）", () => {
    const view = render(<RecordDetailPanel record={RECORD_A} />);
    expect(() => {
      view.rerender(<RecordDetailPanel record={null} />);
    }).not.toThrow();
    expect(screen.getByText(/请在上方项目树或轨道库中选中一条记录查看详情/)).toBeDefined();
  });
});

describe("RecordDetailPanel 族维度（e2m2e 5.9.3 一轨一记录，#486）", () => {
  it("族成员记录展示族内序号与所属族批次，不再渲染提升区", () => {
    render(<RecordDetailPanel record={RECORD_B} />);
    expect(screen.getByText("#2")).toBeDefined();
    expect(screen.getByText("fam-b01")).toBeDefined();
    // catalog_promote 已随 e2m2e 5.9.3 移除（一轨一记录）：提升入口不复存在
    expect(screen.queryByText(/族成员提升/)).toBeNull();
    expect(screen.queryByRole("button", { name: /提\s*升/ })).toBeNull();
  });

  it("非族记录不渲染族维度行", () => {
    render(<RecordDetailPanel record={RECORD_A} />);
    expect(screen.queryByText("族内序号")).toBeNull();
    expect(screen.queryByText("所属族批次")).toBeNull();
  });
});

describe("RecordDetailPanel 可行解对比段（#430）", () => {
  const CANDIDATES: TransferCandidateView[] = [
    { key: "cand-1", rank: 1, deltaVKmS: 3.95, tliEpochText: "2026-09-01T00:00", tofSecText: "4.5 天", selected: true, refined: true, hasTrajectory: true },
    { key: "cand-2", rank: 2, deltaVKmS: 4.12, tliEpochText: "2026-09-01T06:00", tofSecText: "5.0 天", selected: false, refined: false, hasTrajectory: true },
    { key: "cand-3", rank: 3, deltaVKmS: 4.44, tliEpochText: "—", tofSecText: "—", selected: false, refined: false, hasTrajectory: false },
  ];

  it("并列各候选 Δv/TLI/TOF，标出选中解、refined 口径与无轨迹降级", () => {
    render(<RecordDetailPanel record={null} transferCandidates={CANDIDATES} />);
    expect(screen.getByText(/可行解对比/)).toBeDefined();
    expect(screen.getByText(/3\.950/)).toBeDefined();
    expect(screen.getByText(/4\.120/)).toBeDefined();
    expect(screen.getByText(/2026-09-01T00:00/)).toBeDefined();
    // 选中解标记（金色 Tag）+ 混合口径自述 + 无轨迹注记
    expect(document.querySelector(".ant-tag-gold")?.textContent).toBe("选中");
    expect(screen.getByText(/打靶精化/)).toBeDefined();
    expect(screen.getAllByText(/网格估计/).length).toBe(2);
    expect(screen.getByText(/无轨迹/)).toBeDefined();
  });

  it("未携带候选时不渲染对比段（单解现状，不出现空壳）", () => {
    render(<RecordDetailPanel record={null} />);
    expect(screen.queryByText(/可行解对比/)).toBeNull();
    // 空态提示照旧
    expect(screen.getByText(/请在上方项目树或轨道库中选中一条记录查看详情/)).toBeDefined();
  });
});

describe("RecordDetailPanel 标题联动（#468）", () => {
  it("传入选中行 label 时标题带上它", () => {
    render(<RecordDetailPanel record={RECORD_A} selectedLabel="HALO 家族" />);
    expect(screen.getByText("记录详情 · HALO 家族")).toBeDefined();
  });

  it("未传 label 时保持原标题", () => {
    render(<RecordDetailPanel record={RECORD_A} />);
    expect(screen.getAllByText("记录详情").length).toBeGreaterThan(0);
  });
});
