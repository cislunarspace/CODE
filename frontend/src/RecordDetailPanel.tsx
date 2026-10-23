// 记录详情面板：展示谱系、断链标记、物理属性，支持备注与标签 (catalog_tag)。
// e2m2e 5.9.3 一轨一记录后族成员即独立记录，族维度（family_id/member_index）
// 只展示不提升——catalog_promote 已随上游移除。

import { useState, useEffect } from "react";
import { Card, Descriptions, Tag, Input, Button, Space, Typography, message } from "antd";
import { EditOutlined, RocketOutlined } from "@ant-design/icons";
import { type CatalogRecord, catalogTag, STAR_TAG } from "./catalogApi";
import { neutralTagStyle } from "./theme";
import { useTranslation } from "./i18n";

const { Text } = Typography;

/** top-N 可行解候选的展示模型（#430）：App 从 transfer_design 响应映射，
 *  与画布层解耦——无轨迹降级的候选也在此列参数。 */
export interface TransferCandidateView {
  key: string;
  /** Δv 升序名次（1 起） */
  rank: number;
  deltaVKmS: number;
  /** 已格式化的 TLI 历元（未携带为占位符） */
  tliEpochText: string;
  /** 已格式化的飞行时间（未携带为占位符） */
  tofSecText: string;
  selected: boolean;
  /** 打靶精化（True）或网格估计（False）口径 */
  refined: boolean;
  /** 是否携带轨迹快照（无轨迹的不上画布，仅列参数） */
  hasTrajectory: boolean;
}

interface RecordDetailPanelProps {
  record: CatalogRecord | null;
  /** 最近一次 top_n 转移搜索的候选集（含选中解；恰一候选时 App 不传） */
  transferCandidates?: TransferCandidateView[];
  /** 树选中行的 label，标题联动回显（#468）；缺省保持原标题 */
  selectedLabel?: string | null;
  onRefresh?: () => void;
  onOpenStationKeeping?: (rec: CatalogRecord) => void;
}

