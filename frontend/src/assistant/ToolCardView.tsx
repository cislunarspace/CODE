// 工具卡片：一次工具调用在对话流中的可视记录（CONTEXT.md 术语：工具卡片）。
// 状态机：proposed（待确认）→ running（不定态进度）→ done / error
//（用户拒绝走 omp 的 failed 终态，卡片呈 error 态并显示拒绝原因）。
// omp ACP 基座：审批经 omp 审批表单（Approve/Deny），协议不携带改后参数，
// 故无改参入口；参数全文展示供审阅。

import { useEffect, useState } from "react";
import { Button, Typography, Tag } from "antd";
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CheckOutlined,
  CloseOutlined,
  LoadingOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { assistantConfirmTool } from "./api";
import { useTranslation } from "../i18n";

const { Text } = Typography;

export interface ToolCardData {
  callId: string;
  tool: string;
  args: unknown;
  status: "proposed" | "running" | "done" | "error";
  /** tool_done 的摘要：status / recordId / familyId / scenarioFile / error.message */
  summary?: {
    status?: string;
    recordId?: string;
    familyId?: string;
    scenarioFile?: string;
    error?: { message?: string };
  };
  /** 运行起始时间戳（ms），用于耗时显示 */
  startedAt?: number;
}

export function ToolCardView({
  card,
  onOpenRecord,
  onApplyScenario,
}: {
  card: ToolCardData;
  onOpenRecord: (recordId: string, tool: string) => void;
  /** 应用情景（ADR 0027）：scenario_write 完成后的同语义跳转入口 */
  onApplyScenario?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);

  // 运行中每秒刷新耗时（omp 更新流不携带分数制进度，耗时是不定态指示）
  useEffect(() => {
    if (card.status !== "running") return;
    const base = card.startedAt ?? Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - base) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [card.status, card.startedAt]);

  const argsText = JSON.stringify(card.args, null, 2);

  // 完成态折叠为单行摘要（工具名 + 状态 + record_id），点击展开参数与
  // 结果摘要；待确认/运行中保持全文展示供审阅。
  const collapsible = card.status === "done" || card.status === "error";
  const [expanded, setExpanded] = useState(false);
  const showDetail = !collapsible || expanded;

  const statusTag = {
    proposed: <Tag color="gold">{t("assistant.card.proposed")}</Tag>,
    running: (
      <Tag icon={<LoadingOutlined />} color="processing">
        {t("assistant.card.running")} {elapsed}s
      </Tag>
    ),
    done: <Tag color="success">{t("assistant.card.done")}</Tag>,
    error: <Tag color="error">{t("assistant.card.failed")}</Tag>,
  }[card.status];

  return (
    <div
      style={{
        border: "1px solid var(--tod-border, #d9d9d9)",
        borderRadius: 6,
        padding: "6px 8px",
        margin: "4px 0",
        fontSize: 12,
        background: "var(--tod-card-bg, rgba(128,128,128,0.06))",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: collapsible ? "pointer" : undefined }}
        onClick={collapsible ? () => setExpanded((e) => !e) : undefined}
      >
        {collapsible ? (
          expanded ? <CaretDownOutlined /> : <CaretRightOutlined />
        ) : (
          <RocketOutlined />
        )}
        <Text code style={{ fontSize: 12 }}>{card.tool}</Text>
        {statusTag}
        {!showDetail && (card.summary?.recordId || card.summary?.familyId) && (
          <Text type="secondary" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {card.summary.recordId ?? `族 ${card.summary.familyId}`}
          </Text>
        )}
      </div>

      {/* 参数摘要：确认前完整展示供审阅（ADR 0022 决策 4） */}
      {showDetail && (
        <pre
          style={{
            margin: "6px 0 0",
            padding: 6,
            fontSize: 11,
            maxHeight: 160,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            background: "var(--tod-code-bg, rgba(128,128,128,0.1))",
            borderRadius: 4,
          }}
        >
          {argsText}
        </pre>
      )}

      {card.status === "proposed" && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => assistantConfirmTool(card.callId, true)}
          >
            {t("assistant.card.confirm")}
          </Button>
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            onClick={() => assistantConfirmTool(card.callId, false)}
          >
            {t("assistant.card.reject")}
          </Button>
        </div>
      )}

      {card.status === "done" && card.summary?.recordId && (
        <Button
          size="small"
          type="link"
          style={{ padding: 0, marginTop: 4 }}
          onClick={() => onOpenRecord(card.summary!.recordId!, card.tool)}
        >
          {t("assistant.card.view_artifact")}（{card.summary.recordId}）
        </Button>
      )}
      {card.status === "done" && card.tool === "scenario_write" && card.summary?.scenarioFile && (
        <Button
          size="small"
          type="link"
          style={{ padding: 0, marginTop: 4 }}
          onClick={() => onApplyScenario?.(card.summary!.scenarioFile!)}
        >
          {t("assistant.card.apply_scenario")}（{card.summary.scenarioFile.split(/[\\/]/).pop()}）
        </Button>
      )}
      {card.status === "error" && showDetail && card.summary?.error?.message && (
        <Text type="danger" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
          {card.summary.error.message}
        </Text>
      )}
    </div>
  );
}
