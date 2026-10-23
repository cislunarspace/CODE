// 画布工具栏：归拢投影/中心选择与适配/导出动画/图表设置操作，停靠于画布上方
// （替代原先分居画布两角的悬浮层）。四组选择控件（投影/视图系/绘制内容/中心）
// 之间以竖向分隔符分组（#450），窄窗口整组换行不拆散。
// Canvas toolbar: gathers projection/center selection and fit/export-animation/chart-settings actions,
// docked above the canvas (replacing the floating layers that used to sit in opposite corners).
// The four control groups (projection/view frame/content/center) are separated by
// vertical dividers (#450); on narrow windows whole groups wrap without splitting.

import { Button, Divider, Radio, Tooltip } from "antd";
import type { CSSProperties } from "react";
import {
  CompressOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
  SettingOutlined,
  SaveOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import type { ProjectionMode, CenterMode, FrameMode } from "./OrbitCanvas";
import type { ContentMode } from "./trajectoryParsing";
import { useTranslation } from "./i18n";

export interface CanvasToolbarProps {
  projection: ProjectionMode;
  center: CenterMode;
  /** 视图系（#428）：synodic 默认；inertial 下月心/L1/L2 居中禁用 */
  /** The view frame (#428): synodic by default; moon/L1/L2 centering disabled under inertial. */
  frame?: FrameMode;
  /** 绘制内容（eph-fig）：双段产物画哪段；all 双段同屏 */
  /** The content switch (eph-fig): which segment of a dual-segment product to draw; all shows both. */
  contentMode?: ContentMode;
  recording: boolean;
  onProjectionChange: (p: ProjectionMode) => void;
  onCenterChange: (c: CenterMode) => void;
  onFrameChange?: (f: FrameMode) => void;
  onContentModeChange?: (m: ContentMode) => void;
  onFitView: () => void;
  onExportAnimation: () => void;
  /** PNG 静态图导出（#450）：可选能力，未提供时按钮不渲染 */
  /** PNG still-image export (#450): optional — the button renders only when provided. */
  onExportPng?: () => void;
  onOpenSettings: () => void;
  /** 情景保存/打开（#429）：固定层记录集 + 参考历元 + 播放配置 */
  /** Scenario save/open (#429): pinned-layer record set + reference epoch + playback config. */
  onSaveScenario?: () => void;
  onOpenScenario?: () => void;
}

export function CanvasToolbar({
  projection,
  center,
  frame,
  contentMode,
  recording,
  onProjectionChange,
  onCenterChange,
  onFrameChange,
  onContentModeChange,
  onFitView,
  onExportAnimation,
  onExportPng,
  onOpenSettings,
  onSaveScenario,
  onOpenScenario,
}: CanvasToolbarProps) {
  const { t } = useTranslation();
  const inertial = frame === "inertial";
  // 分组竖线：宽 1px、高 14（约控件高度的六成），颜色取结构描边令牌，不抢控件
  // Group rule: 1px wide and 14 tall (about six tenths of the control height),
  // coloured with the structural border token so it never competes with controls.
  const groupSeparator: CSSProperties = {
    height: 14,
    margin: 0,
    borderInlineStartColor: "var(--ldc-border)",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        // 一行 32px：控件 24px + 上下各 4px 内边距
        // A 32px row: 24px controls plus 4px padding above and below.
        minHeight: 32,
        gap: 6,
        padding: "4px 8px",
        flexWrap: "wrap",
        rowGap: 6,
      }}
    >
      <Radio.Group
        size="small"
        value={projection}
        onChange={(e) => onProjectionChange(e.target.value as ProjectionMode)}
        buttonStyle="solid"
      >
        <Radio.Button value="3d">3D</Radio.Button>
        <Radio.Button value="xy">XY</Radio.Button>
        <Radio.Button value="xz">XZ</Radio.Button>
        <Radio.Button value="yz">YZ</Radio.Button>
      </Radio.Group>

      <Divider orientation="vertical" style={groupSeparator} />

      {/* 视图系切换（#428，ADR 0013：会合系 ⇄ 惯性 GCRS）：显示选择，
          不改任何数据与时刻语义 */}
      {/* The view-frame switch (#428, ADR 0013: synodic ⇄ inertial GCRS):
          a display choice that changes no data or time semantics. */}
      <Radio.Group
        size="small"
        value={frame ?? "synodic"}
        onChange={(e) => onFrameChange?.(e.target.value as FrameMode)}
        buttonStyle="solid"
      >
        <Radio.Button value="synodic">{t("toolbar.frame.synodic")}</Radio.Button>
        <Radio.Button value="inertial">{t("toolbar.frame.inertial")}</Radio.Button>
      </Radio.Group>

      <Divider orientation="vertical" style={groupSeparator} />

      {/* 绘制内容切换（eph-fig）：双段并存的产物（CR3BP 参考段 + 星历段）
          画哪段；无段语义的产物（转移弧、预报、族成员）不受影响 */}
      {/* The content switch (eph-fig): which segment of a dual-segment
          product (CR3BP reference + ephemeris arc) to draw; products without
          segment semantics (transfer arcs, propagations, family members)
          are unaffected. */}
      <Radio.Group
        size="small"
        value={contentMode ?? "all"}
        onChange={(e) => onContentModeChange?.(e.target.value as ContentMode)}
        buttonStyle="solid"
      >
        <Radio.Button value="all">{t("toolbar.content.all")}</Radio.Button>
        <Radio.Button value="cr3bp">{t("toolbar.content.cr3bp")}</Radio.Button>
        <Radio.Button value="ephemeris">{t("toolbar.content.ephemeris")}</Radio.Button>
      </Radio.Group>

      <Divider orientation="vertical" style={groupSeparator} />

      <Radio.Group
        size="small"
        value={center}
        onChange={(e) => onCenterChange(e.target.value as CenterMode)}
        buttonStyle="solid"
      >
        <Radio.Button value="barycenter">{t("toolbar.center.barycenter")}</Radio.Button>
        <Radio.Button value="earth">{t("toolbar.center.earth")}</Radio.Button>
        <Tooltip title={t("toolbar.center.moon_disabled_hint")}>
          <Radio.Button value="moon" disabled={inertial}>{t("toolbar.center.moon")}</Radio.Button>
        </Tooltip>
        <Tooltip title={t("toolbar.center.lp_disabled_hint")}>
          <Radio.Button value="l1" disabled={inertial}>L1</Radio.Button>
        </Tooltip>
        <Tooltip title={t("toolbar.center.lp_disabled_hint")}>
          <Radio.Button value="l2" disabled={inertial}>L2</Radio.Button>
        </Tooltip>
      </Radio.Group>

      {/* 叠加模式开关已由双层模型取代（结果层/固定层，钉住走项目树图钉） */}
      {/* The overlay-mode switch was superseded by the two-layer model (result/pinned layers; pinning lives in the project tree pushpin). */}

      <div style={{ flex: 1 }} />

      {onSaveScenario && (
        <Button
          size="small"
          icon={<SaveOutlined />}
          onClick={onSaveScenario}
          title={t("toolbar.save_scenario_title")}
        />
      )}
      {onOpenScenario && (
        <Button
          size="small"
          icon={<FolderOpenOutlined />}
          onClick={onOpenScenario}
          title={t("toolbar.open_scenario_title")}
        />
      )}
      <Button
        size="small"
        icon={<CompressOutlined />}
        onClick={onFitView}
        title={t("toolbar.fit_title")}
      >
        {t("toolbar.fit")}
      </Button>
      <Button
        size="small"
        icon={<VideoCameraOutlined />}
        loading={recording}
        onClick={onExportAnimation}
        title={t("toolbar.export_animation_title")}
      >
        {t("toolbar.export_animation")}
      </Button>
      {onExportPng && (
        <Button
          size="small"
          icon={<FileImageOutlined />}
          onClick={onExportPng}
          title={t("toolbar.export_png_title")}
        >
          {t("toolbar.export_png")}
        </Button>
      )}
      <Button
        size="small"
        icon={<SettingOutlined />}
        onClick={onOpenSettings}
        title={t("toolbar.settings_title")}
      />
    </div>
  );
}
