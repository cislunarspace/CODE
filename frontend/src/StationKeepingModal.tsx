// 轨道保持独立执行模态弹窗：支持源工件注入、短弧参数适配与仿真时长覆盖拦截校验。
// 阻断判据用源记录的真实星历覆盖跨弧（catalog_get 推导，#416），取不到时
// 禁用执行并说明原因，不静默兜底。
// Station-keeping run modal: source-artifact injection, short-arc parameter adaptation, and
// duration-override validation. The gate uses the source record's real ephemeris span
// (derived via catalog_get, #416); when unavailable the run button is disabled with the
// reason shown — never a silent fallback.

import { useEffect, useState } from "react";
import { Modal, Form, InputNumber, Select, Alert, Space, Button, message } from "antd";
import { RocketOutlined } from "@ant-design/icons";
import { type CatalogRecord, catalogGet, ephemerisSpanDays } from "./catalogApi";
import type { ArtifactSummary } from "./projectApi";
import { invoke } from "@tauri-apps/api/core";

interface StationKeepingModalProps {
  open: boolean;
  sourceRecord: CatalogRecord | ArtifactSummary | null;
  onClose: () => void;
  /** 成功回调（#477）：携响应 data（含 controlled_ephemeris 等），由 App
   *  解析受控星历上画布；无 data 的旧调用方忽略参数即可。 */
  /** Success callback (#477): carries the response data (controlled_ephemeris
   *  etc.) for App to parse the controlled ephemeris onto the canvas; callers
   *  not using the data simply ignore the argument. */
  onSuccess: (data?: unknown) => void;
}

