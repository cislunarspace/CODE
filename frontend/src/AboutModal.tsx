import React, { useEffect, useState } from "react";
import { Modal, Typography, Button, Space, message } from "antd";
import { InfoCircleOutlined, SyncOutlined } from "@ant-design/icons";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "./i18n";
import {
  checkForAppUpdates,
  checkManualAppUpdate,
  getBundleType,
  inAppUpdateSupported,
  type UpdateInfo,
} from "./updater";

const { Paragraph } = Typography;

export interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  onUpdateAvailable: (info: UpdateInfo) => void;
  /** 注入显示用的版本号（测试用）；缺省时取 Tauri 运行时真实版本 */
  /** Injected display version (for tests); falls back to the real Tauri runtime version. */
  currentVersion?: string;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  open,
  onClose,
  onUpdateAvailable,
  currentVersion,
}) => {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [runtimeVersion, setRuntimeVersion] = useState<string | null>(null);

  useEffect(() => {
    if (currentVersion) return;
    getVersion()
      .then(setRuntimeVersion)
      .catch(() => setRuntimeVersion("unknown"));
  }, [currentVersion]);

  const displayVersion = currentVersion ?? runtimeVersion ?? "…";

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      // deb/rpm 安装走 GitHub Releases 直下链路，其余走 updater 插件
      // deb/rpm installs use the GitHub Releases channel; others the plugin.
      const bundleType = await getBundleType().catch(() => "unknown" as const);
      const update = inAppUpdateSupported(bundleType)
        ? await checkForAppUpdates()
        : await checkManualAppUpdate();
      if (update) {
        onClose();
        onUpdateAvailable(update);
      } else {
        message.info(t("updater.latest"));
      }
    } catch (err: any) {
      message.error(`${t("updater.error")}: ${err?.message || String(err)}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      title={
        <Space size={6}>
          <InfoCircleOutlined style={{ fontSize: 13, color: "var(--ldc-text-muted)" }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>关于 CODE</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={460}
      styles={{ body: { paddingTop: 4 } }}
      footer={
        <Space size={8}>
          <Button
            size="small"
            icon={<SyncOutlined spin={checking} />}
            loading={checking}
            onClick={handleCheckUpdate}
          >
            {t("updater.check_action")}
          </Button>
          <Button size="small" type="primary" onClick={onClose}>
            确定
          </Button>
        </Space>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ldc-text)" }}>
          CODE - 地月转移轨道设计系统
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* 版本号一行放同一文本节点：这段文字会被用户原文引用，拆成多个元素后
              既难选中也难复制 */}
          {/* The version stays one text node: users quote this line verbatim, and
              splitting it across elements makes it hard to select or copy. */}
          <span style={{ fontSize: 11, color: "var(--ldc-text-muted)" }}>
            版本号：v{displayVersion}
          </span>
        </div>
        <Paragraph type="secondary" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
          基于 CR3BP 高精度动力学模型与星历转换算法，支持平动点轨道生成、转移轨道设计及轨道保持仿真。
        </Paragraph>
      </div>
    </Modal>
  );
};
