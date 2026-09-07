// 会话切换器（CONTEXT.md 术语）：助手边栏头部的会话管理控件。下拉按最近
// 活动列出本应用可恢复的 ACP 会话 + 新建按钮，行内带相对时间与消息数；
// 选中态只显示标题。omp ACP 握手未声明重命名/删除能力，对应悬浮操作移除；
// 没有可用元数据时只显示当前会话，不凭空生成标题。有进行中回复或未决
// 确认时整体禁用并提示等待。

import { Button, Select, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { SessionMeta } from "./api";
import { useTranslation } from "../i18n";

/** 相对时间（中文）：刚刚 / N 分钟前 / N 小时前 / N 天前；无时刻返回空串。 */
function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
}

export function SessionSwitcher({
  sessions,
  currentId,
  disabled,
  onSwitch,
  onNew,
}: {
  sessions: SessionMeta[];
  currentId: string | null;
  /** 有进行中回复或未决确认（切换门禁的前端对应） */
  disabled: boolean;
  onSwitch: (id: string) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();

  // 首次使用（列表为空）时下拉也要能显示当前会话本体
  const options = sessions.some((s) => s.id === currentId)
    ? sessions
    : currentId
      ? [...sessions, { id: currentId, title: null, updatedAt: null, messageCount: null }]
      : sessions;

  const label = (s: SessionMeta) => s.title || t("assistant.session.untitled");
  const meta = (s: SessionMeta) => {
    const parts = [
      s.messageCount != null ? `${s.messageCount} 条` : "",
      relativeTime(s.updatedAt),
    ];
    return parts.filter(Boolean).join(" · ");
  };

  return (
    <Tooltip title={disabled ? t("assistant.session.switch_busy") : ""}>
      <div style={{ display: "flex", flex: 1, gap: 4, minWidth: 0 }}>
        <Select
          size="small"
          style={{ flex: 1, minWidth: 0 }}
          value={currentId ?? undefined}
          disabled={disabled}
          onChange={(id) => onSwitch(id)}
          options={options.map((s) => ({ value: s.id, label: label(s) }))}
          optionRender={(option) => {
            const s = options.find((x) => x.id === option.value);
            if (!s) return option.label;
            return (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {label(s)}
                </span>
                <span style={{ opacity: 0.55, fontSize: 11, flexShrink: 0 }}>{meta(s)}</span>
              </div>
            );
          }}
          popupMatchSelectWidth={false}
        />
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={disabled}
          onClick={onNew}
          title={t("assistant.session.new")}
        />
      </div>
    </Tooltip>
  );
}
