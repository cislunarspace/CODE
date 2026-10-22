// 项目树组件：基于 Ant Design Tree 与 Dropdown 实现右键菜单、勾选多选（绘制所选）、
// 星标与备注编辑、删除确认；分组头为文字+计数徽标，叶子挂结构化摘要第二行，
// 容器量高后启用虚拟滚动（#468）

import { useEffect, useRef, useState, type Key } from "react";
import { Tree, Dropdown, Modal, message, Button, Input, Tooltip, Badge } from "antd";
import type { MenuProps } from "antd";
import {
  RocketOutlined,
  DeleteOutlined,
  EditOutlined,
  StarFilled,
  StarOutlined,
  PushpinFilled,
  PushpinOutlined,
} from "@ant-design/icons";
import type { ArtifactSummary } from "./projectApi";
import { catalogDelete, catalogTag, catalogQuery, STAR_TAG } from "./catalogApi";
import { useTranslation } from "./i18n";

// 备注摘要截断长度（Tooltip 悬停显示）
const NOTE_PREVIEW_LEN = 80;

// 分组文案：纯文字，不用 emoji；计数走徽标（扁平克制，见 ADR 0037）
// Group labels: plain text, no emoji; counts live in a badge (flat and restrained,
// per ADR 0037).
const GROUP_LABELS: Record<string, string> = {
  orbit: "轨道",
  family: "轨道族",
  transfer: "转移",
  ephemeris: "星历",
};

// 受控展开初值：四个分组全部展开（去掉 defaultExpandAll，#468）
const GROUP_KEYS: Key[] = Object.keys(GROUP_LABELS).map((k) => `group_${k}`);

export interface ProjectTreeProps {
  artifacts: ArtifactSummary[];
  selectedId: string | null;
  onSelect: (a: ArtifactSummary | null) => void;
  onRemove: (artifactId: string) => void;
  onOpenStationKeeping?: (a: ArtifactSummary) => void;
  onRefresh?: () => void;
  /** 勾选 ≥2 条后点“绘制所选”：回传勾选的叶子集合 */
  onPlotSelected?: (items: ArtifactSummary[]) => void;
  /** 星标/备注保存成功后回传，供调用方同步树行数据 */
  onMetaChange?: (recordId: string, tags: string[], note?: string) => void;
  /** 已钉住（固定层）记录的 recordId 集合，行内图钉高亮 */
  pinnedRecordIds?: string[];
  /** 图钉切换：钉住 = 固定层持续显示；取消 = 移出固定层 */
  onTogglePin?: (a: ArtifactSummary) => void;
}

