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

const { Paragraph, Title } = Typography;

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
        <Space>
          <InfoCircleOutlined />
          <span>关于 CODE</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button
            icon={<SyncOutlined spin={checking} />}
            loading={checking}
            onClick={handleCheckUpdate}
          >
            {t("updater.check_action")}
          </Button>
          <Button type="primary" onClick={onClose}>
            确定
          </Button>
        </Space>
      }
    >
      <div style={{ padding: "12px 0" }}>
        <Title level={4} style={{ margin: 0 }}>
          CODE - 地月转移轨道设计系统
        </Title>
        <Paragraph type="secondary" style={{ marginTop: 4 }}>
          版本号：v{displayVersion}
        </Paragraph>
        <Paragraph>
          基于 CR3BP 高精度动力学模型与星历转换算法，支持平动点轨道生成、转移轨道设计及轨道保持仿真。
        </Paragraph>
      </div>
    </Modal>
  );
};
