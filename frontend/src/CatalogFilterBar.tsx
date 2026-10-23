// 轨道库过滤栏

import { useEffect, useRef, useState } from "react";
import { Form, Select, InputNumber, Button, Space, message, Modal, Input, Switch, Tag } from "antd";
import { SearchOutlined, DownloadOutlined, RedoOutlined } from "@ant-design/icons";
import { catalogQuery, catalogExport, STAR_TAG } from "./catalogApi";
import type { CatalogRecord } from "./catalogApi";
import { neutralTagStyle } from "./theme";
import { useTranslation } from "./i18n";
import type { ArtifactSummary } from "./projectApi";

// 字段标签走 ldc.css 的 .ldc-field-label（11px 次级色），与参数停靠、弹窗共用一条规则
// Field labels use .ldc-field-label from ldc.css (11px secondary), the same rule
// shared by the parameter dock and the dialogs.

export interface CatalogFilterBarProps {
  onResults: (artifacts: ArtifactSummary[], count: number, message: string) => void;
}

export function CatalogFilterBar({ onResults }: CatalogFilterBarProps) {
  const { t } = useTranslation();
  const [family, setFamily] = useState<string | undefined>(undefined);
  const [libration, setLibration] = useState<number | undefined>(undefined);
  const [jacobiMin, setJacobiMin] = useState<number | undefined>(undefined);
  const [jacobiMax, setJacobiMax] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // 仅看星标：纯前端过滤最近一次查询结果，不重发请求
  const [starOnly, setStarOnly] = useState(false);
  // 最近一次结果条数（含仅星标过滤后），驱动状态行回显（#468）
  const [resultCount, setResultCount] = useState<number | null>(null);
  const lastRecordsRef = useRef<CatalogRecord[]>([]);

  // 查询结果 → 树数据源（星标过滤 + 富化字段透传给树行第二行摘要；
  // label 只留族名，序号等结构化信息由第二行承载，#468）。5.9.3 一轨一
  // 记录后族成员记录也是单条轨道，统一入 orbit 组。
  const publish = (records: CatalogRecord[], fallbackMessage?: string) => {
    const visible = starOnly
      ? records.filter((r) => (r.tags ?? []).includes(STAR_TAG))
      : records;
    setResultCount(visible.length);
    onResults(
      visible.map((r) => ({
        artifactId: String(r.record_id ?? ""),
        artifactType: "orbit",
        label: String(r.orbit_family ?? ""),
        orbitType: String(r.orbit_family ?? ""),
        sourceTool: String(r.source_tool ?? ""),
        recordId: (r.record_id as string) ?? null,
        createdAt: String(r.created_at ?? ""),
        hasEphemeris: Boolean(r.has_ephemeris),
        tags: r.tags ?? [],
        note: r.note ?? "",
        librationPoint: r.libration_point,
        jacobi: r.jacobi,
        memberIndex: r.member_index,
      })),
      visible.length,
      fallbackMessage || `查询到 ${visible.length} 条记录`,
    );
  };

  const executeQuery = async () => {
    setBusy(true);
    try {
      const filters: Record<string, unknown> = {};
      if (family) filters.orbit_family = family;
      if (libration) filters.libration_point = libration;
      if (jacobiMin !== undefined) filters.jacobi_min = jacobiMin;
      if (jacobiMax !== undefined) filters.jacobi_max = jacobiMax;

      const resp = await catalogQuery(filters);
      const records = resp.records || [];
      lastRecordsRef.current = records;
      publish(records, resp.message);
    } catch (e) {
      message.error(`查询失败: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    executeQuery();
  }, []);

  // 星标开关切换：对已查得的记录重过滤（publish 闭包取当次渲染的 starOnly）
  useEffect(() => {
    if (lastRecordsRef.current.length > 0) {
      publish(lastRecordsRef.current);
    }
  }, [starOnly]);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportDest, setExportDest] = useState("./export_package.zip");
  const [exporting, setExporting] = useState(false);

  const handleExportPackage = async () => {
    setExporting(true);
    try {
      const filters: Record<string, unknown> = {};
      if (family) filters.orbit_family = family;
      if (libration) filters.libration_point = libration;
      if (jacobiMin !== undefined) filters.jacobi_min = jacobiMin;
      if (jacobiMax !== undefined) filters.jacobi_max = jacobiMax;

      const count = await catalogExport(filters, exportDest);
      message.success(`成功导出 ${count} 条轨道记录到 ${exportDest}`);
      setExportModalOpen(false);
    } catch (e) {
      message.error(`导出失败: ${String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleReset = () => {
    setFamily(undefined);
    setLibration(undefined);
    setJacobiMin(undefined);
    setJacobiMax(undefined);
  };

  return (
    <div style={{ marginBottom: 12, flexShrink: 0 }}>
      <Form layout="vertical" size="small">
        <Form.Item label={<span className="ldc-field-label">轨道族类型</span>} style={{ marginBottom: 6 }}>
          <Select
            allowClear
            placeholder="不限族"
            value={family}
            onChange={setFamily}
            options={[
              { label: "Halo", value: "HALO" },
              { label: "NRHO", value: "NRHO" },
              { label: "Axial", value: "AXIAL" },
              { label: "Lissajous", value: "LISSAJOUS" },
              { label: "DRO", value: "DRO" },
              { label: "DPO", value: "DPO" },
              { label: "SPO", value: "SPO" },
              { label: "LPO", value: "LPO" },
              { label: "Horseshoe", value: "HORSESHOE" },
            ]}
          />
        </Form.Item>

        <Form.Item label={<span className="ldc-field-label">平动点</span>} style={{ marginBottom: 6 }}>
          <Select
            allowClear
            placeholder="不限平动点"
            value={libration}
            onChange={setLibration}
            options={[
              { label: "L1", value: 1 },
              { label: "L2", value: 2 },
              { label: "L3", value: 3 },
              { label: "L4", value: 4 },
              { label: "L5", value: 5 },
            ]}
          />
        </Form.Item>

        <Form.Item label={<span className="ldc-field-label">{t("catalog.star_only")}</span>} style={{ marginBottom: 6 }}>
          <Switch size="small" checked={starOnly} onChange={setStarOnly} />
        </Form.Item>

        <Space orientation="horizontal" style={{ width: "100%", marginBottom: 8 }} size={6}>
          <Form.Item label={<span className="ldc-field-label">Jacobi 下限</span>} style={{ marginBottom: 0, flex: 1 }}>
            <InputNumber
              className="ldc-num"
              style={{ width: "100%" }}
              step={0.05}
              placeholder="Min"
              value={jacobiMin}
              onChange={(v) => setJacobiMin(v ?? undefined)}
            />
          </Form.Item>
          <Form.Item label={<span className="ldc-field-label">Jacobi 上限</span>} style={{ marginBottom: 0, flex: 1 }}>
            <InputNumber
              className="ldc-num"
              style={{ width: "100%" }}
              step={0.05}
              placeholder="Max"
              value={jacobiMax}
              onChange={(v) => setJacobiMax(v ?? undefined)}
            />
          </Form.Item>
        </Space>

        <Space orientation="horizontal" style={{ width: "100%" }} size={6}>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={busy}
            onClick={executeQuery}
            style={{ flex: 1 }}
          >
            查询
          </Button>
          <Button icon={<RedoOutlined />} onClick={handleReset} title="重置过滤条件" />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => setExportModalOpen(true)}
            title="导出教学案例包"
          >
            导出包
          </Button>
        </Space>

        {/* 状态行（#468）：结果计数与活动条件显式回显，仅星标状态一并上屏 */}
        {resultCount !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
              marginTop: 2,
            }}
          >
            <span className="ldc-num" style={{ fontSize: 11, color: "var(--ldc-text-secondary)" }}>
              共 {resultCount} 条
            </span>
            {starOnly && (
              <Tag style={neutralTagStyle}>{t("catalog.star_only")}</Tag>
            )}
            {family && <Tag style={neutralTagStyle}>{family}</Tag>}
            {libration && <Tag style={neutralTagStyle}>L{libration}</Tag>}
            {(jacobiMin !== undefined || jacobiMax !== undefined) && (
              <Tag style={neutralTagStyle}>
                {`C ∈ [${jacobiMin !== undefined ? String(jacobiMin) : "-∞"}, ${
                  jacobiMax !== undefined ? String(jacobiMax) : "+∞"
                }]`}
              </Tag>
            )}
          </div>
        )}
      </Form>

      <Modal
        title={<span style={{ fontSize: 14, fontWeight: 600 }}>导出教学案例包 (Catalog Export)</span>}
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        styles={{ body: { paddingTop: 4 } }}
        width={450}
        footer={[
          <Button key="cancel" size="small" onClick={() => setExportModalOpen(false)}>
            取消
          </Button>,
          <Button
            key="export"
            size="small"
            type="primary"
            loading={exporting}
            onClick={handleExportPackage}
          >
            开始打包导出
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 8, fontSize: 12, color: "var(--ldc-text-secondary)" }}>
          将根据当前过滤条件将匹配的轨道记录打包并导出到指定路径。
        </div>
        <Form layout="vertical" size="small">
          <Form.Item label={<span className="ldc-field-label">目标保存路径 (zip 或目录)</span>}>
            <Input
              value={exportDest}
              onChange={(e) => setExportDest(e.target.value)}
              placeholder="./catalog_export.zip"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
