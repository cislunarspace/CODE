// 会话切换器（CONTEXT.md 术语）：助手边栏头部的会话管理控件。下拉按最近
// 活动列出本应用 pi 会话目录（Rust 目录扫描）+ 新建按钮，行内带相对时间
// 与消息数；选中态只显示标题。pi RPC 无重命名/删除命令，悬浮操作移除；
// 没有可用元数据时只显示当前会话，不凭空生成标题。有进行中回复或未决
// 确认时整体禁用并提示等待。

import { Button, Select, Tooltip, theme } from "antd";
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
  // 下拉浮层挂在 body 上，拿不到应用根容器上的 --ldc-* 变量，所以行内文字色
  // 取 antd token：当前会话底与悬停底由 ConfigProvider 的 controlItemBgActive
  // / controlItemBgHover 统一给出，与页面选中态同色。
  // The dropdown portal lives under body and cannot see the --ldc-* variables set
  // on the app root, so the row text colours come from antd tokens; the selected
  // and hover fills come from controlItemBgActive / controlItemBgHover in the
  // ConfigProvider, matching the app's selected state.
  const { token } = theme.useToken();

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
          style={{
            flex: 1,
            minWidth: 0,
            height: 24,
            borderRadius: "var(--ldc-radius-sm)",
            fontSize: 11,
          }}
          value={currentId ?? undefined}
          disabled={disabled}
          onChange={(id) => onSwitch(id)}
          options={options.map((s) => ({ value: s.id, label: label(s) }))}
          optionRender={(option) => {
            const s = options.find((x) => x.id === option.value);
            if (!s) return option.label;
            return (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {label(s)}
                </span>
                {/* 行内元数据（消息数 · 相对时间）压到 10px 与最弱一级文字色，
                    标题仍是行内主角 */}
                {/* Inline metadata (message count · relative time) drops to 10px in
                    the weakest text colour so the title stays the row's subject. */}
                <span
                  className="ldc-num"
                  style={{ color: token.colorTextQuaternary, fontSize: 10, flexShrink: 0 }}
                >
                  {meta(s)}
                </span>
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
          style={{ borderRadius: "var(--ldc-radius-sm)" }}
        />
      </div>
    </Tooltip>
  );
}
