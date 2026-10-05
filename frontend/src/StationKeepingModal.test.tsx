// 站保弹窗阻断判据回归测试（#416）：判据来自源记录真实星历跨弧
//（catalog_get 推导），跨弧取不到时禁用执行并提示原因；执行路径
//（参数输入 → run_tool 提交 → 成功回调）不变。
// Station-keeping modal gate regression tests (#416): the gate uses the source
// record's real ephemeris span (derived via catalog_get); an unavailable span
// disables the run button with the reason shown. The execution path (param
// inputs → run_tool submit → success callback) is unchanged.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StationKeepingModal } from "./StationKeepingModal";
import { catalogGet, ephemerisSpanDays, type CatalogGetResult } from "./catalogApi";
import { invoke } from "@tauri-apps/api/core";
import type { CatalogRecord } from "./catalogApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./catalogApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalogApi")>();
  return { ...actual, catalogGet: vi.fn() };
});

// jsdom 无 matchMedia / ResizeObserver，antd Modal/InputNumber 需要
// jsdom lacks matchMedia / ResizeObserver, needed by antd Modal/InputNumber.
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

const RECORD: CatalogRecord = { record_id: "rec-1", orbit_family: "NRHO" };

/** 构造带 JD 星历段的 catalog_get 响应（帧序 = null 占位键序，ADR 0035） */
/** Build a catalog_get response with a JD ephemeris segment (frame order =
 *  null-placeholder key order, ADR 0035). */
function resultWithJdSpan(days: number): CatalogGetResult {
  return {
    arrays: { record_id: "rec-1", "eph/times_jd_tdb": null, "eph/synodic_position": null },
    frames: [
      { dtype: "f64", shape: [3], data: [2460000.0, 2460000.0 + days / 2, 2460000.0 + days] },
      { dtype: "f64", shape: [3, 3], data: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    ],
  };
}

function setup() {
  const props = {
    open: true,
    sourceRecord: RECORD,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };
  return { props, view: render(<StationKeepingModal {...props} />) };
}

/** 反馈弧段输入框（第 2 个 InputNumber：间隔、弧段、次数、样本数） */
/** The feedback-arc input (2nd InputNumber: interval, arc, count, samples). */
function feedbackArcInput(): HTMLElement {
  return screen.getAllByRole("spinbutton")[1];
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "开始仿真" }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue({ status: "ok" });
});

describe("ephemerisSpanDays（纯函数，#416）", () => {
  it("优先用 eph/times_jd_tdb 帧取极差（天）", () => {
    expect(ephemerisSpanDays(resultWithJdSpan(30))).toBeCloseTo(30, 9);
  });

  it("无 JD 帧时由 UTC 分量合成（整日跨弧）", () => {
    const res: CatalogGetResult = {
      arrays: {
        "eph/year": null, "eph/month": null, "eph/day": null,
        "eph/hour": null, "eph/minute": null, "eph/second": null,
      },
      frames: [
        { dtype: "f64", shape: [2], data: [2026, 2026] },
        { dtype: "f64", shape: [2], data: [1, 1] },
        { dtype: "f64", shape: [2], data: [1, 31] },
        { dtype: "f64", shape: [2], data: [0, 0] },
        { dtype: "f64", shape: [2], data: [0, 0] },
        { dtype: "f64", shape: [2], data: [0, 0] },
      ],
    };
    expect(ephemerisSpanDays(res)).toBeCloseTo(30, 6);
  });

  it("无星历段或分量不齐返回 null", () => {
    expect(ephemerisSpanDays({ arrays: { "cr3bp/states": null }, frames: [] })).toBeNull();
    const misaligned: CatalogGetResult = {
      arrays: { "eph/year": null, "eph/month": null, "eph/day": null, "eph/hour": null, "eph/minute": null, "eph/second": null },
      frames: [
        { dtype: "f64", shape: [2], data: [2026, 2026] },
        { dtype: "f64", shape: [1], data: [1] }, // month 行数不齐
        { dtype: "f64", shape: [2], data: [1, 31] },
        { dtype: "f64", shape: [2], data: [0, 0] },
        { dtype: "f64", shape: [2], data: [0, 0] },
        { dtype: "f64", shape: [2], data: [0, 0] },
      ],
    };
    expect(ephemerisSpanDays(misaligned)).toBeNull();
  });
});

