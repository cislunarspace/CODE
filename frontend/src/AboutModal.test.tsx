import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { getVersion } from "@tauri-apps/api/app";
import { AboutModal } from "./AboutModal";
import * as updaterModule from "./updater";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("4.9.9"),
}));

beforeEach(() => {
  vi.mocked(getVersion).mockClear();
});

describe("AboutModal 组件（#403）", () => {
  it("缺省显示 Tauri 运行时真实版本（不再硬编码）", async () => {
    render(
      <AboutModal open={true} onClose={vi.fn()} onUpdateAvailable={vi.fn()} />
    );
    await waitFor(() => {
      expect(getVersion).toHaveBeenCalled();
      expect(screen.getByText(/v4\.9\.9/)).toBeDefined();
    });
  });

  it("currentVersion prop 注入时优先于运行时版本（测试口）", async () => {
    render(
      <AboutModal
        open={true}
        onClose={vi.fn()}
        onUpdateAvailable={vi.fn()}
        currentVersion="4.1.2"
      />
    );
    expect(screen.getByText(/v4\.1\.2/)).toBeDefined();
    expect(getVersion).not.toHaveBeenCalled();
    expect(screen.getByText(/CODE - 地月转移轨道设计系统/)).toBeDefined();
  });

  it("点击检查按钮时检查更新，上抛更新信息并关闭弹窗", async () => {
    const mockUpdateInfo: updaterModule.UpdateInfo = {
      version: "4.2.0",
      currentVersion: "4.1.2",
      rawUpdate: {} as any,
    };
    vi.spyOn(updaterModule, "getBundleType").mockResolvedValue("appimage");
    vi.spyOn(updaterModule, "checkForAppUpdates").mockResolvedValue(mockUpdateInfo);
    const onUpdateAvailable = vi.fn();
    const onClose = vi.fn();

    render(
      <AboutModal
        open={true}
        onClose={onClose}
        onUpdateAvailable={onUpdateAvailable}
      />
    );

    const checkBtn = screen.getByRole("button", { name: /检查更新|Check for Updates/i });
    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(updaterModule.checkForAppUpdates).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(onUpdateAvailable).toHaveBeenCalledWith(mockUpdateInfo);
    });
  });

  it("deb 安装时检查走手动更新通道：新版本交给更新弹窗，不调 updater 插件", async () => {
    vi.spyOn(updaterModule, "getBundleType").mockResolvedValue("deb");
    vi.spyOn(updaterModule, "checkManualAppUpdate").mockResolvedValue({
      version: "4.2.0",
      currentVersion: "4.1.2",
      manualAsset: { url: "https://example.com/a.deb", name: "a.deb", size: 10 },
    });
    // spyOn 对已 spy 的模块导出幂等返回同一 mock，清掉上一用例的调用记录再断言
    vi.spyOn(updaterModule, "checkForAppUpdates").mockClear();
    const onUpdateAvailable = vi.fn();
    const onClose = vi.fn();

    render(
      <AboutModal open={true} onClose={onClose} onUpdateAvailable={onUpdateAvailable} />
    );

    fireEvent.click(screen.getByRole("button", { name: /检查更新|Check for Updates/i }));

    await waitFor(() => {
      expect(updaterModule.checkManualAppUpdate).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(onUpdateAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ version: "4.2.0" })
      );
    });
    expect(updaterModule.checkForAppUpdates).not.toHaveBeenCalled();
  });
});
