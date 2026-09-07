// 助手边栏（CONTEXT.md 术语：助手边栏）：右侧可折叠、可拖宽的人机交互
// 面板。负责：折叠/宽度持久化、omp 未安装空态引导、会话恢复（回放事件
// 流重建）、live 事件折叠、发送/清空。会话与 agent loop 在 omp（ACP），
// 这里只做显示与交互转发。
// Assistant sidebar (CONTEXT.md term): the collapsible, drag-resizable
// human-interaction panel on the right. Handles: collapse/width persistence,
// the omp-not-installed empty state, session restore (replay event stream
// rebuilds the timeline), folding the live event stream, send/clear. The
// session and agent loop live in omp (ACP); this only renders and forwards.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Popconfirm, Segmented, Spin, Tooltip, Typography, message } from "antd";
import {
  ClearOutlined,
  DoubleRightOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  assistantCancel,
  assistantClearHistory,
  assistantGetState,
  assistantNewSession,
  assistantSend,
  assistantSetThinkingLevel,
  assistantSwitchSession,
  onAssistantEvent,
  type SelectionContext,
  type SessionMeta,
  type ThinkingLevel,
} from "./api";
import { ChatView } from "./ChatView";
import { SessionSwitcher } from "./SessionSwitcher";
import { ResizeHandle } from "../ResizeHandle";
import { useTranslation } from "../i18n";
import { foldEvent, type ChatItem } from "./chatModel";
const { Text } = Typography;

const COLLAPSED_KEY = "tod-assistant-collapsed";
const WIDTH_KEY = "tod-assistant-width";
/** 最近会话 id 的前端索引（消息内容永不复制：正文在 omp 会话里） */
const LAST_SESSION_KEY = "tod-assistant-last-session";
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 280;
const MAX_WIDTH = 620;

