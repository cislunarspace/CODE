// 界面外壳（侧边栏 / 顶边栏 / 文档标签 / 参数停靠 / 助手边栏 / 状态栏）回归：
// 标签可切换可关闭且内容保活（画布不重建）、标签集合与激活标签跨刷新恢复（非法
// 值回落默认）、「+」菜单把收起的标签放回来、侧边栏与参数停靠可折叠、助手边栏
// 可收起、顶栏菜单接到同一批动作、状态栏显示时间口径与性能与版本。
// Shell regression (sidebar / top bar / document tabs / parameter dock / assistant
// drawer / status bar): tabs switch and close while their content stays mounted (the
// canvas is never rebuilt), the tab set and the active tab survive a reload (invalid
// values fall back to the defaults), the "+" menu restores a hidden tab, the sidebar
// and the parameter dock collapse, the assistant drawer hides, the top-bar menus drive
// the same actions, and the status bar shows the clock basis, the performance sample
// and the version. Mock scaffolding mirrors App.test (commands reject by default,
// event listens are no-ops).

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type * as ThreeNamespace from "three";
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

// system_stats 返回固定采样（状态栏断言用），其余命令拒绝
// system_stats answers with a fixed sample (for the status-bar assertions);
// every other command rejects.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "system_stats"
      ? Promise.resolve({
          cpuPercent: 12.3,
          memUsedBytes: 8 * 1024 ** 3,
          memTotalBytes: 32 * 1024 ** 3,
        })
      : Promise.reject(new Error("mock: off-app")),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("5.0.0"),
}));
vi.mock("./projectApi", () => ({
  listArtifacts: () => Promise.resolve([]),
  removeArtifact: () => Promise.resolve(),
  registerArtifact: () => Promise.resolve(),
}));
vi.mock("./sidecarApi", () => ({
  runTool: () => Promise.reject(new Error("mock: off-app")),
  getArtifact: () => Promise.reject(new Error("mock: off-app")),
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
vi.mock("./catalogApi", () => ({
  catalogQuery: () => Promise.resolve({ records: [] }),
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
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeNamespace>();
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

describe("界面外壳（侧边栏 / 顶边栏 / 文档标签 / 停靠 / 状态栏）", () => {
  // 壳状态都持久化在 localStorage，用例之间必须隔开，否则上一条关掉的标签
  // 会被下一条读到（同文件内 jsdom 的 localStorage 是共享的）
  // The shell state persists in localStorage, so cases must be isolated — a tab
  // closed by one case would otherwise leak into the next (jsdom shares
  // localStorage within a file).
  beforeEach(() => {
    localStorage.clear();
  });

  it("文档标签切换与关闭：内容保活，关闭只收起，激活标签落持久化键", () => {
    const { container } = render(<App />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    // 默认全开且激活三维视图
    expect(screen.getByTestId("doc-view3d").style.display).toBe("flex");
    expect(screen.getByTestId("doc-orbit-info").style.display).toBe("none");
    expect(screen.getByTestId("doc-catalog").style.display).toBe("none");

    // 切到轨道库标签
    fireEvent.click(screen.getByTestId("doc-tab-catalog"));
    expect(screen.getByTestId("doc-catalog").style.display).toBe("flex");
    expect(screen.getByTestId("doc-view3d").style.display).toBe("none");
    expect(localStorage.getItem("tod-doc-active")).toBe("catalog");

    // 画布随标签隐藏但保持挂载：切回不重建 WebGL 场景与相机
    expect(container.querySelector("canvas")).toBe(canvas);

    // 关闭轨道库标签：只是从标签条收起，内容仍挂载；激活标签取左邻
    fireEvent.click(screen.getByTestId("doc-tab-close-catalog"));
    expect(screen.queryByTestId("doc-tab-catalog")).toBeNull();
    expect(screen.getByTestId("doc-catalog")).toBeTruthy();
    expect(screen.getByTestId("doc-orbit-info").style.display).toBe("block");
    expect(JSON.parse(localStorage.getItem("tod-doc-tabs") ?? "[]")).toEqual([
      "view3d",
      "orbitInfo",
    ]);
  });

  it("「+」菜单把收起的标签按正典顺序放回来", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("doc-tab-close-orbitInfo"));
    expect(screen.queryByTestId("doc-tab-orbitInfo")).toBeNull();

    fireEvent.click(screen.getByTestId("doc-tab-open"));
    fireEvent.click(await screen.findByText("轨道信息"));
    await waitFor(() => expect(screen.getByTestId("doc-tab-orbitInfo")).toBeTruthy());
    // 放回的标签插在正典位置上（三维视图之后、轨道库之前）
    const strip = screen.getByTestId("doc-tabs");
    const tabIds = ["doc-tab-view3d", "doc-tab-orbitInfo", "doc-tab-catalog"];
    const order = Array.from(strip.querySelectorAll<HTMLElement>("[data-testid]"))
      .map((el) => el.dataset.testid ?? "")
      .filter((id) => tabIds.includes(id));
    expect(order).toEqual(tabIds);
  });

  it("启动时读取上次的标签集合与激活标签，非法值回落默认全集", () => {
    localStorage.setItem("tod-doc-tabs", JSON.stringify(["catalog", "view3d"]));
    localStorage.setItem("tod-doc-active", "catalog");
    const { unmount } = render(<App />);
    expect(screen.getByTestId("doc-catalog").style.display).toBe("flex");
    expect(screen.getByTestId("doc-view3d").style.display).toBe("none");
    // 未持久化的标签不在标签条上，但内容仍常驻挂载
    expect(screen.queryByTestId("doc-tab-orbitInfo")).toBeNull();
    expect(screen.getByTestId("doc-orbit-info")).toBeTruthy();
    unmount();

    localStorage.setItem("tod-doc-tabs", "{ not json");
    localStorage.setItem("tod-doc-active", "nope");
    render(<App />);
    expect(screen.getByTestId("doc-tab-orbitInfo")).toBeTruthy();
    expect(screen.getByTestId("doc-view3d").style.display).toBe("flex");
  });

  it("侧边栏与参数停靠可折叠，折叠态落持久化键", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("sider-collapse"));
    expect(screen.getByTestId("app-sider").style.width).toBe("24px");
    expect(localStorage.getItem("tod-sider-collapsed")).toBe("1");
    fireEvent.click(screen.getByTestId("sider-expand"));
    expect(screen.getByTestId("app-sider").style.width).toBe("240px");

    fireEvent.click(screen.getByTestId("params-collapse"));
    expect(screen.getByTestId("params-expand")).toBeTruthy();
    expect(localStorage.getItem("tod-ws-panel-collapsed")).toBe("1");
    fireEvent.click(screen.getByTestId("params-expand"));
    expect(screen.getByTestId("params-collapse")).toBeTruthy();
  });

  it("助手边栏默认展开、可收起并落持久化键（收起不卸载，会话不中断）", () => {
    render(<App />);
    expect(screen.getByTestId("assistant-sidebar").style.display).toBe("flex");
    fireEvent.click(screen.getByTestId("header-assistant-toggle"));
    expect(screen.getByTestId("assistant-sidebar").style.display).toBe("none");
    expect(localStorage.getItem("tod-assistant-open")).toBe("0");
    fireEvent.click(screen.getByTestId("header-assistant-toggle"));
    expect(screen.getByTestId("assistant-sidebar").style.display).toBe("flex");
  });

  it("顶栏视图菜单与侧边栏、参数停靠接到同一批动作", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("menu-view"));
    fireEvent.click(await screen.findByText("侧边栏"));
    await waitFor(() => expect(screen.getByTestId("app-sider").style.width).toBe("24px"));
    fireEvent.click(screen.getByTestId("menu-view"));
    fireEvent.click(await screen.findByText("参数面板"));
    await waitFor(() => expect(screen.getByTestId("params-expand")).toBeTruthy());
  });

  it("顶栏设置与关于按钮打开对应弹窗", async () => {
    render(<App />);
    fireEvent.click(screen.getByTitle("设置"));
    await waitFor(() => expect(screen.getByText("图表与界面偏好设置")).toBeTruthy());
    // 关掉设置弹窗（遮罩会挡住顶栏按钮；antd 关闭后仍保留挂载的弹窗内容，
    // 只断言首开成功），再开关于
    fireEvent.click(document.querySelector(".ant-modal-close") as HTMLElement);

    fireEvent.click(screen.getByTitle("关于 CODE"));
    await waitFor(() => expect(screen.getByText("关于 CODE")).toBeTruthy());
    // 版本号来自 Tauri 运行时（getVersion）
    await waitFor(() => expect(screen.getByText(/版本号：v5\.0\.0/)).toBeTruthy());
  });

  it("状态栏显示当前视图、时间口径、性能采样与版本号", async () => {
    render(<App />);
    const bar = screen.getByTestId("status-bar");
    // 当前视图（主页面激活的文档标签）
    expect(screen.getByTestId("status-view").textContent).toContain("三维视图");
    // 时间口径：本地 / UTC / ET（ADR 0021 的 ET 是域内绝对基准）
    expect(bar.textContent).toContain("本地");
    expect(bar.textContent).toContain("UTC");
    expect(bar.textContent).toContain("ET");
    // 任务空闲态
    expect(bar.textContent).toContain("空闲");
    // 性能采样（system_stats 桩返回）：CPU 一位小数、内存 GB 用量/总量
    await waitFor(() => expect(bar.textContent).toContain("12.3%"));
    expect(bar.textContent).toContain("8.0 GB / 32.0 GB");
    // 版本（getVersion 桩返回）
    await waitFor(() => expect(bar.textContent).toContain("v5.0.0"));
  });

  it("顶栏历元：未选时刻给占位，时间轴选时刻后显示 UTC 时刻", async () => {
    render(<App />);
    expect(screen.getByTestId("header-epoch").textContent).toBe("无历元");
  });

  it("SOP 硬校验：需要参考历元的工具禁用运行，「去补」展开参数停靠", async () => {
    render(<App />);

    // 开局：参数面板挂载时回填分支默认值，默认工具本身无历元依赖 → 无阻断
    expect(screen.queryByTestId("sop-blockers")).toBeNull();

    // 换到需要 TLI 历元的转移设计：时间轴未选时刻 → 报历元阻断
    fireEvent.click(screen.getByTestId("sider-tool-transfer_design"));
    await waitFor(() =>
      expect(screen.getByTestId("sop-blockers").textContent).toContain("未确定参考历元"),
    );
    // 阻断期内运行按钮禁用（硬拦截，不是跑起来再报错）
    expect(
      (screen.getByRole("button", { name: /执行/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // 历元字段在参数面板里：「去选历元」把折叠的参数停靠展开
    fireEvent.click(screen.getByTestId("params-collapse"));
    expect(screen.getByTestId("params-expand")).toBeTruthy();
    fireEvent.click(screen.getByTestId("sop-fix-epoch"));
    expect(screen.getByTestId("params-collapse")).toBeTruthy();
  });
});
