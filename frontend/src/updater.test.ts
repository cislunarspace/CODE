import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  checkForAppUpdates,
  checkManualAppUpdate,
  downloadAndInstallManualUpdate,
  formatBytes,
  createSpeedTracker,
  getBundleType,
  inAppUpdateSupported,
  type UpdateInfo,
} from "./updater";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("updater 模块（#403）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getBundleType 把后端 null（开发态未打包）映射为 unknown，走 updater 原行为", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await getBundleType()).toBe("unknown");
    expect(inAppUpdateSupported("unknown")).toBe(true);
  });

  it("deb/rpm 不支持应用内更新，AppImage/unknown 支持", async () => {
    vi.mocked(invoke).mockResolvedValue("deb");
    expect(await getBundleType()).toBe("deb");
    expect(inAppUpdateSupported("deb")).toBe(false);
    expect(inAppUpdateSupported("rpm")).toBe(false);
    expect(inAppUpdateSupported("appimage")).toBe(true);
    expect(inAppUpdateSupported("nsis")).toBe(true);
  });

  it("checkManualAppUpdate 把后端发布映射为 manualAsset 更新对象", async () => {
    vi.mocked(invoke).mockResolvedValue({
      version: "4.9.0",
      currentVersion: "4.8.2",
      notes: "release notes",
      assetUrl: "https://example.com/app_4.9.0_amd64.deb",
      assetName: "app_4.9.0_amd64.deb",
      assetSize: 123,
    });
    expect(await checkManualAppUpdate()).toEqual({
      version: "4.9.0",
      currentVersion: "4.8.2",
      body: "release notes",
      manualAsset: {
        url: "https://example.com/app_4.9.0_amd64.deb",
        name: "app_4.9.0_amd64.deb",
        size: 123,
      },
    });
  });

  it("checkManualAppUpdate 无更新时返回 null", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await checkManualAppUpdate()).toBeNull();
  });

  it("downloadAndInstallManualUpdate 走下载+安装命令，转发事件并进入安装阶段", async () => {
    let eventHandler: ((ev: { payload: { event: string; contentLength?: number; chunkLength?: number } }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (_name, cb) => {
      eventHandler = cb as typeof eventHandler;
      return () => {};
    });
    vi.mocked(invoke).mockImplementation((cmd: unknown) => {
      if (cmd === "update_download") {
        eventHandler?.({ payload: { event: "Started", contentLength: 100 } });
        eventHandler?.({ payload: { event: "Progress", chunkLength: 100 } });
        return Promise.resolve("/tmp/app.deb");
      }
      if (cmd === "update_install") return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected command ${String(cmd)}`));
    });

    const events: string[] = [];
    await downloadAndInstallManualUpdate(
      { url: "https://example.com/a.deb", name: "a.deb" },
      (e) => events.push(e.event)
    );

    expect(events).toEqual(["Started", "Progress", "Installing"]);
    expect(invoke).toHaveBeenCalledWith("update_download", {
      url: "https://example.com/a.deb",
      name: "a.deb",
    });
    expect(invoke).toHaveBeenCalledWith("update_install", { path: "/tmp/app.deb" });
  });

  it("无可用更新时返回 null", async () => {
    const mockCheck = vi.fn().mockResolvedValue(null);
    const result = await checkForAppUpdates(mockCheck);
    expect(result).toBeNull();
  });

  it("有更新时正确提取版本号与更新说明，并保留原始更新对象", async () => {
    const mockUpdate = {
      version: "4.2.0",
      currentVersion: "4.1.2",
      body: "Release notes: fixed orbit rendering",
      downloadAndInstall: vi.fn(),
    };
    const mockCheck = vi.fn().mockResolvedValue(mockUpdate);

    const result = await checkForAppUpdates(mockCheck);
    expect(result).toEqual({
      version: "4.2.0",
      currentVersion: "4.1.2",
      body: "Release notes: fixed orbit rendering",
      rawUpdate: mockUpdate,
    });
  });

  it("更新检查失败时原样抛出错误", async () => {
    const mockCheck = vi.fn().mockRejectedValue(new Error("Network offline"));
    await expect(checkForAppUpdates(mockCheck)).rejects.toThrow("Network offline");
  });

  it("下载并安装更新，进度事件逐个转发", async () => {
    const mockRawUpdate: any = {
      version: "4.2.0",
      currentVersion: "4.1.2",
      downloadAndInstall: vi.fn().mockImplementation(async (onEvent) => {
        if (onEvent) {
          onEvent({ event: "Started", data: { contentLength: 1000 } });
          onEvent({ event: "Progress", data: { chunkLength: 500 } });
          onEvent({ event: "Finished" });
        }
      }),
    };

    const updateInfo: UpdateInfo = {
      version: "4.2.0",
      currentVersion: "4.1.2",
      rawUpdate: mockRawUpdate,
    };

    const events: any[] = [];
    const { downloadAndApplyUpdate } = await import("./updater");
    await downloadAndApplyUpdate(updateInfo, (evt) => events.push(evt));

    expect(mockRawUpdate.downloadAndInstall).toHaveBeenCalled();
    expect(events.length).toBe(3);
    expect(events[0]).toEqual({ event: "Started", data: { contentLength: 1000 } });
    expect(events[1]).toEqual({ event: "Progress", data: { chunkLength: 500 } });
    expect(events[2]).toEqual({ event: "Finished" });
  });

  describe("formatBytes", () => {
    it("小于 1024 字节按整数 B 输出", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(1023)).toBe("1023 B");
    });

    it("换算为 KB/MB/GB 并保留一位小数，超出单位表不再进位", () => {
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
      // 超出单位表不再进位，停留在 GB
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1024.0 GB");
    });

    it("负数、NaN、Infinity 按 0 B 处理", () => {
      expect(formatBytes(-1)).toBe("0 B");
      expect(formatBytes(Number.NaN)).toBe("0 B");
      expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
    });
  });

  describe("createSpeedTracker", () => {
    it("首个数据块返回 0（尚无时间差）", () => {
      const track = createSpeedTracker();
      expect(track(1000, 5000)).toBe(0);
    });

    it("按相邻数据块差值计算速度并做指数平滑", () => {
      const track = createSpeedTracker();
      track(1000, 5000); // 首块只记时间
      expect(track(2000, 1000)).toBe(1000); // 1000 B / 1s
      // 瞬时 10000 B/s（1000 B / 0.1s），EMA：1000*0.7 + 10000*0.3 = 3700
      expect(track(2100, 1000)).toBe(3700);
    });

    it("时间差为零或负时不计算速度，返回 0", () => {
      const track = createSpeedTracker();
      track(1000, 5000);
      expect(track(1000, 1000)).toBe(0); // 同时刻：无速度，不崩
    });
  });
});
