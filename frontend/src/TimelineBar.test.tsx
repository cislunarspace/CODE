// TimelineBar 单测（#429 情景配套）：播放速率驱动步长、循环开关的
// 到头停播/回绕、配置变更上报；以及基础交互回归（滑杆回调、事件芯片
// 跳转、禁用态）。播放已改为逐帧推进（rAF），测试用仿真能钟驱动帧回调。
// TimelineBar tests (for #429 scenarios): the playback rate drives the step,
// the looping switch toggles stop-at-end vs wrap-around, config changes are
// reported; plus baseline interaction regressions (slider callback, event
// chips, disabled state). Playback now steps per frame (rAF), so tests drive
// frame callbacks with fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TimelineBar, type TimelineBarProps } from "./TimelineBar";

const baseProps: TimelineBarProps = {
  timeRange: [0, 10_000_000], // ~116 天：一步不跨出量程，步长断言不被回绕污染
  currentEt: 100,
  onTimeChange: vi.fn(),
  mode: "et",
};

function setup(overrides: Partial<TimelineBarProps> = {}) {
  const props = { ...baseProps, ...overrides };
  render(<TimelineBar {...props} />);
  return props;
}

beforeEach(() => {
  // 播放逐帧推进：rAF/performance 一并仿真，advanceTimersByTime 按
  // 16ms 步进驱动帧回调（sinon rAF 节拍）。
  // Playback steps per frame: fake rAF/performance too; rAF callbacks fire
  // per 16ms of fake time (sinon's rAF cadence).
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "Date", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
  });
  // jsdom 无 ResizeObserver（antd Select 需要）
  // jsdom lacks ResizeObserver (antd Select needs it).
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TimelineBar 播放（#429 播放配置）", () => {
  it("播放步长 = 速率 × 帧间隔（16ms 仿真帧距，速率与量程解耦）：86400 → 每帧 1382.4 秒", () => {
    const props = setup({ playbackRate: 86400 });
    fireEvent.click(screen.getByTitle("播放"));
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(props.onTimeChange).toHaveBeenCalledWith(100 + 1382.4);
  });

  it("速率档位可切换并上报 onPlaybackConfigChange", () => {
    const onConfig = vi.fn();
    setup({ playbackRate: 86400, onPlaybackConfigChange: onConfig });
    fireEvent.mouseDown(screen.getByRole("combobox"));
    // 档位按选项文本点选
    // Pick a step by its option text.
    const option = screen.getByText("1周/秒");
    fireEvent.click(option.closest(".ant-select-item-option") ?? option);
    expect(onConfig).toHaveBeenCalledWith({ rate: 604800, loop: true });
  });

  it("循环开（默认）：到头回绕到量程起点", () => {
    const props = setup({ playbackRate: 3600, currentEt: 9_999_999 });
    fireEvent.click(screen.getByTitle("播放"));
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(props.onTimeChange).toHaveBeenCalledWith(0);
  });

  it("循环关：到头停在 maxEt 且自动停播（不再推进）", () => {
    const props = setup({ playbackRate: 3600, currentEt: 9_999_999, loop: false });
    fireEvent.click(screen.getByTitle("播放"));
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(props.onTimeChange).toHaveBeenCalledWith(10_000_000);
    vi.mocked(props.onTimeChange).mockClear();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(props.onTimeChange).not.toHaveBeenCalled();
  });

  it("循环开关点击上报配置变更", () => {
    const onConfig = vi.fn();
    setup({ loop: true, onPlaybackConfigChange: onConfig });
    fireEvent.click(screen.getByTitle("循环播放（点击关闭）"));
    expect(onConfig).toHaveBeenCalledWith({ rate: 86400, loop: false });
  });
});

describe("TimelineBar 基础交互回归", () => {
  it("事件芯片点击跳转到事件时刻", () => {
    const props = setup({
      events: [{ et: 42, label: "出发脉冲", dv: "3.10 km/s" }],
    });
    fireEvent.click(screen.getByText("出发脉冲 3.10 km/s"));
    expect(props.onTimeChange).toHaveBeenCalledWith(42);
  });

  it("无时间量程时禁用：播放/速率/循环均不可用", () => {
    setup({ timeRange: null });
    expect((screen.getByTitle("播放") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle("循环播放（点击关闭）") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox") as HTMLInputElement).disabled).toBe(true);
  });
});

