// SOP 步骤带（ADR 0034）：定基准、定任务、填参数、求解、校核、入库、情景。
// 当前阶段高亮，已完成阶段给勾，未满足的前置条件在带内逐条列出并给出“去补”按钮。
// 点任一阶段直接跳到该阶段的动作（不是向导弹窗，随时可跳任意步）。
// The SOP step strip (ADR 0034): basis, task, parameters, solve, review, catalog,
// scenario. The current stage is highlighted, finished stages get a check, unmet
// preconditions are listed inline with a "go fix it" button, and clicking a stage
// performs that stage's action — no wizard, any step is reachable at any time.

import { Button, Typography } from "antd";
import { CheckOutlined, WarningOutlined } from "@ant-design/icons";
import { shellColors } from "./theme";
import { useTranslation } from "./i18n";
import type { SopBlocker, SopStageKey, SopStageState } from "./sop";

const { Text } = Typography;

/** 阶段显示名（词典键） */
const STAGE_LABEL_KEYS: Record<SopStageKey, string> = {
  basis: "sop.stage.basis",
  task: "sop.stage.task",
  params: "sop.stage.params",
  run: "sop.stage.run",
  review: "sop.stage.review",
  catalog: "sop.stage.catalog",
  scenario: "sop.stage.scenario",
};

/** 阻断项的补救动作文案（词典键） */
const FIX_LABEL_KEYS: Record<SopBlocker["fix"], string> = {
  "pick-epoch": "sop.fix.pick_epoch",
  "fill-params": "sop.fix.fill_params",
  "pick-record": "sop.fix.pick_record",
};

export interface SopBarProps {
  mode: "dark" | "light";
  stages: SopStageState[];
  /** 每个阶段的当前取值文案（工具名、参数计数、结果条数、库状态…） */
  values: Partial<Record<SopStageKey, string>>;
  blockers: SopBlocker[];
  onStageClick: (key: SopStageKey) => void;
  onFix: (fix: SopBlocker["fix"]) => void;
}

export function SopBar({ mode, stages, values, blockers, onStageClick, onFix }: SopBarProps) {
  const { t } = useTranslation();
  const colors = shellColors(mode);

  return (
    <div
      data-testid="sop-bar"
      style={{
        flexShrink: 0,
        background: colors.barBg,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch", padding: "2px 8px", gap: 2 }}>
        {stages.map((stage, index) => {
          const value = values[stage.key];
          return (
            <div
              key={stage.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                // 当前阶段用底色 + 顶边指示线标出。已完成只是勾选，不抢视觉
                // The current stage gets a fill plus a top rule; finished stages
                // are only checked so they do not compete for attention.
                background: stage.current ? colors.activeBg : "transparent",
                borderTop: `2px solid ${stage.current ? colors.activeText : "transparent"}`,
              }}
            >
              <Button
                type="text"
                size="small"
                data-testid={`sop-stage-${stage.key}`}
                onClick={() => onStageClick(stage.key)}
                title={t(STAGE_LABEL_KEYS[stage.key])}
                style={{
                  height: 22,
                  padding: "0 2px",
                  color: stage.current ? colors.activeText : stage.done ? "inherit" : "#8c8c8c",
                  fontWeight: stage.current ? 600 : 400,
                }}
              >
                <span style={{ fontVariantNumeric: "tabular-nums", marginRight: 4 }}>
                  {index + 1}
                </span>
                {t(STAGE_LABEL_KEYS[stage.key])}
                {stage.done && !stage.current && (
                  <CheckOutlined style={{ fontSize: 10, marginLeft: 4, opacity: 0.6 }} />
                )}
                {value && (
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                    {value}
                  </Text>
                )}
              </Button>
            </div>
          );
        })}
        <Text type="secondary" style={{ fontSize: 11, alignSelf: "center", marginLeft: "auto" }}>
          {t("sop.reuse_hint")}
        </Text>
      </div>

      {blockers.length > 0 && (
        <div
          data-testid="sop-blockers"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "2px 10px 4px",
            borderTop: `1px dashed ${colors.border}`,
          }}
        >
          <Text style={{ fontSize: 11, color: "#ff4d4f" }}>
            <WarningOutlined style={{ marginRight: 4 }} />
            {t("sop.blocked_title")}
          </Text>
          {blockers.map((blocker) => (
            <span key={blocker.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t(blocker.labelKey)}
                {blocker.detail ? `（${blocker.detail}）` : ""}
              </Text>
              <Button
                size="small"
                type="text"
                data-testid={`sop-fix-${blocker.key}`}
                onClick={() => onFix(blocker.fix)}
                style={{ height: 20, fontSize: 11, color: colors.activeText, padding: "0 4px" }}
              >
                {t(FIX_LABEL_KEYS[blocker.fix])}
              </Button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
