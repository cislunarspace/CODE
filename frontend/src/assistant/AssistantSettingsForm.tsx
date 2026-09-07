// omp 配置状态面板（设置弹窗的"AI 助手"分区，也服务边栏空态"去设置"）。
// 模型服务、API key、provider、原生 thinking 配置全部由 omp 原生配置管理：
// 本应用不收集、不展示、也不声称能读取这些内容；只显示 omp 入口状态
// （路径/连接态），并提供打开 omp 原生配置流程的按钮（终端 `omp setup`）。
// 按钮失败时原样显示 stderr/原因，禁止伪造"连接成功"。
// omp config status panel (the settings modal's "AI Assistant" section,
// also the target of the sidebar empty state). Model service, API keys,
// providers and native thinking all live in omp's own configuration: this
// app neither collects nor displays them; it only shows the omp entry
// status (path/connection) and a button that opens omp's native setup flow
// (terminal `omp setup`). Failures surface stderr verbatim — never a fake
// "connected".

import { useCallback, useEffect, useState } from "react";
import { Button, Typography, message } from "antd";
import { ApiOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  assistantGetState,
  assistantOpenOmpSetup,
} from "./api";
import { useTranslation } from "../i18n";

const { Text } = Typography;

export function AssistantSettingsForm() {
  const { t } = useTranslation();
  const [ompPath, setOmpPath] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openResult, setOpenResult] = useState<
    { ok: true; detail: string } | { ok: false; detail: string } | null
  >(null);

  const load = useCallback(async () => {
    try {
      const info = await assistantGetState();
      setOmpPath(info.ompPath);
      setConnected(info.connected);
      setLegacy(info.legacyConfig);
    } catch {
      setOmpPath(null);
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
      const detail = await assistantOpenOmpSetup();
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
          {t("assistant.settings.omp_managed")}
        </Text>
      </div>
      {legacy && (
        <Text type="warning" style={{ fontSize: 11 }}>
          {t("assistant.settings.legacy_hint")}
        </Text>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text strong style={{ fontSize: 12 }}>
          omp：
        </Text>
        {ompPath ? (
          <>
            <Text code style={{ fontSize: 11 }}>
              {ompPath}
            </Text>
            <Text
              type={connected ? "success" : "secondary"}
              style={{ fontSize: 12 }}
            >
              {connected
                ? t("assistant.settings.acp_connected")
                : t("assistant.settings.acp_idle")}
            </Text>
          </>
        ) : (
          <Text type="danger" style={{ fontSize: 12 }}>
            {t("assistant.settings.omp_missing")}
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
          disabled={!ompPath}
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
