import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** GitHub Releases 页（latest 自动重定向到最新 tag），deb/rpm 安装的手动更新入口。 */
/** GitHub Releases page (latest redirects to the newest tag): manual update
 *  entry for deb/rpm installs. */
export const RELEASES_PAGE_URL =
  "https://github.com/cislunarspace/CODE/releases/latest";

export type BundleType =
  | "appimage"
  | "deb"
  | "rpm"
  | "nsis"
  | "msi"
  | "app"
  | "unknown";

/** 打包形态由 tauri-build 构建期二进制补丁决定；开发态（未打包）返回 null → "unknown"。 */
/** The bundle type is binary-patched at build time by tauri-build; dev builds
 *  (unpackaged) report null → "unknown". */
export async function getBundleType(): Promise<BundleType> {
  const t = await invoke<string | null>("bundle_type");
  return (t ?? "unknown") as BundleType;
}

/** 应用内更新仅在 AppImage 与 Windows/macOS 安装器下可用。deb/rpm 不在列：
 *  更新清单平台键（linux-{arch}）无安装格式维度，产物只有 AppImage，
 *  updater 在 deb/rpm 运行时按自身格式验型必败，只能引导手动下载。 */
/** In-app updates work for AppImage and the Windows/macOS installers only.
 *  deb/rpm are excluded: the manifest platform keys carry no bundle-format
 *  dimension and the Linux artifact is an AppImage, so the updater's format
 *  check fails on deb/rpm installs — manual download is the only path. */
export function inAppUpdateSupported(t: BundleType): boolean {
  return t !== "deb" && t !== "rpm";
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  /** updater 插件路径（AppImage / Windows 安装器）*/
  rawUpdate?: Update;
  /** deb/rpm 手动更新路径（GitHub Releases 直下安装包）*/
  manualAsset?: ManualAsset;
}

/** deb/rpm 手动更新资产（GitHub Releases 直下安装包）。 */
/** A release asset for the deb/rpm manual update path. */
export interface ManualAsset {
  url: string;
  name: string;
  size?: number;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "downloaded"
  | "error";

export async function checkForAppUpdates(
  checkFn: () => Promise<Update | null> = check
): Promise<UpdateInfo | null> {
  const update = await checkFn();
  if (!update) {
    return null;
  }
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    body: update.body,
    rawUpdate: update,
  };
}

/** 后端 update_check_latest 命令的返回形状（camelCase 由 serde rename 保证）。 */
interface LatestReleaseDto {
  version: string;
  currentVersion: string;
  notes?: string;
  assetUrl: string;
  assetName: string;
  assetSize?: number;
}

/** deb/rpm 安装的手动更新通道：查 GitHub 最新 Release，取与当前格式/
 *  架构匹配的安装包。无更新/非 deb/rpm 安装返回 null。 */
/** Manual update channel for deb/rpm installs: query the latest GitHub
 *  release and pick the asset matching the installed format and architecture.
 *  Returns null when up to date or not on the deb/rpm path. */
export async function checkManualAppUpdate(): Promise<UpdateInfo | null> {
  const rel = await invoke<LatestReleaseDto | null>("update_check_latest");
  if (!rel) {
    return null;
  }
  return {
    version: rel.version,
    currentVersion: rel.currentVersion,
    body: rel.notes,
    manualAsset: {
      url: rel.assetUrl,
      name: rel.assetName,
      size: rel.assetSize,
    },
  };
}

export type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  /** deb/rpm 路径专用：下载完成，pkexec 拉起系统包管理器安装中 */
  /** deb/rpm path only: download finished, system installer running via pkexec */
  | { event: "Installing" }
  | { event: "Finished" };

export async function downloadAndApplyUpdate(
  updateInfo: UpdateInfo,
  onEvent?: (event: DownloadEvent) => void
): Promise<void> {
  if (!updateInfo.rawUpdate) {
    throw new Error("缺少 updater 插件更新对象（应走 manualAsset 路径）");
  }
  await updateInfo.rawUpdate.downloadAndInstall((event) => {
    if (onEvent) {
      onEvent(event as DownloadEvent);
    }
  });
}

/** deb/rpm 更新引擎：应用内下载安装包（进度经 update-download-progress
 *  事件回报）→ pkexec 拉起系统包管理器安装。安装完成后磁盘二进制已替换，
 *  由调用方 relaunch 重启加载新版本。 */
/** deb/rpm engine: download the package in-app (progress reported via the
 *  update-download-progress event), then install it through the system package
 *  manager via pkexec. The on-disk binary is replaced once this resolves; the
 *  caller relaunches to load the new version. */
export async function downloadAndInstallManualUpdate(
  asset: ManualAsset,
  onEvent?: (event: DownloadEvent) => void
): Promise<void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{
    event: string;
    contentLength?: number;
    chunkLength?: number;
  }>("update-download-progress", (ev) => {
    const p = ev.payload;
    if (p.event === "Started") {
      onEvent?.({ event: "Started", data: { contentLength: p.contentLength } });
    } else if (p.event === "Progress") {
      onEvent?.({ event: "Progress", data: { chunkLength: p.chunkLength ?? 0 } });
    }
  });
  try {
    const path = await invoke<string>("update_download", {
      url: asset.url,
      name: asset.name,
    });
    onEvent?.({ event: "Installing" });
    await invoke("update_install", { path });
  } finally {
    unlisten();
  }
}

/** 字节数转人类可读（B 取整，KB 以上一位小数） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return i === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[i]}`;
}

/** 下载速度跟踪：指数移动平均平滑瞬时速率，避免 UI 跳变。
 *  返回 B/s；首个分块无时间差，返回 0。 */
export function createSpeedTracker(): (nowMs: number, chunkBytes: number) => number {
  let lastMs: number | null = null;
  let smoothed = 0;
  return (nowMs, chunkBytes) => {
    if (lastMs !== null) {
      const dt = (nowMs - lastMs) / 1000;
      if (dt > 0) {
        const instant = chunkBytes / dt;
        smoothed = smoothed === 0 ? instant : smoothed * 0.7 + instant * 0.3;
      }
    }
    lastMs = nowMs;
    return smoothed;
  };
}

