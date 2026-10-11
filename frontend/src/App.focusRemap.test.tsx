// 内容切换聚焦迁移（#479）组件级回归：切换「绘制内容」（全部/CR3BP/星历）
// 时，聚焦行按身份（层对象 + 层内行号）决定去向——仍在画布上则迁移到新
// 行号（详情连续显示同一条轨迹），被过滤裁掉则明确清除且中栏停在轨道
// 信息页签。规格：#476 决议「取消聚焦页签不弹回」在内容切换场景的补全。
// 只测外部行为（详情显示什么/聚焦标记在哪/页签停在哪），不测内部映射。
// Content-switch focus migration (#479), component-level: switching the
// content mode (all/CR3BP/ephemeris) sends the focused row by identity
// (layer object + in-layer row number) — still on canvas → migrate to the new
// row number (details keep showing the same trajectory); filtered out →
// explicit clear with the mid pane staying on the orbit-info tab. Spec:
// the #476 "unfocus never snaps the tab back" rule extended to content
// switches. External behavior only (what the details show / where the focus
// marker is / which tab), never the internal mapping.

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

// 两记录：rid-a 双段产物（CR3BP 参考段 + 星历段）；rid-b 转移记录（单条
// 无段语义轨迹，任何内容模式都保留）——分别喂「过滤裁掉」「迁移」
// 「无段语义存活」三条路径。
// Two records: rid-a is dual-segment (CR3BP reference + ephemeris); rid-b is
// a transfer record (one untagged trajectory surviving every mode) — feeding
// the "filtered out", "migrate", and "untagged survival" paths respectively.
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
    orbit_family: "LGA",
    member_count: 1,
    has_ephemeris: false,
    source_tool: "transfer_lga",
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
  listArtifacts: () =>
    Promise.resolve([
      { artifactId: "rid-a", artifactType: "orbit", label: "DRO (1 成员)", recordId: "rid-a" },
      { artifactId: "rid-b", artifactType: "orbit", label: "LGA 转移", recordId: "rid-b" },
    ]),
  removeArtifact: () => Promise.resolve(),
  registerArtifact: () => Promise.resolve(),
}));
vi.mock("./sidecarApi", () => ({
  runTool: () => Promise.reject(new Error("mock: off-app")),
  getArtifact: (rid: string) => Promise.resolve(rid === "rid-a" ? dualArtifact() : transferArtifact()),
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

// 双段产物（同 App.orbitInfo.test）：CR3BP 基段（2 点）+ 星历段（3 点）
// Dual-segment product (same as App.orbitInfo.test): a CR3BP base (2 points)
// plus an ephemeris segment (3 points).
const dualArtifact = () => ({
  recordId: "rid-a",
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
      jacobi: 3.047,
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

// 转移记录：单条无段语义轨迹（roles 缺省），任何内容模式都保留
// A transfer record: one untagged trajectory (no roles) surviving every mode.
const transferArtifact = () => ({
  recordId: "rid-b",
  orbitFamily: "LGA",
  memberCount: 1,
  mu: 0.012150585609624,
  familyMembers: [],
  members: [],
  jacobi: null,
  ephemeris: null,
  transfer: {
    states: [
      [7000, 0, 0, 0, 10, 0],
      [8000, 100, 0, 0, 9, 0],
      [9000, 300, 0, 0, 8, 0],
    ],
    times: [0, 3600, 7200],
    gcrsStates: null,
    tliEpoch: null,
  },
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

const orbitRow = (label: string): HTMLElement => {
  const container = screen.getByTestId("canvas-orbit-list");
  const row = Array.from(container.querySelectorAll("[data-orbit-item]")).find(
    (el) => (el.textContent ?? "").includes(label),
  );
  expect(row, `清单行 ${label} 应存在`).toBeTruthy();
  return row as HTMLElement;
};

const checkTreeLeaf = (label: string) => {
  const row = screen
    .getAllByText(label)
    .map((el) => el.closest(".ant-tree-treenode"))
    .find((n) => n !== null);
  expect(row, `树节点 ${label} 应存在`).not.toBeNull();
  fireEvent.click(row!.querySelector(".ant-tree-checkbox")!);
};

const clickToolbarMode = (value: "all" | "cr3bp" | "ephemeris") => {
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

describe("内容切换聚焦迁移（#479）", () => {
  it("故事 1/4：聚焦段被内容过滤裁掉 → 明确清除，中栏停在轨道信息页签", async () => {
    render(<App />);
    gotoCatalog();
    await waitFor(() => expect(screen.getByText("DRO (1 成员)")).toBeTruthy());
    fireEvent.click(screen.getByText("DRO (1 成员)"));
    gotoWorkspace();
    await waitFor(() => orbitRow("CR3BP 参考轨道"));
    fireEvent.click(orbitRow("CR3BP 参考轨道"));
    await waitFor(() =>
      expect(screen.getByTestId("orbit-info-panel").textContent).toContain("CR3BP 参考轨道"),
    );
    // 切到星历：CR3BP 段被裁掉 → 聚焦清除（详情空态指引，无聚焦行），
    // 页签不弹回设计工具（面板仍在 = 仍处轨道信息页）
    clickToolbarMode("ephemeris");
    await waitFor(() => {
      const panel = screen.getByTestId("orbit-info-panel");
      expect(panel.textContent).toContain("画布轨道"); // 空态指引文案
      expect(panel.textContent).not.toContain("CR3BP 参考轨道");
    });
    expect(
      document.querySelector('[data-orbit-item][data-focused="true"]'),
    ).toBeNull();
  });

  it("故事 2：聚焦段在新模式下仍存活 → 聚焦迁移到新行号，详情连续", async () => {
    render(<App />);
    gotoCatalog();
    await waitFor(() => expect(screen.getByText("DRO (1 成员)")).toBeTruthy());
    fireEvent.click(screen.getByText("DRO (1 成员)"));
    gotoWorkspace();
    await waitFor(() => orbitRow("星历段"));
    fireEvent.click(orbitRow("星历段"));
    await waitFor(() =>
      expect(screen.getByTestId("orbit-info-panel").textContent).toContain("星历段"),
    );
    expect(orbitRow("星历段").getAttribute("data-focused")).toBe("true");
    // 切到星历：行集合 [CR3BP, 星历] → [星历]，星历段行号 1 → 0
    clickToolbarMode("ephemeris");
    await waitFor(() => {
      expect(screen.getByTestId("orbit-info-panel").textContent).toContain("星历段");
    });
    const row = orbitRow("星历段");
    expect(row.getAttribute("data-focused")).toBe("true");
  });

  it("故事 3：无段语义轨迹（转移弧）任何模式都保留 → 聚焦随行号偏移迁移", async () => {
    render(<App />);
    gotoCatalog();
    await waitFor(() => expect(screen.getByText("DRO (1 成员)")).toBeTruthy());
    checkTreeLeaf("DRO (1 成员)");
    checkTreeLeaf("LGA 转移");
    fireEvent.click(screen.getByText(/绘制所选/));
    gotoWorkspace();
    // 结果层单层拼接：[DRO·CR3BP, DRO·星历段, LGA·转移弧]
    await waitFor(() => orbitRow("转移弧"));
    fireEvent.click(orbitRow("转移弧"));
    await waitFor(() =>
      expect(screen.getByTestId("orbit-info-panel").textContent).toContain("转移弧"),
    );
    // 切到星历：行集合 [CR3BP, 星历段, 转移弧] → [星历段, 转移弧]，
    // 无段语义的转移弧行号 2 → 1，聚焦与详情跟过去
    clickToolbarMode("ephemeris");
    await waitFor(() => orbitRow("转移弧"));
    const row = orbitRow("转移弧");
    expect(row.getAttribute("data-focused")).toBe("true");
    expect(screen.getByTestId("orbit-info-panel").textContent).toContain("转移弧");
  });

  it("故事 6：取消聚焦后切换内容 → 不产生聚焦复活", async () => {
    render(<App />);
    gotoCatalog();
    await waitFor(() => expect(screen.getByText("DRO (1 成员)")).toBeTruthy());
    fireEvent.click(screen.getByText("DRO (1 成员)"));
    gotoWorkspace();
    await waitFor(() => orbitRow("星历段"));
    fireEvent.click(orbitRow("星历段"));
    await waitFor(() =>
      expect(screen.getByTestId("orbit-info-panel").textContent).toContain("星历段"),
    );
    // 取消聚焦（再点一次聚焦行）
    fireEvent.click(orbitRow("星历段"));
    await waitFor(() =>
      expect(screen.getByTestId("orbit-info-panel").textContent).toContain("画布轨道"),
    );
    clickToolbarMode("ephemeris");
    await waitFor(() => orbitRow("星历段"));
    expect(
      document.querySelector('[data-orbit-item][data-focused="true"]'),
    ).toBeNull();
    expect(screen.getByTestId("orbit-info-panel").textContent).toContain("画布轨道");
  });
});
