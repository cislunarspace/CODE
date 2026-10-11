// 绘制内容切换（eph-fig）在两条入库记录路径上的行为回归：
// 1. 单击选中（handleSelectArtifact）：结果层带 roles，切"星历"只留星历段；
// 2. 勾选 ≥2 条点"绘制所选"（handlePlotSelected）：装配结果层时必须逐层
//    携带 roles（以及 jacobi/inertialGeometries）——曾整体丢失，导致
//    filterByRole 把双段产物当"无段语义"任何模式全保留，点击"全部/星历"
//    画布毫无变化（用户报告 2026-09-01）。
// Content-switch (eph-fig) regression over the two record paths: single-click
// select (roles ride along) and multi-check "Plot Selected" (assembly must
// carry roles per layer — it used to drop them wholesale, making every
// content mode draw the same thing).
//
// jsdom 无 WebGL：只替换 WebGLRenderer，其余 three 保持真实实现；图例是
// 用户可见断言面——双段记录每段一个图例项，切"星历"后只剩星历段项。
// 项目树数据源是 CatalogFilterBar 挂载即发的 catalog_query（不是
// listArtifacts），mock 打在 catalogApi 上。

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";

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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ fillText: () => {} }) as unknown as CanvasRenderingContext2D,
  );
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.reject(new Error("mock: off-app")),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.reject(new Error("mock: off-app")),
}));
vi.mock("./updater", () => ({
  checkForAppUpdates: () => Promise.resolve(null),
  checkManualAppUpdate: () => Promise.resolve(null),
  getBundleType: () => Promise.resolve("unknown"),
  inAppUpdateSupported: () => true,
}));
vi.mock("./scenarioApi", () => ({
  saveScenarioFile: () => Promise.resolve(""),
  openScenarioFile: () => Promise.resolve(null),
}));

const treeRecords = [
  {
    record_id: "rid-a",
    orbit_family: "DRO",
    member_count: 1,
    has_ephemeris: true,
    source_tool: "design_orbit",
    tags: [],
    note: "",
  },
  {
    record_id: "rid-b",
    orbit_family: "HALO",
    member_count: 1,
    has_ephemeris: true,
    source_tool: "design_orbit",
    tags: [],
    note: "",
  },
];

vi.mock("./catalogApi", () => ({
  catalogQuery: () => Promise.resolve({ records: treeRecords, message: "mock" }),
  catalogTag: () => Promise.resolve(true),
  STAR_TAG: "★",
}));
vi.mock("./projectApi", () => ({
  // 与 catalogQuery mock 的 publish 输出同形同值：App 挂载时两个数据源都会
  // setArtifacts，任一后到都不改变树的最终内容。
  // Same shape/values as the catalogQuery mock's publish output: both sources
  // setArtifacts on mount, so the tree ends up identical either way.
  listArtifacts: () =>
    Promise.resolve([
      { artifactId: "rid-a", artifactType: "orbit", label: "DRO (1 成员)", recordId: "rid-a" },
      { artifactId: "rid-b", artifactType: "orbit", label: "HALO (1 成员)", recordId: "rid-b" },
    ]),
  removeArtifact: () => Promise.resolve(),
  registerArtifact: () => Promise.resolve(),
}));
vi.mock("./sidecarApi", () => ({
  runTool: () => Promise.reject(new Error("mock: off-app")),
  getArtifact: (rid: string) => Promise.resolve(dualSegmentArtifact(rid)),
  ephemerisStatus: () =>
    Promise.resolve({
      kernelDir: null,
      files: [],
      ephemerisReady: true,
      leapsecondReady: true,
      usable: true,
    }),
  formatToolError: (e: unknown) => String(e),
  // sidecar 进度订阅：测试无事件通道，返回空退订函数
  onSidecarProgress: () => Promise.resolve(() => {}),
}));

// 双段记录：CR3BP 基段（(2,6) 状态行，免 period 传播）+ 星历段（3 行 UTC 分量
// 与会合系位置）。形状与 Rust get_artifact 的真实输出一致。
// Dual-segment record: a CR3BP base ((2,6) state rows — no period propagation
// needed) plus an ephemeris segment (3 rows of UTC components and synodic
// positions). Shapes match Rust get_artifact's real output.
const dualSegmentArtifact = (recordId: string) => ({
  recordId,
  orbitFamily: "DRO",
  memberCount: 1,
  mu: 0.012150585609624,
  familyMembers: [
    {
      states: [
        0.87, 0, 0.05, 0, 0.1, 0,
        0.88, 0.01, 0.05, 0, 0.1, 0,
      ],
      times: [],
      period: null,
      jacobi: null,
    },
  ],
  members: [
    [0.87, 0, 0.05],
    [0.88, 0.01, 0.05],
  ],
  jacobi: null,
  ephemeris: {
    synodic_position: [0.83, 0.009, -0.06, 0.84, 0.01, -0.05, 0.85, 0.012, -0.04],
    position_km: null,
    year: [2024, 2024, 2024],
    month: [1, 1, 1],
    day: [1, 1, 1],
    hour: [0, 1, 2],
    minute: [0, 0, 0],
    second: [0, 0, 0],
  },
  transfer: null,
  error: null,
});

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    domElement: HTMLCanvasElement;
    constructor() {
      this.domElement = document.createElement("canvas");
    }
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