export function StationKeepingModal({
  open,
  sourceRecord,
  onClose,
  onSuccess,
}: StationKeepingModalProps) {
  const [controlInterval, setControlInterval] = useState<number>(0.25);
  const [feedbackArc, setFeedbackArc] = useState<number>(0.125);
  const [numControls, setNumControls] = useState<number>(120);
  const [numMonteCarlo, setNumMonteCarlo] = useState<number>(5);
  const [controlMode, setControlMode] = useState<number>(1);
  const [running, setRunning] = useState<boolean>(false);
  // 星历跨弧三态：loading / ok（spanDays 有值）/ unavailable（spanReason 说明）
  // Ephemeris-span tri-state: loading / ok (spanDays set) / unavailable (spanReason explains).
  const [spanDays, setSpanDays] = useState<number | null>(null);
  const [spanStatus, setSpanStatus] = useState<"loading" | "ok" | "unavailable">("loading");
  const [spanReason, setSpanReason] = useState<string>("");

  const recordId = sourceRecord
    ? String(
        (sourceRecord as CatalogRecord).record_id ||
          (sourceRecord as ArtifactSummary).recordId ||
          sourceRecord.artifactId,
      )
    : "";

  // 弹窗打开或源记录变化时取真实星历跨弧（catalog_get）
  // Fetch the real ephemeris span (catalog_get) when the modal opens or the source changes.
  useEffect(() => {
    if (!open || !recordId) {
      setSpanStatus("unavailable");
      setSpanReason("未绑定源星历记录");
      return;
    }
    let cancelled = false;
    setSpanStatus("loading");
    catalogGet(recordId)
      .then((res) => {
        if (cancelled) return;
        const span = ephemerisSpanDays(res);
        if (span === null) {
          setSpanDays(null);
          setSpanStatus("unavailable");
          setSpanReason("源记录无星历段（或数据不完整），无法评估覆盖范围");
        } else {
          setSpanDays(span);
          setSpanStatus("ok");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setSpanDays(null);
        setSpanStatus("unavailable");
        setSpanReason(`读取源记录失败: ${String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [open, recordId]);

  const requiredDurationDays = (numControls - 2) * controlInterval + feedbackArc;
  const isExceeded = spanStatus === "ok" && requiredDurationDays > (spanDays as number);
  const canRun = spanStatus === "ok" && !isExceeded;

  const handleExecute = async () => {
    if (!sourceRecord) return;
    setRunning(true);
    try {
      const recId = (sourceRecord as CatalogRecord).record_id || (sourceRecord as ArtifactSummary).recordId || sourceRecord.artifactId;
      const resp = await invoke<{ status: string; data?: any }>("run_tool", {
        tool: "control_orbit",
        arguments: {
          input_record_id: recId,
          control_interval: controlInterval,
          feedback_arc: feedbackArc,
          num_controls: numControls,
          num_monte_carlo: numMonteCarlo,
          control_mode: controlMode,
        },
        binaryDtype: null,
      });

      if (resp.status === "ok") {
        message.success("轨道保持仿真计算完成，产物已入库！");
        onSuccess(resp.data);
        onClose();
      } else {
        message.error(`计算失败: ${JSON.stringify(resp)}`);
      }
    } catch (e) {
      message.error(`执行出错: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const labelText = sourceRecord ? String((sourceRecord as CatalogRecord).orbit_family || sourceRecord.label) : "";
  const idText = sourceRecord ? String((sourceRecord as CatalogRecord).record_id || sourceRecord.artifactId) : "";

  return (
    <Modal
      title={
        <Space orientation="horizontal" size={6}>
          <RocketOutlined style={{ fontSize: 13, color: "var(--ldc-text-muted)" }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            轨道保持仿真评估 (Station Keeping)
          </span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      styles={{ body: { paddingTop: 4 } }}
      footer={[
        <Button key="cancel" size="small" onClick={onClose} disabled={running}>
          取消
        </Button>,
        <Button
          key="submit"
          size="small"
          type="primary"
          loading={running}
          disabled={!canRun}
          onClick={handleExecute}
        >
          开始仿真
        </Button>,
      ]}
      width={520}
    >
      {sourceRecord && (
        <Alert
          type="info"
          showIcon
          message={
            <span style={{ fontSize: 12 }}>
              已绑定源星历轨道: <strong>{labelText}</strong> (ID: {idText})
            </span>
          }
          style={{ marginBottom: 10 }}
        />
      )}

      {spanStatus === "loading" && (
        <Alert
          type="info"
          showIcon
          message={<span style={{ fontSize: 12 }}>正在读取源记录的星历覆盖范围...</span>}
          style={{ marginBottom: 10 }}
        />
      )}

      {spanStatus === "unavailable" && (
        <Alert
          type="warning"
          showIcon
          message={<span style={{ fontSize: 12 }}>无法确定源星历覆盖范围，执行已禁用</span>}
          description={<span style={{ fontSize: 11 }}>{spanReason}</span>}
          style={{ marginBottom: 10 }}
        />
      )}

      {isExceeded && (
        <Alert
          type="error"
          showIcon
          message={<span style={{ fontSize: 12 }}>仿真时长超出源星历覆盖范围</span>}
          description={
            <span style={{ fontSize: 11 }}>
              当前设置需要仿真时长约 {requiredDurationDays.toFixed(2)} 天，超出源星历覆盖范围（约{" "}
              {(spanDays as number).toFixed(2)} 天）。请调小控制次数或缩小控制间隔。
            </span>
          }
          style={{ marginBottom: 10 }}
        />
      )}

      <Form layout="vertical" size="small">
        <Form.Item label="控制模式 (Control Mode)" style={{ marginBottom: 10 }}>
          <Select
            value={controlMode}
            onChange={setControlMode}
            options={[
              { label: "1 目标点控制（宽松）", value: 1 },
              { label: "2 目标点控制（严格）", value: 2 },
              { label: "3 特征点控制", value: 3 },
              { label: "4 目标点控制 + 角动量管理", value: 4 },
              { label: "5 目标点严格控制 + 角动量管理", value: 5 },
              { label: "6 特征点控制 + 角动量管理", value: 6 },
            ]}
          />
        </Form.Item>

        <Space orientation="horizontal" style={{ width: "100%" }} size={12}>
          <Form.Item label="控制间隔 (天)" style={{ flex: 1, marginBottom: 10 }}>
            <InputNumber
              style={{ width: "100%" }}
              min={0.01}
              step={0.05}
              value={controlInterval}
              onChange={(v) => setControlInterval(v || 0.25)}
            />
          </Form.Item>
          <Form.Item label="反馈弧段 (天)" style={{ flex: 1, marginBottom: 10 }}>
            <InputNumber
              style={{ width: "100%" }}
              min={0.01}
              step={0.025}
              value={feedbackArc}
              onChange={(v) => setFeedbackArc(v || 0.125)}
            />
          </Form.Item>
        </Space>

        <Space orientation="horizontal" style={{ width: "100%" }} size={12}>
          <Form.Item label="控制次数 (N)" style={{ flex: 1, marginBottom: 10 }}>
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              max={10000}
              value={numControls}
              onChange={(v) => setNumControls(v || 120)}
            />
          </Form.Item>
          <Form.Item label="蒙特卡洛样本数" style={{ flex: 1, marginBottom: 10 }}>
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              max={1000}
              value={numMonteCarlo}
              onChange={(v) => setNumMonteCarlo(v || 5)}
            />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
