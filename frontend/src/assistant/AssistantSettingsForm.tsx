// pi 配置状态面板（设置弹窗的“AI 助手”分区，也服务边栏空态“去设置”）。
// 模型服务、API key、provider、原生 thinking 配置全部由 pi 原生配置管理：
// 本应用不收集、不展示、也不声称能读取这些内容；只显示 pi 入口状态
// （路径/连接态），并提供打开 pi 原生配置流程的按钮（终端跑交互式 pi，
// 首跑完成 provider 登录）。
// 按钮失败时原样显示 stderr/原因，禁止伪造“连接成功”。
// pi config status panel (the settings modal's "AI Assistant" section,
// also the target of the sidebar empty state). Model service, API keys,
// providers and native thinking all live in pi's own configuration: this
// app neither collects nor displays them; it only shows the pi entry
// status (path/connection) and a button that opens pi's native setup flow
// (an interactive `pi` in a terminal). Failures surface stderr verbatim —
// never a fake "connected".

import { useCallback, useEffect, useState } from "react";
import { Button, Typography, message } from "antd";
import { ApiOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  assistantGetState,
  assistantOpenPiSetup,
} from "./api";
import { useTranslation } from "../i18n";

const { Text } = Typography;

export function AssistantSettingsForm() {
  const { t } = useTranslation();
  const [piPath, setPiPath] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openResult, setOpenResult] = useState<
    { ok: true; detail: string } | { ok: false; detail: string } | null
  >(null);

  const load = useCallback(async () => {
    try {
      const info = await assistantGetState();
      setPiPath(info.piPath);
      setConnected(info.connected);
      setLegacy(info.legacyConfig);
    } catch {
      setPiPath(null);
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openSetup = async () => {
    setOpening(true);
    setOpenResult(null);
    try {
      const detail = await assistantOpenPiSetup();
      setOpenResult({ ok: true, detail });
      message.success(detail);
    } catch (e) {
      // 失败如实展示（stderr/退出原因），不伪造成功
      setOpenResult({ ok: false, detail: String(e) });
      message.error(String(e));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t("assistant.settings.pi_managed")}
        </Text>
      </div>
      {legacy && (
        <Text type="warning" style={{ fontSize: 11 }}>
          {t("assistant.settings.legacy_hint")}
        </Text>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text strong style={{ fontSize: 12 }}>
          pi：
        </Text>
        {piPath ? (
          <>
            <Text code style={{ fontSize: 11 }}>
              {piPath}
            </Text>
            <Text
              type={connected ? "success" : "secondary"}
              style={{ fontSize: 12 }}
            >
              {connected
                ? t("assistant.settings.rpc_connected")
                : t("assistant.settings.rpc_idle")}
            </Text>
          </>
        ) : (
          <Text type="danger" style={{ fontSize: 12 }}>
            {t("assistant.settings.pi_missing")}
          </Text>
        )}
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => void load()}
          title={t("assistant.settings.refresh")}
        />
      </div>
      <div>
        <Button
          size="small"
          icon={<ApiOutlined />}
          loading={opening}
          disabled={!piPath}
          onClick={openSetup}
        >
          {t("assistant.settings.open_setup")}
        </Button>
      </div>
      {openResult && !openResult.ok && (
        <Text type="danger" style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>
          {openResult.detail}
        </Text>
      )}
    </div>
  );
}
