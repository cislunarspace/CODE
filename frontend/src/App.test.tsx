// App 布局收缩契约回归（#462 后续：折叠再展开把助手边栏顶出窗口）。
// 复现路径：右栏是 flex:1 的 flex 子项，WebGL 画布被 renderer.setSize 写上
// px 内联宽度；flex 子项默认 min-width:auto，画布宽即成为右栏的 min-content
// 下限。折叠左栏时画布变宽，再展开时右栏窄不下去——整排超出 100vw，助手
// 边栏被推出窗口，且画布容器等不到变窄、ResizeObserver 不再触发，永久卡死。
// 修复：右栏 minWidth:0，把宽度交回 flex 分配，ResizeObserver 随后缩回画布。
// jsdom 没有布局引擎，无法端到端复现溢出；此处钉住样式契约，真实布局行为
// 已用 headless Chrome 的最小复现页验证（未修复 OVERFLOW / 修复后 ok）。
// App layout shrink-contract regression (follow-up of #462: collapse-then-expand
// pushed the assistant sidebar out of the window). The right column is a flex:1
// item and the WebGL canvas carries the px width renderer.setSize wrote onto it;
// a flex item defaults to min-width:auto, so the stale canvas width becomes the
// column's min-content floor. jsdom has no layout engine, so the overflow cannot
// be reproduced end-to-end here — this pins the style contract; the real layout
// behavior was verified with a headless-Chrome minimal repro page.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import App, { transferTimelineEvents } from "./App";
import { etFromEpoch } from "./timeBasis";

// jsdom 无 matchMedia / ResizeObserver，antd 与画布挂载需要
// jsdom lacks matchMedia / ResizeObserver, required by antd and the canvas mount.
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
  // jsdom 无 2D canvas：stub 给天体标注用的 getContext("2d")（同 OrbitCanvas.test）
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ fillText: () => {} }) as unknown as CanvasRenderingContext2D,
  );
});

// Tauri 通道：测试只关心布局结构，命令全部拒绝（调用方均有 catch），
// 事件监听立即返回退订函数。
// Tauri channels: the test only cares about layout structure — every command
// rejects (callers all catch) and event listens resolve to an unsubscribe fn.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.reject(new Error("mock: off-app")),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.reject(new Error("mock: off-app")),
}));

// 后端数据通道返回空集即可
// Backend data channels return empty sets.
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

// jsdom 无 WebGL：只替换 WebGLRenderer，其余 three 保持真实实现
// jsdom has no WebGL: only WebGLRenderer is replaced; the rest of three stays real.
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

describe("App 布局收缩契约（#462 折叠回归）", () => {
  it("画布所在的右栏必须 minWidth: 0，画布 px 宽不得钉住整行布局", () => {
    const { container } = render(<App />);

    // FakeRenderer 的画布挂在 OrbitCanvas 的 mount 里，向上三级即右栏：
    // canvas → mount(width:100%) → 画布盒(flex:1) → 右栏(flex:1 列容器)
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    const column = canvas!.parentElement?.parentElement?.parentElement;
    expect(column).not.toBeNull();
    expect(column!.style.flexDirection).toBe("column");
    // 契约本体：没有它，折叠再展开就会把助手边栏推出窗口
    expect(column!.style.minWidth).toBe("0px");
  });
});

describe("transferTimelineEvents 转移时间轴事件（5.9.7 maneuver_events）", () => {
  // t 直通词典：被测的是 kind → 词典键的映射，不是文案本身
  // t passes keys through: the kind → dictionary-key mapping is under test, not the wording.
  const t = (key: string) => key;
  const TLI = "2026-01-01T00:00:00Z";
  const tliEt = etFromEpoch(TLI);

  it("优先读结构化 maneuver_events：t_sec 以 TLI 为 0，kind 映射到词典键", () => {
    // details 里放矛盾的旧字段：选了 maneuver_events 就不该被读到
    // The details carry contradictory legacy fields: choosing maneuver_events must not read them.
    const events = transferTimelineEvents(
      {
        maneuver_events: [
          { kind: "departure", t_sec: 0, dv_km_s: 3.14 },
          { kind: "arrival", t_sec: 259200, dv_km_s: 0.85 },
        ],
        details: { dv1_km_s: 9.99, dv2_km_s: 9.99, tof_sec: 1 },
      },
      TLI,
      t,
    );
    expect(events).toHaveLength(2);
    expect(events[0].label).toBe("event.departure_pulse");
    expect(events[0].dv).toBe("3.14 km/s");
    expect(events[0].et).toBeCloseTo(tliEt, 6);
    expect(events[1].label).toBe("event.arrival_pulse");
    expect(events[1].et).toBeCloseTo(tliEt + 259200, 6);
  });

  it("perilune 是非脉冲旗标：dv_km_s=0 时不附 Δv 文本", () => {
    const events = transferTimelineEvents(
      {
        maneuver_events: [
          { kind: "departure", t_sec: 0, dv_km_s: 3.1 },
          { kind: "perilune", t_sec: 172800, dv_km_s: 0 },
          { kind: "arrival", t_sec: 259200, dv_km_s: 0.9 },
        ],
      },
      TLI,
      t,
    );
    expect(events.map((e) => e.label)).toEqual([
      "event.departure_pulse",
      "event.perilune_flag",
      "event.arrival_pulse",
    ]);
    expect(events[1].dv).toBeUndefined();
    expect(events[1].et).toBeCloseTo(tliEt + 172800, 6);
  });

  it("开放枚举：其他 kind 用 note 原文，无 note 用 kind", () => {
    const events = transferTimelineEvents(
      {
        maneuver_events: [
          { kind: "tcm", t_sec: 100, dv_km_s: 0.01, note: "中途修正" },
          { kind: "loi", t_sec: 200, dv_km_s: 0.5 },
        ],
      },
      TLI,
      t,
    );
    expect(events[0].label).toBe("中途修正");
    expect(events[1].label).toBe("loi");
  });

  it("maneuver_events 缺失或为空时回退旧 details 字段（HMN dv1/dv2、LGA/WSB dv_departure/dv_arrival）", () => {
    const hmn = transferTimelineEvents(
      { details: { dv1_km_s: 3.1, dv2_km_s: 0.9, tof_sec: 259200 } },
      TLI,
      t,
    );
    expect(hmn.map((e) => e.label)).toEqual(["event.departure_pulse", "event.arrival_pulse"]);
    expect(hmn[1].et).toBeCloseTo(tliEt + 259200, 6);
    expect(hmn[1].dv).toBe("0.90 km/s");

    const lga = transferTimelineEvents(
      { maneuver_events: [], details: { dv_departure_km_s: 3.1, dv_arrival_km_s: 0.9, tof_sec: 86400 } },
      TLI,
      t,
    );
    expect(lga.map((e) => e.dv)).toEqual(["3.10 km/s", "0.90 km/s"]);
  });

  it("TLI 历元缺失或不可解析时不给事件（时刻基准是 et 绝对钟）", () => {
    const events = [{ kind: "departure", t_sec: 0, dv_km_s: 3.1 }];
    expect(transferTimelineEvents({ maneuver_events: events }, undefined, t)).toEqual([]);
    expect(transferTimelineEvents({ maneuver_events: events }, "not-a-date", t)).toEqual([]);
  });
});
