import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UpdateModal } from "./UpdateModal";
import * as updaterModule from "./updater";
import type { UpdateInfo } from "./updater";

describe("UpdateModal 组件（#403）", () => {
  const mockUpdateInfo: UpdateInfo = {
    version: "4.2.0",
    currentVersion: "4.1.2",
    body: "New features added",
    rawUpdate: {
      version: "4.2.0",
      currentVersion: "4.1.2",
      downloadAndInstall: vi.fn(),
    } as any,
  };

  it("open 为 true 时渲染弹窗，版本号与更新说明可见", () => {
    render(
      <UpdateModal
        open={true}
        updateInfo={mockUpdateInfo}
        onClose={vi.fn()}
      />
    );
    expect(screen.getAllByText(/4\.2\.0/).length).toBeGreaterThan(0);
    expect(screen.getByText("New features added")).toBeDefined();
  });

  it("点击下载按钮后调用下载安装，完成后显示立即重启", async () => {
    const downloadAndInstall = vi.fn().mockImplementation(async (cb) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 100 } });
      cb({ event: "Finished" });
    });

    const info: UpdateInfo = {
      ...mockUpdateInfo,
      rawUpdate: {
        ...mockUpdateInfo.rawUpdate,
        downloadAndInstall,
      } as any,
    };

    render(
      <UpdateModal
        open={true}
        updateInfo={info}
        onClose={vi.fn()}
      />
    );

    const downloadBtn = screen.getByRole("button", { name: /立即更新|Update Now/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /立即重启|Restart Now/i })).toBeDefined();
    });
  });

  it("下载过程中显示已下载大小与总量进度", async () => {
    const downloadAndInstall = vi.fn().mockImplementation(async (cb) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 40 } });
      cb({ event: "Finished" });
    });

    const info: UpdateInfo = {
      ...mockUpdateInfo,
      rawUpdate: {
        ...mockUpdateInfo.rawUpdate,
        downloadAndInstall,
      } as any,
    };

    render(
      <UpdateModal
        open={true}
        updateInfo={info}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /立即更新|Update Now/i }));

    await waitFor(() => {
      // 已下载 40 B / 总量 100 B（瞬时回调无时间差，速度显示占位符 —）
      expect(screen.getByText(/40 B \/ 100 B/)).toBeDefined();
    });
  });

  it("缺少总量时只显示已下载大小，不出现 x / y 形式", async () => {
    const downloadAndInstall = vi.fn().mockImplementation(async (cb) => {
      cb({ event: "Started", data: {} });
      cb({ event: "Progress", data: { chunkLength: 40 } });
      cb({ event: "Finished" });
    });

    const info: UpdateInfo = {
      ...mockUpdateInfo,
      rawUpdate: {
        ...mockUpdateInfo.rawUpdate,
        downloadAndInstall,
      } as any,
    };

    render(
      <UpdateModal
        open={true}
        updateInfo={info}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /立即更新|Update Now/i }));

    await waitFor(() => {
      // 无总量：只显示已下载，不出现 “x / y” 形式
      expect(
        screen.getByText((c) => c.includes("40 B") && !c.includes(" / "))
      ).toBeDefined();
    });
  });

  it("manualAsset 走应用内下载安装引擎，完成后显示安装完成与重启", async () => {
    const manualEngine = vi
      .spyOn(updaterModule, "downloadAndInstallManualUpdate")
      .mockImplementation(async (_asset, cb) => {
        cb?.({ event: "Started", data: { contentLength: 100 } });
        cb?.({ event: "Progress", data: { chunkLength: 100 } });
        cb?.({ event: "Installing" });
        cb?.({ event: "Finished" });
      });
    const info: UpdateInfo = {
      version: "4.2.0",
      currentVersion: "4.1.2",
      manualAsset: { url: "https://example.com/a.deb", name: "a.deb", size: 100 },
    };

    render(
      <UpdateModal
        open={true}
        updateInfo={info}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /立即更新|Update Now/i }));

    await waitFor(() => {
      expect(manualEngine).toHaveBeenCalledWith(
        info.manualAsset,
        expect.any(Function)
      );
      expect(screen.getByRole("button", { name: /立即重启|Restart Now/i })).toBeDefined();
      expect(screen.getByText(/安装完成|Installation Complete/)).toBeDefined();
    });
  });
});
