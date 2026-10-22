// SOP 步骤带（ADR 0034）：定基准、定任务、填参数、求解、校核、入库、情景。
// 当前阶段高亮，已完成阶段给勾，未满足的前置条件在带内逐条列出并给出“去补”按钮。
// 点任一阶段直接跳到该阶段的动作（不是向导弹窗，随时可跳任意步）。
// The SOP step strip (ADR 0034): basis, task, parameters, solve, review, catalog,
// scenario. The current stage is highlighted, finished stages get a check, unmet
// preconditions are listed inline with a "go fix it" button, and clicking a stage
// performs that stage's action — no wizard, any step is reachable at any time.

import { Button } from "antd";
import { CheckOutlined, WarningOutlined } from "@ant-design/icons";
import { shellColors } from "./theme";
import { useTranslation } from "./i18n";
import type { SopBlocker, SopStageKey, SopStageState } from "./sop";

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
      <div style={{ display: "flex", alignItems: "center", padding: "4px 8px", gap: 4 }}>
        {stages.map((stage, index) => {
          const value = values[stage.key];
          return (
            // 当前阶段是实心主色胶囊，已完成与未完成都只是文字与勾的差别；
            // 非当前阶段的行由外层胶囊提供悬停底，内部按钮透明透出它
            // The current stage is a solid primary pill; finished and pending
            // stages differ only in text and the check mark. A non-current
            // pill's hover fill comes from the wrapper, whose transparent inner
            // button lets it show through.
            <div
              key={stage.key}
              className={stage.current ? undefined : "ldc-hover-row"}
              style={{
                display: "flex",
                borderRadius: colors.radiusPill,
                background: stage.current ? colors.primary : undefined,
                flexShrink: 0,
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
                  padding: "0 9px",
                  borderRadius: colors.radiusPill,
                  background: "transparent",
                  color: stage.current
                    ? colors.onPrimary
                    : stage.done
                      ? colors.textSecondary
                      : colors.textMuted,
                  fontWeight: stage.current ? 600 : 400,
                  fontSize: 12,
                }}
              >
                {/* 序号、阶段名、勾与取值排在同一行：antd 按钮会把子节点再包
                    一层 span，行内间距交给这层自己撑，不用按钮的 gap
                    The index, stage name, check and value sit on one line: antd
                    wraps children in its own span, so this wrapper carries the
                    inline spacing instead of the button's gap. */}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span className="ldc-num" style={{ opacity: stage.current ? 0.7 : 1 }}>
                    {index + 1}
                  </span>
                  {t(STAGE_LABEL_KEYS[stage.key])}
                  {stage.done && !stage.current && (
                    // 已完成用成功色勾：状态色是全界面唯一的彩色来源
                    // A finished stage gets the success check — status colour is
                    // the only colour the shell spends.
                    <CheckOutlined style={{ fontSize: 11, color: colors.success }} />
                  )}
                  {value && (
                    <span
                      className="ldc-num"
                      style={{
                        fontSize: 11,
                        color: stage.current ? colors.onPrimary : colors.textMuted,
                        opacity: stage.current ? 0.8 : 1,
                      }}
                    >
                      {value}
                    </span>
                  )}
                </span>
              </Button>
            </div>
          );
        })}
        <span
          style={{
            fontSize: 11,
            color: colors.textMuted,
            marginLeft: "auto",
            paddingRight: 2,
            flexShrink: 0,
          }}
        >
          {t("sop.reuse_hint")}
        </span>
      </div>

      {blockers.length > 0 && (
        // 阻断行整条铺错误浅底：它是一处集中呈现，不是普通说明文字
        // The blocker row takes the soft error fill across its full width: it is
        // one consolidated warning, not ordinary caption text.
        <div
          data-testid="sop-blockers"
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            padding: "3px 10px 4px",
            background: colors.errorSoft,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 500, color: colors.error }}>
            <WarningOutlined style={{ fontSize: 11, marginRight: 4 }} />
            {t("sop.blocked_title")}
          </span>
          {blockers.map((blocker) => (
            <span key={blocker.key} style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <span style={{ fontSize: 11, color: colors.textSecondary }}>
                {t(blocker.labelKey)}
                {blocker.detail ? `（${blocker.detail}）` : ""}
              </span>
              <div
                className="ldc-hover-row"
                style={{ display: "flex", borderRadius: colors.radiusSm }}
              >
                <Button
                  size="small"
                  type="text"
                  data-testid={`sop-fix-${blocker.key}`}
                  onClick={() => onFix(blocker.fix)}
                  style={{
                    height: 20,
                    padding: "0 6px",
                    borderRadius: colors.radiusSm,
                    background: "transparent",
                    color: colors.error,
                    fontSize: 11,
                  }}
                >
                  {t(FIX_LABEL_KEYS[blocker.fix])}
                </Button>
              </div>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