export function RecordDetailPanel({ record, transferCandidates, selectedLabel, onRefresh, onOpenStationKeeping }: RecordDetailPanelProps) {
  const { t } = useTranslation();

  // hooks 规则（#437）：无论 record 是否为 null，每次渲染调用相同数量、
  // 相同顺序的 hooks；空态早返回必须在所有 hooks 之后。
  const [tagsInput, setTagsInput] = useState<string>("");
  const [noteInput, setNoteInput] = useState<string>("");
  const [savingTag, setSavingTag] = useState<boolean>(false);

  useEffect(() => {
    if (!record) return;
    setTagsInput((record.tags || []).join(", "));
    setNoteInput(record.note || "");
  }, [record?.record_id]);

  // 标题联动（#468）：带上树选中行的 label，空态与有记录态共用
  const detailTitle = selectedLabel ? `记录详情 · ${selectedLabel}` : "记录详情";

  if (!record) {
    return (
      <>
        {transferCandidates && transferCandidates.length > 0 && (
          <CandidateComparisonCard candidates={transferCandidates} />
        )}
        <Card
          size="small"
          title={<span style={{ fontSize: 12, fontWeight: 500 }}>{detailTitle}</span>}
          style={{ marginTop: 8 }}
        >
          <div className="ldc-empty">
            <Text type="secondary" style={{ fontSize: 12 }}>请在上方项目树或轨道库中选中一条记录查看详情。</Text>
          </div>
        </Card>
      </>
    );
  }

  const handleSaveAnnotation = async () => {
    setSavingTag(true);
    try {
      const raw = tagsInput.split(",").map((s) => s.trim()).filter(Boolean);
      // 星标 (★) 为保留值：编辑框输入的 ★ 剥离并提示，星标经项目树星形图标设置
      const tagList = raw.filter((tag) => tag !== STAR_TAG);
      if (tagList.length !== raw.length) {
        message.info(t("panel.star_reserved"));
      }
      await catalogTag(record.record_id, tagList, noteInput);
      message.success(t("panel.annotation_saved"));
      onRefresh?.();
    } catch (e) {
      message.error(`保存失败: ${String(e)}`);
    } finally {
      setSavingTag(false);
    }
  };

  const hasEphemeris = record.has_ephemeris;

  return (
    <>
    {transferCandidates && transferCandidates.length > 0 && (
      <CandidateComparisonCard candidates={transferCandidates} />
    )}
    <Card
      size="small"
      title={<span style={{ fontSize: 12, fontWeight: 500 }}>{detailTitle}</span>}
      style={{ marginTop: 8 }}
      styles={{ body: { padding: "8px 12px" } }}
    >
      <Descriptions
        size="small"
        column={1}
        bordered={false}
        // 键值行：标签 11px 三级文字，值 12px 主文字，行间一条 hairline。
        // 这里用三级文字而非表单字段的次级色：只读元数据的标签应比可编辑
        // 表单的标签更弱（表单标签见 .ldc-field-label）
        // Key/value rows: 11px tertiary labels, 12px primary values, one hairline
        // between rows. Tertiary rather than the form-label secondary tone: read-only
        // metadata labels should sit below editable field labels (see .ldc-field-label).
        styles={{
          label: {
            fontSize: 11,
            color: "var(--ldc-text-muted)",
            paddingBlock: 5,
            borderBottom: "1px solid var(--ldc-border)",
          },
          content: {
            fontSize: 12,
            paddingBlock: 5,
            borderBottom: "1px solid var(--ldc-border)",
          },
        }}
      >
        <Descriptions.Item label="ID">
          <Text copyable className="ldc-num" style={{ fontSize: 11 }}>{record.record_id}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="轨道族">
          <Tag style={neutralTagStyle}>{record.orbit_family || "未指定"}</Tag>
          {record.libration_point && (
            <Tag style={neutralTagStyle}>L{record.libration_point}</Tag>
          )}
        </Descriptions.Item>
        {record.jacobi !== undefined && (
          <Descriptions.Item label="Jacobi">
            <span className="ldc-num">{Number(record.jacobi).toFixed(4)}</span>
          </Descriptions.Item>
        )}
        {record.member_index !== undefined && (
          <Descriptions.Item label="族内序号">
            <span className="ldc-num">#{record.member_index}</span>
          </Descriptions.Item>
        )}
        {record.family_id && (
          <Descriptions.Item label="所属族批次">
            <Text className="ldc-num" style={{ fontSize: 11 }}>{record.family_id}</Text>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="动力学段">
          <Space orientation="horizontal" size={4}>
            {record.has_cr3bp && <Tag style={neutralTagStyle}>CR3BP</Tag>}
            {record.has_ephemeris && <Tag style={neutralTagStyle}>星历</Tag>}
          </Space>
        </Descriptions.Item>
        {record.source_record_id && (
          <Descriptions.Item label="上游谱系">
            <Text className="ldc-num" style={{ fontSize: 11 }}>{record.source_record_id}</Text>
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* 轨道保持入口 */}
      <div style={{ marginTop: 10 }}>
        <Button
          size="small"
          type="primary"
          icon={<RocketOutlined />}
          disabled={!hasEphemeris}
          title={hasEphemeris ? "以此轨道星历为基准进行轨道保持控制评估" : "该记录无星历段，无法开展轨道保持"}
          style={{ width: "100%" }}
          onClick={() => onOpenStationKeeping?.(record)}
        >
          开展轨道保持...
        </Button>
      </div>

      {/* 备注与标签（原“教学标注”，2026-08 更名） */}
      <div style={{ marginTop: 10, borderTop: "1px solid var(--ldc-border)", paddingTop: 8 }}>
        <Text style={{ fontSize: 11, fontWeight: 500, color: "var(--ldc-text-muted)" }}>
          {t("panel.annotation_title")}
        </Text>
        <Input
          size="small"
          placeholder="标签 (逗号分隔)"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          style={{ marginTop: 4 }}
        />
        <Input.TextArea
          size="small"
          rows={2}
          placeholder="笔记说明..."
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          style={{ marginTop: 4, fontSize: 12 }}
        />
        <Button
          size="small"
          icon={<EditOutlined />}
          loading={savingTag}
          onClick={handleSaveAnnotation}
          style={{ marginTop: 6, width: "100%" }}
        >
          保存标注
        </Button>
      </div>
    </Card>
    </>
  );
}

/** 可行解对比卡片（#430）：并列各候选 Δv/TLI/TOF，选中解与 refined 口径
 *  自述（混合口径共存时逐候选标注），无轨迹降级候选仅列参数。 */
function CandidateComparisonCard({ candidates }: { candidates: TransferCandidateView[] }) {
  const { t } = useTranslation();
  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 12, fontWeight: 500 }}>{t("panel.candidates_title")}</span>}
      styles={{ body: { padding: "4px 12px" } }}
    >
      {candidates.map((c) => (
        <div
          key={c.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            padding: "4px 0",
            borderBottom: "1px solid var(--ldc-border)",
          }}
        >
          <Text strong className="ldc-num" style={{ fontSize: 11, minWidth: 18 }}>#{c.rank}</Text>
          <Text code className="ldc-num" style={{ fontSize: 11 }}>Δv {c.deltaVKmS.toFixed(3)}</Text>
          <Text className="ldc-num" style={{ fontSize: 11 }}>TLI {c.tliEpochText}</Text>
          <Text className="ldc-num" style={{ fontSize: 11 }}>TOF {c.tofSecText}</Text>
          {c.selected ? (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>{t("panel.cand_selected")}</Tag>
          ) : null}
          <Tag style={neutralTagStyle}>
            {c.refined ? t("panel.cand_refined_true") : t("panel.cand_refined_false")}
          </Tag>
          {!c.hasTrajectory && (
            <Tag color="default" style={{ marginInlineEnd: 0 }}>{t("panel.cand_no_traj")}</Tag>
          )}
        </div>
      ))}
    </Card>
  );
}
