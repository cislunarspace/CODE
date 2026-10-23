// 导出动画设置弹窗（#455）：模式（自转/时间轴播放）与时长（2–30 秒）。
// 确认携带参数回调、取消无副作用；量程不可用时时间轴模式禁用并注明原因。
// 视觉遵循 ADR 0037（LDC 令牌：中性主色、8px 圆角、平面化）。
// Export-animation settings modal (#455): mode (spin / timeline playback) and
// duration (2–30 s). Confirm reports the options, cancel has no side effects;
// with no timeline range the timeline mode is disabled with a reason.
// Visuals follow ADR 0037 (LDC tokens: neutral primary, 8px radii, flat).

import { useState } from "react";
import { Button, Form, Modal, Radio, Slider, Typography } from "antd";
import { useTranslation } from "./i18n";

const { Text } = Typography;

export type AnimationExportMode = "spin" | "timeline";

export interface AnimationExportOptions {
  mode: AnimationExportMode;
  durationSec: number;
}

export interface AnimationExportModalProps {
  open: boolean;
  /** 时间轴量程：null = 不可用（无带历元产物），时间轴模式禁用（故事 7） */
  /** The timeline range: null = unavailable (no epoch-bearing product), the
   *  timeline mode is disabled (story 7). */
  timeRange: [number, number] | null;
  onClose: () => void;
  /** 确认导出：携带模式与时长（App 由此驱动录制与时刻扫描） */
  /** Confirm export: carries mode and duration (App drives recording and the
   *  moment sweep from these). */
  onExport: (options: AnimationExportOptions) => void;
}

export function AnimationExportModal({ open, timeRange, onClose, onExport }: AnimationExportModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AnimationExportMode>("spin");
  const [durationSec, setDurationSec] = useState(8);
  const timelineAvailable = timeRange !== null && timeRange[1] > timeRange[0];

  return (
    <Modal
      title={<span style={{ fontSize: 14, fontWeight: 600 }}>{t("anim.title")}</span>}
      open={open}
      onCancel={onClose}
      width={430}
      styles={{ body: { paddingTop: 4 } }}
      footer={[
        <Button key="cancel" size="small" onClick={onClose}>
          {t("action.cancel")}
        </Button>,
        <Button key="export" size="small" type="primary" onClick={() => onExport({ mode, durationSec })}>
          {t("anim.export")}
        </Button>,
      ]}
    >
      <Form layout="vertical" size="small">
        <Form.Item label={t("anim.mode")} style={{ marginBottom: 10 }}>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as AnimationExportMode)}
          >
            <Radio value="spin">{t("anim.mode.spin")}</Radio>
            <Radio value="timeline" disabled={!timelineAvailable}>
              {t("anim.mode.timeline")}
            </Radio>
          </Radio.Group>
        </Form.Item>
        {!timelineAvailable && (
          <Text style={{ fontSize: 11, color: "var(--ldc-text-muted)" }}>
            {t("anim.timeline_unavailable")}
          </Text>
        )}
        <Form.Item label={t("anim.duration")} style={{ marginBottom: 10 }}>
          <Slider
            min={2}
            max={30}
            value={durationSec}
            onChange={(v) => setDurationSec(v)}
            marks={{ 2: "2s", 8: "8s", 30: "30s" }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
