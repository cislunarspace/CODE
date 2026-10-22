// 工具卡片：一次工具调用在对话流中的可视记录（CONTEXT.md 术语：工具卡片）。
// 状态机：proposed（待确认）→ running（不定态进度）→ done / error
//（用户拒绝走 failed 终态，卡片呈 error 态并显示拒绝原因）。
// pi RPC 基座：审批经扩展 select 对话框（批准/拒绝），协议不携带改后参数，
// 故无改参入口；参数全文展示供审阅。

import { useEffect, useState } from "react";
import { Button, Typography } from "antd";
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

/** 状态徽标的浅底与前景：彩色只用于状态，四态各取一组语义色（ADR 0037）。
 *  Soft fill and foreground per status: colour is reserved for status, one
 *  semantic pair for each of the four states (ADR 0037). */
const STATUS_CHIP_STYLE = {
  proposed: { background: "var(--ldc-warning-soft)", color: "var(--ldc-warning)" },
  running: { background: "var(--ldc-info-soft)", color: "var(--ldc-info)" },
  done: { background: "var(--ldc-success-soft)", color: "var(--ldc-success)" },
  error: { background: "var(--ldc-error-soft)", color: "var(--ldc-error)" },
} as const;

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

  // 运行中每秒刷新耗时（pi 事件流不携带分数制进度，耗时是不定态指示）
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

  const statusText = {
    proposed: t("assistant.card.proposed"),
    running: `${t("assistant.card.running")} ${elapsed}s`,
    done: t("assistant.card.done"),
    error: t("assistant.card.failed"),
  }[card.status];

  // 状态徽标复用 ldc.css 的 .ldc-chip（20px 高、6px 圆角、11px 等宽数字），
  // 只把中性底换成语义浅底与对应前景色。运行中带不定态图标，耗时是不定态
  // 进度的唯一指示。
  // The status chip reuses .ldc-chip from ldc.css (20px tall, 6px radius, 11px
  // tabular figures) and only swaps the neutral fill for a semantic soft fill with
  // its matching foreground. Running carries the spinner icon; elapsed time is the
  // only indeterminate progress hint.
  const statusChip = (
    <span className="ldc-chip" style={STATUS_CHIP_STYLE[card.status]}>
      {card.status === "running" && <LoadingOutlined />}
      {statusText}
    </span>
  );

  return (
    <div
      className="ldc-card"
      style={{
        padding: 8,
        margin: "0 0 10px",
        // 工具卡片是对话流里的独立块，圆角取卡片档 10
        // A tool card is a discrete block in the stream: 10px, the card step.
        borderRadius: 10,
        fontSize: 12,
      }}
    >
      <div
        className={collapsible ? "ldc-hover-row" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          margin: "0 -4px",
          padding: "2px 4px",
          borderRadius: "var(--ldc-radius-sm)",
          cursor: collapsible ? "pointer" : undefined,
        }}
        onClick={collapsible ? () => setExpanded((e) => !e) : undefined}
      >
        {collapsible ? (
          expanded ? <CaretDownOutlined /> : <CaretRightOutlined />
        ) : (
          <RocketOutlined />
        )}
        <Text code style={{ fontSize: 12 }}>{card.tool}</Text>
        {statusChip}
        {!showDetail && (card.summary?.recordId || card.summary?.familyId) && (
          <Text
            style={{
              fontSize: 11,
              color: "var(--ldc-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
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
            background: "var(--ldc-muted-bg)",
            borderRadius: 6,
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