export function ProjectTree({
  artifacts,
  selectedId,
  onSelect,
  onRemove,
  onOpenStationKeeping,
  onRefresh,
  onPlotSelected,
  onMetaChange,
  pinnedRecordIds,
  onTogglePin,
}: ProjectTreeProps) {
  const { t } = useTranslation();
  // 勾选多选（父子联动）：与单击选中互不干扰
  const [checkedKeys, setCheckedKeys] = useState<Key[]>([]);
  // 受控展开（#468）：初始全展开，用户折叠后跨查询/刷新保持
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(GROUP_KEYS);
  // 编辑备注弹窗：目标行 + 草稿 + 保存时使用的当前 tags
  const [noteEditing, setNoteEditing] = useState<ArtifactSummary | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteTags, setNoteTags] = useState<string[] | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  // 容器量高（#468）：量得非零高度后传给 Tree 启用虚拟滚动；量不到
  // （jsdom 等环境）不传 height，回退全量渲染，行为不劣化
  const treeWrapRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(0);
  useEffect(() => {
    const el = treeWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setTreeHeight(el.clientHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const checkedItems = artifacts.filter((a) => checkedKeys.includes(a.artifactId));

  const isStarred = (a: ArtifactSummary) => (a.tags ?? []).includes(STAR_TAG);

  // 行数据缺 tags（会话产物）时先查详情取当前 tags，再整表替换
  const currentTagsOf = async (a: ArtifactSummary): Promise<string[]> => {
    if (a.tags) return a.tags;
    if (!a.recordId) return [];
    const resp = await catalogQuery({ record_id: a.recordId });
    return (resp.records[0]?.tags as string[] | undefined) ?? [];
  };

  // 星标切换：tags 含 ★ 则移除、不含则加入（note 不传 = 保留原注释）
  const handleToggleStar = async (a: ArtifactSummary) => {
    if (!a.recordId) return;
    try {
      const tags = await currentTagsOf(a);
      const next = tags.includes(STAR_TAG) ? tags.filter((x) => x !== STAR_TAG) : [...tags, STAR_TAG];
      await catalogTag(a.recordId, next);
      onMetaChange?.(a.recordId, next);
    } catch (e) {
      message.error(`${t("tree.star_toggle")}: ${String(e)}`);
    }
  };

  const openNoteEditor = async (a: ArtifactSummary) => {
    setNoteEditing(a);
    setNoteDraft(a.note ?? "");
    try {
      setNoteTags(await currentTagsOf(a));
    } catch {
      setNoteTags([]);
    }
  };

  const handleSaveNote = async () => {
    if (!noteEditing?.recordId) return;
    setSavingNote(true);
    try {
      const tags = noteTags ?? [];
      await catalogTag(noteEditing.recordId, tags, noteDraft);
      onMetaChange?.(noteEditing.recordId, tags, noteDraft);
      message.success(t("tree.note_saved"));
      setNoteEditing(null);
    } catch (e) {
      message.error(`${t("tree.note_save_failed")}: ${String(e)}`);
    } finally {
      setSavingNote(false);
    }
  };

  const treeData = Object.entries(GROUP_LABELS).map(([typeKey, label]) => {
    const items = artifacts.filter((a) => a.artifactType === typeKey);
    return {
      title: label,
      key: `group_${typeKey}`,
      count: items.length,
      selectable: false,
      children: items.map((item) => ({
        title: item.label,
        key: item.artifactId,
        isLeaf: true,
        data: item,
      })),
    };
  });

  const handleRightClick = (item: ArtifactSummary): MenuProps["items"] => {
    const hasEphemeris = item.artifactType === "ephemeris" || item.hasEphemeris === true;

    return [
      {
        key: "station_keeping",
        icon: <RocketOutlined />,
        label: "轨道保持...",
        disabled: !hasEphemeris,
        onClick: () => onOpenStationKeeping?.(item),
      },
      {
        key: "edit_note",
        icon: <EditOutlined />,
        label: t("tree.edit_note"),
        disabled: !item.recordId,
        onClick: () => openNoteEditor(item),
      },
      {
        type: "divider",
      },
      {
        key: "delete",
        icon: <DeleteOutlined />,
        danger: true,
        label: "永久删除 (物理删除文件)",
        onClick: () => {
          Modal.confirm({
            title: "确认物理删除",
            content: `确定要从磁盘永久删除轨道记录 ${item.label} (ID: ${item.recordId || item.artifactId}) 吗？此操作不可恢复。`,
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
            onOk: async () => {
              try {
                if (item.recordId) {
                  await catalogDelete([item.recordId]);
                }
                onRemove(item.artifactId);
                message.success("删除成功");
                onRefresh?.();
              } catch (e) {
                message.error(`删除失败: ${String(e)}`);
              }
            },
          });
        },
      },
    ];
  };

  return (
    <div style={{ fontSize: 12, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 勾选 ≥2 条时出现“绘制所选”入口；单击单条仍立即绘制 */}
      {checkedItems.length >= 2 && (
        <Button
          size="small"
          type="primary"
          style={{ marginBottom: 4, flexShrink: 0 }}
          onClick={() => onPlotSelected?.(checkedItems)}
        >
          {t("tree.plot_selected")} ({checkedItems.length})
        </Button>
      )}
      <div ref={treeWrapRef} style={{ flex: 1, minHeight: 0 }}>
        <Tree
          showIcon={false}
          height={treeHeight > 0 ? treeHeight : undefined}
          expandedKeys={expandedKeys}
          onExpand={(keys: Key[]) => setExpandedKeys(keys)}
          // 收起/展开直接显隐子行，不做位移过渡（ADR 0037 关闭位移动效）
          // Collapse and expand show or hide children directly, with no sliding
          // transition (ADR 0037 disables movement effects).
          motion={false}
          checkable
          selectedKeys={selectedId ? [selectedId] : []}
          checkedKeys={checkedKeys}
          onCheck={(checked: Key[] | { checked: Key[] }) => {
            setCheckedKeys(Array.isArray(checked) ? checked : checked.checked);
          }}
          treeData={treeData}
          onSelect={(keys, info: any) => {
            if (keys.length > 0 && info.node?.data) {
              onSelect(info.node.data as ArtifactSummary);
            } else {
              onSelect(null);
            }
          }}
          titleRender={(node: any) => {
            if (!node.data) {
              // 分组头（#468）：分区标签 + 计数徽标；空组整头褪到最弱的文字档
              // Group header (#468): a section label plus a count badge; an empty
              // group fades the whole header to the faintest text step.
              const empty = node.count === 0;
              return (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    className="ldc-section-label"
                    style={empty ? { color: "var(--ldc-text-faint)" } : undefined}
                  >
                    {node.title}
                  </span>
                  <Badge
                    count={node.count}
                    showZero
                    overflowCount={99999}
                    // 计数徽标：中性浅底、6px 圆角、11px 次级文字；空组褪成透明底
                    // Count badge: neutral fill, 6px radius, 11px secondary text; an
                    // empty group drops the fill altogether.
                    style={{
                      backgroundColor: empty ? "transparent" : "var(--ldc-muted-bg)",
                      color: empty ? "var(--ldc-text-faint)" : "var(--ldc-text-secondary)",
                      borderRadius: 6,
                      fontSize: 11,
                      fontVariantNumeric: "tabular-nums",
                      boxShadow: "none",
                    }}
                  />
                </span>
              );
            }
            const item = node.data as ArtifactSummary;
            const starred = isStarred(item);
            const pinned = !!item.recordId && (pinnedRecordIds ?? []).includes(item.recordId);
            // 第二行结构化摘要（#468）：成员序号 / L 点 / Jacobi，缺字段的部分不拼；
            // 全缺（会话产物行）不渲染第二行
            const summaryParts: string[] = [];
            if (item.memberIndex !== undefined && item.memberIndex !== null) {
              summaryParts.push(`成员 ${item.memberIndex}`);
            }
            if (item.librationPoint) summaryParts.push(`L${item.librationPoint}`);
            if (item.jacobi !== undefined && item.jacobi !== null) {
              summaryParts.push(`C ${Number(item.jacobi).toFixed(3)}`);
            }
            const labelSpan = (
              <span
                title={item.label}
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {item.label}
              </span>
            );
            return (
              <Dropdown menu={{ items: handleRightClick(item) }} trigger={["contextMenu"]}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    width: "100%",
                    gap: 2,
                    minWidth: 0,
                  }}
                >
                  {/* 图钉与星标：默认淡显，指针或键盘进入该行才浮现（.ldc-hover-actions）。
                      两个开关都不改选中、不冒泡触发树选中 */}
                  {/* Pin and star: faint by default, revealed when the pointer or
                      keyboard enters the row (.ldc-hover-actions). Neither changes the
                      selection nor bubbles into the tree selection. */}
                  <span
                    className="ldc-hover-actions"
                    style={{ display: "inline-flex", gap: 2, flexShrink: 0 }}
                  >
                    <span
                      role="button"
                      aria-label={t("tree.pin_toggle")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin?.(item);
                      }}
                      style={{
                        cursor: "pointer",
                        color: pinned ? "var(--ldc-primary)" : "var(--ldc-text-faint)",
                        fontSize: 12,
                        lineHeight: 1,
                        display: "inline-flex",
                        flexShrink: 0,
                      }}
                    >
                      {pinned ? <PushpinFilled /> : <PushpinOutlined />}
                    </span>
                    <span
                      role="button"
                      aria-label={t("tree.star_toggle")}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleStar(item);
                      }}
                      style={{
                        cursor: "pointer",
                        color: starred ? "var(--ldc-warning)" : "var(--ldc-text-faint)",
                        fontSize: 12,
                        lineHeight: 1,
                        display: "inline-flex",
                        flexShrink: 0,
                      }}
                    >
                      {starred ? <StarFilled /> : <StarOutlined />}
                    </span>
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    {item.note ? (
                      <Tooltip title={item.note.length > NOTE_PREVIEW_LEN ? `${item.note.slice(0, NOTE_PREVIEW_LEN)}…` : item.note}>
                        {labelSpan}
                      </Tooltip>
                    ) : (
                      labelSpan
                    )}
                    {summaryParts.length > 0 && (
                      <span
                        className="ldc-num"
                        style={{
                          fontSize: 11,
                          color: "var(--ldc-text-muted)",
                          lineHeight: 1.4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {summaryParts.join(" · ")}
                      </span>
                    )}
                  </div>
                </div>
              </Dropdown>
            );
          }}
        />
      </div>

      {/* 编辑备注：保存走 catalog_tag 整体替换（tags 用查得的当前值） */}
      <Modal
        title={<span style={{ fontSize: 14, fontWeight: 600 }}>{t("tree.edit_note")}</span>}
        open={!!noteEditing}
        onCancel={() => setNoteEditing(null)}
        onOk={handleSaveNote}
        confirmLoading={savingNote}
        okText={t("action.save")}
        cancelText={t("action.cancel")}
        width={450}
      >
        <Input.TextArea
          rows={4}
          value={noteDraft}
          placeholder={t("tree.note_placeholder")}
          onChange={(e) => setNoteDraft(e.target.value)}
        />
      </Modal>
    </div>
  );
}
