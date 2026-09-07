// 会话切换器（CONTEXT.md 术语）：助手边栏头部的会话管理控件。下拉按最近
// 活动列出本应用可恢复的 ACP 会话 + 新建按钮。omp ACP 握手未声明重命名/
// 删除能力，对应悬浮操作移除；没有可用元数据时只显示当前会话，不凭空
// 生成标题。有进行中回复或未决确认时整体禁用并提示等待。
// Session switcher (CONTEXT.md term): session management at the assistant
// sidebar header. The dropdown lists resumable ACP sessions by recent
// activity plus a new-session button. The omp ACP handshake declares no
// rename/delete capability, so those hover actions are gone; with no usable
// metadata only the current session is shown — no invented titles. Fully
// disabled with a wait hint while a reply is running or a confirmation is
// pending.

import { Button, Select, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { SessionMeta } from "./api";
import { useTranslation } from "../i18n";

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

  return (
    <Tooltip title={disabled ? t("assistant.session.switch_busy") : ""}>
      <div style={{ display: "flex", flex: 1, gap: 4, minWidth: 0 }}>
        <Select
          size="small"
          style={{ flex: 1, minWidth: 0 }}
          value={currentId ?? undefined}
          disabled={disabled}
          onChange={(id) => onSwitch(id)}
          options={options.map((s) => ({
            value: s.id,
            label: label(s),
          }))}
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
