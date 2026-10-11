// 底部状态栏组件回归：后端不可用时性能与版本降级为占位、时间口径仍在；
// 采样可用时显示 CPU 一位小数与内存 GB 用量/总量；任务状态随后端忙碌切换。
// Status bar regression: when the backend is unavailable the performance and
// version fields degrade to placeholders while the clock stays; with a sample
// available it shows the CPU at one decimal and memory in GB; the task state
// follows the busy flag.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StatusBar, formatLocalTime } from "./StatusBar";
import { I18nProvider } from "./i18n";

const invokeMock = vi.fn();
const getVersionMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => invokeMock(cmd),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => getVersionMock(),
}));

const renderBar = (busy = false, progress = "", view = "三维视图") =>
  render(
    <I18nProvider>
      <StatusBar busy={busy} progress={progress} view={view} />
    </I18nProvider>,
  );

beforeEach(() => {
  invokeMock.mockReset();
  getVersionMock.mockReset();
});

describe("状态栏", () => {
  it("后端通道不可用：性能与版本显示占位，时间口径仍渲染", async () => {
    invokeMock.mockRejectedValue(new Error("mock: off-app"));
    getVersionMock.mockRejectedValue(new Error("mock: off-app"));
    renderBar();

    const bar = screen.getByTestId("status-bar");
    expect(bar.textContent).toContain("本地");
    expect(bar.textContent).toContain("UTC");
    expect(bar.textContent).toContain("ET");
    // 当前视图字段：主页面激活的文档标签名（ADR 0034）
    // Active-view field: the main area's active document tab (ADR 0034).
    expect(screen.getByTestId("status-view").textContent).toContain("三维视图");
    await waitFor(() => expect(bar.textContent).toContain("版本 —"));
    expect(bar.textContent).toContain("CPU —");
    expect(bar.textContent).toContain("内存 —");
  });

  it("采样可用：CPU 保留一位小数、内存显示 GB 用量与总量，版本带 v 前缀", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "system_stats"
        ? Promise.resolve({
            cpuPercent: 37.46,
            memUsedBytes: 8 * 1024 ** 3,
            memTotalBytes: 32 * 1024 ** 3,
          })
        : Promise.reject(new Error("mock: off-app")),
    );
    getVersionMock.mockResolvedValue("5.0.0");
    renderBar();

    const bar = screen.getByTestId("status-bar");
    await waitFor(() => expect(bar.textContent).toContain("37.5%"));
    expect(bar.textContent).toContain("8.0 GB / 32.0 GB");
    expect(bar.textContent).toContain("v5.0.0");
  });

  it("任务状态：空闲显示空闲，忙碌显示进度文案", async () => {
    invokeMock.mockRejectedValue(new Error("mock: off-app"));
    getVersionMock.mockRejectedValue(new Error("mock: off-app"));
    const { unmount } = renderBar(false);
    expect(screen.getByTestId("status-bar").textContent).toContain("空闲");
    unmount();

    renderBar(true, "正在提交计算任务...");
    expect(screen.getByTestId("status-bar").textContent).toContain("正在提交计算任务...");
  });

  it("本地时间按 24 小时制补零（不依赖区域格式设置）", () => {
    const t = new Date(2026, 0, 2, 3, 4, 5);
    expect(formatLocalTime(t)).toBe("2026-01-02 03:04:05");
  });
});