export function AssistantSidebar({
  selection,
  onArtifactProduced,
  onOpenRecord,
  onApplyScenario,
  onOpenSettings,
}: {
  selection: SelectionContext | null;
  /** A1 语义：AI 产物自动入项目树（tool_done 携带 record_id 时触发，App 内去重登记） */
  onArtifactProduced: (recordId: string, tool: string) => void;
  /** 工具卡片"查看产物"按钮：画布绘图（复用 getArtifact 通道） */
  onOpenRecord: (recordId: string, tool: string) => void;
  /** 工具卡片"应用情景"按钮（ADR 0027）：App 按路径打开情景 */
  onApplyScenario?: (path: string) => void;
  /** 打开设置弹窗（空态"去设置"按钮的落点） */
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const [width, setWidth] = useState<number>(() => {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return raw >= MIN_WIDTH && raw <= MAX_WIDTH ? raw : DEFAULT_WIDTH;
  });
  const [available, setAvailable] = useState<boolean | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("standard");
  // 最新回调经 ref 持有：事件订阅只建一次，回调随渲染更新
  const producedRef = useRef(onArtifactProduced);
  producedRef.current = onArtifactProduced;

  // 初始载入：omp 可用性 + 会话索引 + 上次会话（有则触发回放重建）
  const loadState = useCallback(async () => {
    try {
      const info = await assistantGetState();
      setAvailable(info.ompConfigured);
      setSessions(info.sessions);
      setCurrentSessionId(info.sessionId);
      setThinkingLevel(info.thinkingLevel);
      setRunning(info.running);
      return info;
    } catch {
      setAvailable(false);
      return null;
    }
  }, []);

  // 上次会话恢复：后端当前为空时按 localStorage 索引切换（回放重建）；
  // 会话已不存在则清掉索引，保持新会话空态
  const restoreLastSession = useCallback(async () => {
    const last = localStorage.getItem(LAST_SESSION_KEY);
    if (!last) return;
    try {
      await assistantSwitchSession(last);
    } catch {
      localStorage.removeItem(LAST_SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const info = await loadState();
      if (info?.ompConfigured && !info.sessionId) {
        await restoreLastSession();
        await loadState();
      }
    })();
  }, [loadState, restoreLastSession]);

  // 订阅 ACP 事件流（delta / tool_* / user_message / reset / error）。
  // tool_done 携带 record_id 时触发 A1 自动登记入项目树。
  useEffect(() => {
    // listen 是异步的：StrictMode 双挂载（挂载→清理→再挂载）下，清理先于
    // promise resolve 执行，若只靠 unlisten 变量，首挂载的监听器会泄漏——
    // 每个事件被处理两次（delta 逐字重复）。用 cancelled 标记：清理之后
    // 才 resolve 的监听器立即退订。
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onAssistantEvent((payload) => {
      setItems((prev) => foldEvent(prev, payload));
      if (payload.kind === "tool_done" && payload.ok && payload.summary?.recordId) {
        producedRef.current?.(payload.summary.recordId, payload.tool);
      }
    }).then((u) => {
      if (cancelled) {
        u();
        return;
      }
      unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    // 展开时刷新一次状态（可能在设置弹窗里刚配置过 omp）
    if (!next) void loadState();
  };

  const sendText = async (text: string) => {
    if (!text || running) return;
    setDraft("");
    // 用户气泡经事件流回显（与回放同一路径），这里不本地补
    setRunning(true);
    try {
      // 命令在整轮结束时返回；期间事件经 assistant-event 流入。
      // 运行期错误已由 error 事件气泡呈现，这里不再重复 toast。
      await assistantSend(text, selection);
      if (!localStorage.getItem(LAST_SESSION_KEY)) {
        const info = await assistantGetState();
        if (info.sessionId) {
          localStorage.setItem(LAST_SESSION_KEY, info.sessionId);
          setCurrentSessionId(info.sessionId);
          setSessions(info.sessions);
        }
      }
    } catch (e) {
      console.error("assistant send failed:", e);
      // 命令异常（区别于运行期错误事件）：草稿回填输入框（#450）。
      // 运行期输入框禁用必为空；守卫仅在为空时回填，不覆盖用户新输入。
      setDraft((cur) => (cur === "" ? text : cur));
    } finally {
      setRunning(false);
    }
  };

  const handleSend = () => sendText(draft.trim());

  // 中断续跑（#461）：以固定引导文本作为普通用户消息发送——运行态、
  // 事件流全部复用（真中断由 ACP cancelled 驱动，不再有假中断协议）。
  const handleContinue = () => {
    void sendText(t("assistant.continue_prompt"));
  };

  const handleClear = async () => {
    try {
      await assistantClearHistory();
      void loadState();
    } catch (e) {
      message.error(String(e));
    }
  };

  // 会话结构操作统一走「操作 → 重载状态」：后端是唯一事实源。操作失败
  // （门禁拦截等）提示等待。
  const withReload = async (action: () => Promise<unknown>) => {
    try {
      await action();
      const info = await loadState();
      if (info?.sessionId) localStorage.setItem(LAST_SESSION_KEY, info.sessionId);
    } catch (e) {
      message.error(String(e));
    }
  };

  // 切换门禁的前端对应：有进行中回复或未决确认卡片时禁用切换器
  const switchBusy =
    running || items.some((i) => i.kind === "tool" && i.card.status === "proposed");

  const handleLevel = async (level: ThinkingLevel) => {
    const prev = thinkingLevel;
    setThinkingLevel(level); // 乐观更新，失败回滚
    try {
      await assistantSetThinkingLevel(level);
    } catch (e) {
      setThinkingLevel(prev);
      message.error(String(e));
    }
  };

  // 折叠态：右边缘一条常显入口按钮（omp 不可用小圆点提示）
  if (collapsed) {
    return (
      <div
        style={{
          width: 36,
          borderLeft: "1px solid var(--tod-border, #e8e8e8)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 8,
          background: "var(--tod-panel-bg, transparent)",
        }}
      >
        <Tooltip title={t("assistant.title")} placement="left">
          <Button
            type="text"
            icon={<RobotOutlined />}
            onClick={() => toggleCollapsed(false)}
            style={{ position: "relative" }}
          >
            {available === false && (
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#faad14",
                }}
              />
            )}
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      style={{
        width,
        borderLeft: "1px solid var(--tod-border, #e8e8e8)",
        display: "flex",
        flexDirection: "column",
        background: "var(--tod-panel-bg, transparent)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      {/* 左缘拖拽调宽手柄（共享组件，#454） */}
      <ResizeHandle
        edge="left"
        width={width}
        min={MIN_WIDTH}
        max={MAX_WIDTH}
        onResize={setWidth}
        onResizeEnd={(w) => localStorage.setItem(WIDTH_KEY, String(w))}
      />

      {/* 头部：标题 + 会话切换器 + 清空 + 折叠 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 8px",
          borderBottom: "1px solid var(--tod-border, #e8e8e8)",
        }}
      >
        <RobotOutlined />
        <Text strong style={{ fontSize: 13, flexShrink: 0 }}>
          {t("assistant.title")}
        </Text>
        {available && (
          <SessionSwitcher
            sessions={sessions}
            currentId={currentSessionId}
            disabled={switchBusy}
            onSwitch={(id) => withReload(() => assistantSwitchSession(id))}
            onNew={() => withReload(() => assistantNewSession())}
          />
        )}
        {/* 清空不可逆：Popconfirm 拦一道（#450） */}
        <Popconfirm
          title={t("assistant.clear_confirm")}
          okText={t("assistant.clear_confirm_ok")}
          cancelText={t("action.cancel")}
          onConfirm={handleClear}
        >
          <Tooltip title={t("assistant.clear")}>
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              aria-label={t("assistant.clear")}
            />
          </Tooltip>
        </Popconfirm>
        <Tooltip title={t("assistant.collapse")}>
          <Button
            type="text"
            size="small"
            icon={<DoubleRightOutlined />}
            onClick={() => toggleCollapsed(true)}
          />
        </Tooltip>
      </div>

      {available === null ? (
        // 可用性加载中
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Spin size="small" />
        </div>
      ) : available === false ? (
        // 空态引导：omp 未安装/不可执行
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          <RobotOutlined style={{ fontSize: 32, opacity: 0.4 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("assistant.empty_omp")}
          </Text>
          <Button type="primary" icon={<SettingOutlined />} onClick={onOpenSettings}>
            {t("assistant.go_settings")}
          </Button>
        </div>
      ) : (
        <>
          <ChatView
            items={items}
            running={running}
            onOpenRecord={onOpenRecord}
            onApplyScenario={onApplyScenario}
            onContinue={running ? undefined : handleContinue}
          />
          {/* 输入区：思考等级三档单选 + 运行中禁用输入（单并发门禁的 UI） */}
          <div
            style={{
              padding: 8,
              borderTop: "1px solid var(--tod-border, #e8e8e8)",
            }}
          >
            <Tooltip title={t("assistant.level.label")}>
              <Segmented
                size="small"
                value={thinkingLevel}
                disabled={running}
                onChange={(v) => handleLevel(v as ThinkingLevel)}
                options={[
                  { label: t("assistant.level.off"), value: "off" },
                  { label: t("assistant.level.standard"), value: "standard" },
                  { label: t("assistant.level.deep"), value: "deep" },
                ]}
              />
            </Tooltip>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <Input.TextArea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("assistant.input_placeholder")}
                autoSize={{ minRows: 1, maxRows: 5 }}
                disabled={running}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              {running ? (
                // 生成中：发送按钮变停止按钮——ACP session/cancel 真中断，
                // cancelled stop reason 到达后 interrupted 事件停住 UI
                <Button
                  type="primary"
                  icon={<StopOutlined />}
                  onClick={() => {
                    void assistantCancel();
                  }}
                  aria-label={t("assistant.stop")}
                  title={t("assistant.stop")}
                />
              ) : (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  disabled={!draft.trim()}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
