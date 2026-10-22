// 轨道信息面板（#476）：中栏「轨道信息」页签的内容——展示清单选中轨道的
// 详情（类型 / 数据系 / Jacobi / 点数 / 时间跨度 / 来源）。纯渲染组件：
// 字段由 buildOrbitInfo 装配好（本地化 + 格式化），无选中时给操作指引。
// 与 RecordDetailPanel 的边界：那只服务项目树选中的库记录（含编辑、调
// 目录 API）；清单条目可能是运行产物/候选弧，无记录可查，故独立轻量实现。
// Orbit info panel (#476): the content of the mid pane's "orbit info" tab —
// details of the trajectory selected in the orbit list (type / data frame /
// Jacobi / point count / time span / source). A pure renderer: fields arrive
// assembled by buildOrbitInfo (localized + formatted); without a selection it
// shows usage guidance. Boundary with RecordDetailPanel: that one serves
// tree-selected catalog records (with editing and catalog API calls); orbit
// list entries may be run products / candidate arcs with no record to fetch,
// hence this separate lightweight view.

import { Descriptions } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useTranslation } from "./i18n";
import type { OrbitInfoView } from "./orbitListItems";

export interface OrbitInfoPanelProps {
  /** 选中轨道的详情；null = 未选中（显示操作指引） */
  /** The selected orbit's details; null = nothing selected (show guidance). */
  info: OrbitInfoView | null;
}

export function OrbitInfoPanel({ info }: OrbitInfoPanelProps) {
  const { t } = useTranslation();
  if (!info) {
    return (
      <div data-testid="orbit-info-panel" className="ldc-empty">
        <InfoCircleOutlined className="ldc-empty-icon" />
        <span style={{ fontSize: 12 }}>{t("orbit_info.empty")}</span>
      </div>
    );
  }
  const fields: [string, string][] = [
    ...(info.kind ? [[t("orbit_info.kind"), info.kind] as [string, string]] : []),
    ...(info.frame ? [[t("orbit_info.frame"), info.frame] as [string, string]] : []),
    ...(info.jacobi !== undefined
      ? [[t("orbit_info.jacobi"), info.jacobi.toFixed(6)] as [string, string]]
      : []),
    [t("orbit_info.points"), String(info.points)],
    [t("orbit_info.time_span"), info.timeSpan ?? t("orbit_info.time_none")],
    [t("orbit_info.source"), info.source],
  ];
  return (
    <div data-testid="orbit-info-panel" style={{ padding: 12 }}>
      <Descriptions
        size="small"
        column={1}
        // 键值行不加冒号：标签已经是 11px 的弱化元数据，冒号只会多出一处噪点
        // No colon between label and value: the label is already a quiet 11px
        // metadata line and a colon only adds noise.
        colon={false}
        title={<span style={{ fontSize: 13, fontWeight: 600 }}>{info.label}</span>}
        styles={{
          title: { marginBottom: 8 },
          // 标签 11px 三级文字，值 12px 主文字，行间一条 hairline 分隔，与
          // 记录详情面板同一读法
          // 11px tertiary labels, 12px primary values, one hairline between rows,
          // the same reading pattern as the record detail panel.
          label: {
            width: 96,
            fontSize: 11,
            color: "var(--ldc-text-muted)",
            paddingBlock: 6,
            borderTop: "1px solid var(--ldc-border)",
          },
          content: {
            fontSize: 12,
            color: "var(--ldc-text)",
            fontVariantNumeric: "tabular-nums",
            paddingBlock: 6,
            borderTop: "1px solid var(--ldc-border)",
          },
        }}
        items={fields.map(([k, v]) => ({ key: k, label: k, children: v }))}
      />
    </div>
  );
}