describe("StationKeepingModal 真实跨弧阻断（#416）", () => {
  it("默认参数（29.625 天）在 30 天跨弧内：可执行；超出后禁用并提示真实跨弧", async () => {
    vi.mocked(catalogGet).mockResolvedValue(resultWithJdSpan(30));
    setup();

    // 跨弧加载完成：无禁用/阻断提示
    await waitFor(() => expect(screen.queryByText("正在读取源记录的星历覆盖范围...")).toBeNull());
    expect(submitButton().disabled).toBe(false);

    // 反馈弧段 0.5 → 所需 (120-2)*0.25+0.5 = 30.00 天，恰等于跨弧 → 放行（边界）
    fireEvent.change(feedbackArcInput(), { target: { value: "0.5" } });
    expect(submitButton().disabled).toBe(false);

    // 反馈弧段 0.625 → 30.125 天 > 30 → 禁用并提示
    fireEvent.change(feedbackArcInput(), { target: { value: "0.625" } });
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText("仿真时长超出源星历覆盖范围")).toBeDefined();
    expect(screen.getByText(/约 30\.13 天.*约 30\.00 天/)).toBeDefined();
  });

  it("源记录无星历段：禁用执行并提示原因", async () => {
    vi.mocked(catalogGet).mockResolvedValue({
      arrays: { record_id: "rec-1", "cr3bp/states": null },
      frames: [{ dtype: "f64", shape: [3, 6], data: new Array(18).fill(0) }],
    });
    setup();

    await waitFor(() => expect(screen.getByText("无法确定源星历覆盖范围，执行已禁用")).toBeDefined());
    expect(screen.getByText(/无星历段/)).toBeDefined();
    expect(submitButton().disabled).toBe(true);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("取数失败：禁用执行并提示原因", async () => {
    vi.mocked(catalogGet).mockRejectedValue(new Error("sidecar 退出"));
    setup();

    await waitFor(() => expect(screen.getByText("无法确定源星历覆盖范围，执行已禁用")).toBeDefined());
    expect(screen.getByText(/读取源记录失败/)).toBeDefined();
    expect(submitButton().disabled).toBe(true);
  });

  it("执行路径不变：提交 run_tool(control_orbit)，成功后回调 onSuccess/onClose", async () => {
    vi.mocked(catalogGet).mockResolvedValue(resultWithJdSpan(30));
    const { props } = setup();
    await waitFor(() => expect(screen.queryByText("正在读取源记录的星历覆盖范围...")).toBeNull());

    fireEvent.click(submitButton());
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1));
    const [cmd, payload] = vi.mocked(invoke).mock.calls[0];
    expect(cmd).toBe("run_tool");
    expect(payload).toMatchObject({
      tool: "control_orbit",
      arguments: {
        input_record_id: "rec-1",
        control_interval: 0.25,
        feedback_arc: 0.125,
        num_controls: 120,
        num_monte_carlo: 5,
        control_mode: 1,
      },
    });
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });

  it("成功响应携带 data 时透传给 onSuccess（#477：App 据此上画布受控星历）", async () => {
    vi.mocked(catalogGet).mockResolvedValue(resultWithJdSpan(30));
    const respData = { controlled_ephemeris: { arrays: {}, frames: [] } };
    vi.mocked(invoke).mockResolvedValue({ status: "ok", data: respData });
    const { props } = setup();
    await waitFor(() => expect(screen.queryByText("正在读取源记录的星历覆盖范围...")).toBeNull());

    fireEvent.click(submitButton());
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledWith(respData));
  });
});