/** 轨道清单内的可见条目（无标签轨迹不进清单，条目文本即标签；#469 起清单位于左侧边栏） */
/** Visible orbit-list items (unlabeled trajectories stay out; item text is the
 *  label; the list lives in the left sidebar since #469). */
const legendItemTexts = (): string[] => {
  const container = screen.queryByTestId("canvas-orbit-list");
  if (!container) return [];
  return Array.from(container.querySelectorAll("[data-orbit-item]")).map(
    (el) => el.textContent ?? "",
  );
};

/** 勾选项目树里指定标签的叶子（antd Tree 行内 checkbox） */
/** Check a tree leaf by its label (the checkbox inside the antd Tree row). */
const checkTreeLeaf = (label: string) => {
  const row = screen
    .getAllByText(label)
    .map((el) => el.closest(".ant-tree-treenode"))
    .find((n) => n !== null);
  expect(row, `树节点 ${label} 应存在`).not.toBeNull();
  const box = row!.querySelector(".ant-tree-checkbox");
  expect(box, `树节点 ${label} 应带勾选框`).not.toBeNull();
  fireEvent.click(box!);
};

const clickToolbarMode = (value: "all" | "ephemeris") => {
  // 图例/详情面板也有"星历"字样，用工具栏 Radio 的 input value 精确定位
  // The legend/detail panel also say 星历; pin the toolbar radio by input value.
  const input = document.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`,
  );
  expect(input, `工具栏 Radio ${value} 应存在`).not.toBeNull();
  fireEvent.click(input!.closest("label") ?? input!);
};

// 布局外壳（ADR 0034）：项目树常驻左侧边栏，工具条与画布轨道清单在三维视图标签，
// 该标签默认激活——去轨道库不再需要导航动作，回三维视图就是激活该标签
// Shell (ADR 0034): the project tree is always in the sidebar and the toolbar plus
// the canvas orbit list live in the 3D view tab, active by default — reaching the
// catalog needs no navigation and returning is activating the tab.
const gotoCatalog = () => {
  expect(screen.getByTestId("app-sider")).toBeTruthy();
};
const gotoWorkspace = () => fireEvent.click(screen.getByTestId("doc-tab-view3d"));

describe("绘制内容切换（eph-fig）按入库记录路径", () => {
  it("单击选中：切星历只留星历段图例项", async () => {
    render(<App />);
    // 分组头格式（#468）：文字 + 计数徽标；受控展开初始全展开，异步 treeData
    // 到达即处于展开态，无需手动展开
    // Group-header format (#468): text + count badge; controlled expansion
    // starts fully expanded, so async treeData arrives expanded — no manual expand.
    gotoCatalog();
    await waitFor(() => expect(screen.getByText("轨道")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("DRO (1 成员)")).toBeTruthy());
    fireEvent.click(screen.getByText("DRO (1 成员)"));
    gotoWorkspace();
    // 双段记录：CR3BP 参考轨道 ×1 + 星历段 ×1（(2,6) 状态平铺是一个成员
    // 一条曲线的 2 个点，不是 2 条轨迹）
    await waitFor(() => expect(legendItemTexts().length).toBe(2));
    clickToolbarMode("ephemeris");
    await waitFor(() => {
      const items = legendItemTexts();
      expect(items.length).toBe(1);
      expect(items[0]).toContain("星历段");
    });
  });

  it("绘制所选：切星历只留各记录星历段图例项（roles 装配不丢）", async () => {
    render(<App />);
    gotoCatalog();
    await waitFor(() => expect(screen.getByText("轨道")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("DRO (1 成员)")).toBeTruthy());
    checkTreeLeaf("DRO (1 成员)");
    checkTreeLeaf("HALO (1 成员)");
    fireEvent.click(screen.getByText(/绘制所选/));
    gotoWorkspace();
    // 每记录 2 条（CR3BP + 星历段）×2 记录 = 4
    await waitFor(() => expect(legendItemTexts().length).toBe(4));
    clickToolbarMode("ephemeris");
    await waitFor(() => {
      const items = legendItemTexts();
      expect(items.length).toBe(2);
      expect(items.every((s) => s.includes("星历段"))).toBe(true);
    });
  });
});
