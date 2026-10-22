import React, { useState } from "react";
import { Modal, Progress, Typography, Button, Space } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { UpdateInfo, DownloadEvent } from "./updater";
import {
  downloadAndApplyUpdate,
  downloadAndInstallManualUpdate,
  RELEASES_PAGE_URL,
  formatBytes,
  createSpeedTracker,
} from "./updater";
import { useTranslation } from "./i18n";

const { Text, Paragraph } = Typography;

export interface UpdateModalProps {
  updateInfo: UpdateInfo | null;
  open: boolean;
  onClose: () => void;
  onRestart?: () => void | Promise<void>;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  updateInfo,
  open,
  onClose,
  onRestart,
}) => {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [percent, setPercent] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [receivedBytes, setReceivedBytes] = useState<number>(0);
  const [speedBps, setSpeedBps] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!updateInfo) return null;

  const handleStartDownload = async () => {
    setDownloading(true);
    setErrorMsg(null);
    let totalLength = 0;
    let downloadedLength = 0;
    const tracker = createSpeedTracker();
    // 双引擎：manualAsset（deb/rpm，应用内下载 + 系统包管理器安装）或
    // updater 插件（AppImage / Windows 安装器）
    // Two engines: manualAsset (deb/rpm: in-app download + system package
    // manager) or the updater plugin (AppImage / Windows installers).
    const runDownload = (cb: (evt: DownloadEvent) => void) =>
      updateInfo.manualAsset
        ? downloadAndInstallManualUpdate(updateInfo.manualAsset, cb)
        : downloadAndApplyUpdate(updateInfo, cb);

    try {
      await runDownload((evt) => {
        if (evt.event === "Started") {
          totalLength = evt.data.contentLength || 0;
          setTotalBytes(totalLength);
          setReceivedBytes(0);
          setSpeedBps(0);
          setPercent(0);
        } else if (evt.event === "Progress") {
          downloadedLength += evt.data.chunkLength;
          setReceivedBytes(downloadedLength);
          setSpeedBps(tracker(Date.now(), evt.data.chunkLength));
          if (totalLength > 0) {
            setPercent(Math.min(100, Math.round((downloadedLength / totalLength) * 100)));
          }
        } else if (evt.event === "Installing") {
          setInstalling(true);
        } else if (evt.event === "Finished") {
          setPercent(100);
        }
      });
      setDownloading(false);
      setDownloaded(true);
    } catch (err: any) {
      setDownloading(false);
      setInstalling(false);
      setErrorMsg(err?.message || String(err));
    }
  };

  const handleRestart = async () => {
    if (onRestart) {
      await onRestart();
      return;
    }
    // 默认触发 Tauri relaunch
    // Falls back to a Tauri relaunch.
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      window.location.reload();
    }
  };

  return (
    <Modal
      title={
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {downloaded
            ? updateInfo.manualAsset
              ? t("updater.installed_title")
              : t("updater.downloaded_title")
            : `${t("updater.available_title")} (v${updateInfo.version})`}
        </span>
      }
      open={open}
      width={480}
      styles={{ body: { paddingTop: 4 } }}
      onCancel={downloading ? undefined : onClose}
      footer={
        downloaded ? (
          <Button size="small" type="primary" onClick={handleRestart}>
            {t("updater.restart_now")}
          </Button>
        ) : (
          <Space size={8}>
            <Button size="small" disabled={downloading} onClick={onClose}>
              {t("updater.later")}
            </Button>
            <Button
              size="small"
              type="primary"
              loading={downloading}
              onClick={handleStartDownload}
            >
              {t("updater.download_now")}
            </Button>
          </Space>
        )
      }
      closable={!downloading}
      maskClosable={!downloading}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!downloaded ? (
          <>
            <Paragraph style={{ margin: 0, fontSize: 12, color: "var(--ldc-text-secondary)" }}>
              {t("updater.available_desc").replace("{version}", updateInfo.version)}
            </Paragraph>
            {updateInfo.body && (
              <div
                style={{
                  maxHeight: 180,
                  overflowY: "auto",
                  background: "var(--ldc-muted-bg)",
                  padding: "8px 10px",
                  borderRadius: "var(--ldc-radius)",
                  whiteSpace: "pre-wrap",
                }}
                className="ldc-scroll"
              >
                <Text style={{ fontSize: 11, color: "var(--ldc-text-secondary)" }}>
                  {updateInfo.body}
                </Text>
              </div>
            )}
            {downloading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Text style={{ fontSize: 12 }}>
                  {installing
                    ? t("updater.installing")
                    : t("updater.downloading")}
                </Text>
                <Progress
                  percent={percent}
                  strokeLinecap="round"
                  size="small"
                  status={errorMsg ? "exception" : "active"}
                />
                <Text style={{ fontSize: 11, color: "var(--ldc-text-muted)" }} className="ldc-num">
                  {totalBytes > 0
                    ? t("updater.download_stats")
                        .replace("{received}", formatBytes(receivedBytes))
                        .replace("{total}", formatBytes(totalBytes))
                        .replace("{speed}", speedBps > 0 ? formatBytes(speedBps) : "—")
                    : t("updater.download_stats_no_total")
                        .replace("{received}", formatBytes(receivedBytes))
                        .replace("{speed}", speedBps > 0 ? formatBytes(speedBps) : "—")}
                </Text>
              </div>
            )}
            {errorMsg && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 11, color: "var(--ldc-error)" }}>
                  {`${t("updater.error")}: ${errorMsg}`}
                </Text>
                {/* 手动路径失败时的自救：浏览器下载（自带断点续传） */}
                {/* Escape hatch for the manual path: browser download
                 *  (resumable) when the in-app engine fails. */}
                {updateInfo.manualAsset && !downloading && (
                  <Button size="small" onClick={() => openUrl(RELEASES_PAGE_URL)}>
                    {t("updater.open_releases")}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <Paragraph style={{ margin: 0, fontSize: 12, color: "var(--ldc-text-secondary)" }}>
            {updateInfo.manualAsset
              ? t("updater.installed_desc")
              : t("updater.downloaded_desc")}
          </Paragraph>
        )}
      </div>
    </Modal>
  );
};
