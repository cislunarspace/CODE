// 对话视图：消息气泡列表（用户右、助手左，助手气泡走 markdown 渲染），
// 工具卡片按会话原位插入，滚动自动跟随最新消息。
// Chat view: the message bubble list (user right, assistant left; assistant
// bubbles render markdown), tool cards inserted in place, with auto-scroll
// following the latest message.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Spin, Typography } from "antd";
import { BulbOutlined } from "@ant-design/icons";
import type { ChatItem } from "./chatModel";
import { ToolCardView } from "./ToolCardView";
import { useTranslation } from "../i18n";

const { Text } = Typography;

/// 思考块（CONTEXT.md 术语）：流式接收、默认折叠，点击展开全文
/// （ADR 0026 决策 4：与工具卡片同一条时间线，不分设侧面板）。
function ThinkingBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: "0 0 10px", maxWidth: "92%" }}>
      <Button
        type="text"
        size="small"
        icon={<BulbOutlined />}
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "0 4px", fontSize: 11, color: "var(--ldc-text-muted)" }}
      >
        {t("assistant.thinking.title")}
      </Button>
      {open && (
        // 折叠正文用左侧竖线标出层级：竖线取调暗的描边色，正文与气泡同字号
        // The expanded body marks its level with a left rule in the dimmed border
        // colour and uses the same size as the bubbles.
        <div
          style={{
            margin: "2px 0 4px 6px",
            padding: "2px 0 2px 8px",
            borderLeft: "2px solid var(--ldc-border-strong)",
            color: "var(--ldc-text-muted)",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

// 全局样式表 ldc.css 只提供令牌与复用类，markdown 元素仍经 components 映射
// 内联样式，颜色取 --ldc-* 变量，随明暗主题切换。
// remark-gfm 启用 GFM 扩展（表格/删除线/任务列表）——助手输出的参数对比表
// 是管道表语法，没有该插件只会显示原始管道文本。
// The global stylesheet (ldc.css) only supplies tokens and reusable classes, so
// markdown elements still get inline styles via the components mapping; colours
// read the --ldc-* variables and follow the light/dark switch. remark-gfm enables
// GFM extensions (tables/strikethrough/task lists) — the assistant's parameter
// tables use pipe syntax, which renders as raw pipes without the plugin.
const mdComponents = {
  p: ({ children }: any) => <p style={{ margin: "4px 0" }}>{children}</p>,
  code: ({ children, className }: any) =>
    className ? ( //  fenced code block 内的 code 由 pre 管
      <code className={className} style={{ fontSize: 11 }}>{children}</code>
    ) : (
      <code
        style={{
          fontSize: 11,
          background: "var(--ldc-muted-bg)",
          padding: "0 4px",
          borderRadius: 4,
        }}
      >
        {children}
      </code>
    ),
  pre: ({ children }: any) => (
    <pre
      style={{
        margin: "6px 0",
        padding: 8,
        fontSize: 11,
        overflow: "auto",
        background: "var(--ldc-muted-bg)",
        borderRadius: 6,
      }}
    >
      {children}
    </pre>
  ),
  ul: ({ children }: any) => <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ol>,
  a: ({ children, href }: any) => (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--ldc-info)" }}>
      {children}
    </a>
  ),
  // GFM 表格：边栏较窄，块级横向滚动兜底
  // GFM tables: the sidebar is narrow — block-level horizontal scroll as fallback.
  table: ({ children }: any) => (
    <table
      style={{
        borderCollapse: "collapse",
        margin: "6px 0",
        fontSize: 11,
        display: "block",
        maxWidth: "100%",
        overflowX: "auto",
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }: any) => (
    <th
      style={{
        border: "1px solid var(--ldc-border)",
        padding: "3px 8px",
        background: "var(--ldc-muted-bg)",
        textAlign: "left",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td style={{ border: "1px solid var(--ldc-border)", padding: "3px 8px" }}>{children}</td>
  ),
};

export function ChatView({
  items,
  running,
  onOpenRecord,
  onApplyScenario,
  onContinue,
}: {
  items: ChatItem[];
  /** 整轮对话进行中（输入禁用 + 顶部"运行中"提示） */
  running: boolean;
  onOpenRecord: (recordId: string, tool: string) => void;
  /** 应用情景（ADR 0027）：scenario_write 完成卡片 → App 打开该情景文件 */
  /** Apply scenario (ADR 0027): a completed scenario_write card → App opens
   *  that scenario file. */
  onApplyScenario?: (path: string) => void;
  /** 中断续跑（#461）：仅当最后一项是中断标记时，标记旁出继续按钮；
   *  未传入或 running 时不出（调用方控制）。 */
  /** Interrupt continue (#461): the continue button shows beside the marker
   *  only when it is the last item; absent when the prop is omitted or
   *  running (caller decides). */
  onContinue?: () => void;
}) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 贴底才自动跟随（#450）：用户上翻看历史时不被流式增量拽回底部；
  // 初值 true（首屏贴底）。阈值 32px。jsdom 无布局量测（恒 0 → 恒贴底），
  // 非贴底路径以手工验证兜底（规格测试决策注明）。
  // Follow the stream only when stuck to the bottom (#450): streaming deltas
  // no longer yank the user back while reading history; initial true. 32px
  // threshold. jsdom has no layout metrics (always 0 → stuck), the not-stuck
  // path is covered by manual verification (spec testing decisions).
  const stickToBottomRef = useRef(true);
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  // 新内容出现时按贴底状态决定是否滚底；用户消息（末项）无条件滚——
  // 自己刚说的话必须可见（#450）。
  // Scroll to bottom on new content only when stuck; a user message (the last
  // item) always scrolls — one's own words must be visible (#450).
  useEffect(() => {
    const last = items[items.length - 1];
    if (stickToBottomRef.current || last?.kind === "user") {
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [items]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="ldc-scroll"
      style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "10px 8px 4px" }}
    >
      {items.map((item, idx) => {
        if (item.kind === "user") {
          return (
            <div key={idx} style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 10px" }}>
              <div
                style={{
                  maxWidth: "92%",
                  padding: "6px 10px",
                  // 气泡圆角 12：比控件大一号，靠形状把“说话人”与卡片区分开
                  // Bubbles take the 12px card radius: one step larger than controls,
                  // so shape alone separates a speaker from a card.
                  borderRadius: "var(--ldc-radius-lg)",
                  background: "var(--tod-user-bubble)",
                  // 主色上的文字必须取反色：暗色下主色是近白，写死白色会看不见
                  // Text on the primary fill must be the inverted colour: in dark mode
                  // the primary is near-white, so a hard-coded white would vanish.
                  color: "var(--tod-user-bubble-text)",
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === "assistant") {
          return (
            <div key={idx} style={{ display: "flex", justifyContent: "flex-start", margin: "0 0 10px" }}>
              <div
                style={{
                  maxWidth: "92%",
                  padding: "6px 10px",
                  borderRadius: "var(--ldc-radius-lg)",
                  background: "var(--tod-assistant-bubble)",
                  color: "var(--ldc-text)",
                  fontSize: 12,
                  lineHeight: 1.6,
                  wordBreak: "break-word",
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {item.text}
                </ReactMarkdown>
              </div>
            </div>
          );
        }
        if (item.kind === "thinking") {
          return <ThinkingBlock key={idx} text={item.text} />;
        }
        if (item.kind === "interrupted") {
          // 中断界限（#453/#461）：居中虚线分隔 + 文案，与 error 气泡区分；
          // 仅当标记是最后一项时附继续按钮（从旧断点续跑有歧义，不提供）
          // Interrupt boundary (#453/#461): a centered dashed divider + label,
          // distinct from error bubbles; the continue button rides only when
          // the marker is the last item (continuing from an old breakpoint is
          // ambiguous and not offered).
          const canContinue = onContinue !== undefined && idx === items.length - 1;
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "0 4px 10px",
                color: "var(--ldc-text-muted)",
                fontSize: 11,
              }}
            >
              <span style={{ flex: 1, borderTop: "1px dashed var(--ldc-border-strong)" }} />
              {t("assistant.interrupted")}
              {canContinue && (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: "auto", fontSize: 11 }}
                  onClick={onContinue}
                >
                  {t("assistant.continue")}
                </Button>
              )}
              <span style={{ flex: 1, borderTop: "1px dashed var(--ldc-border-strong)" }} />
            </div>
          );
        }
        if (item.kind === "error") {
          // 错误气泡沿用状态语义：浅红底 + 错误红前景，不加描边（描边留给卡片）
          // The error bubble keeps the status semantics: error-soft fill with the
          // error foreground and no border (borders belong to cards).
          return (
            <div key={idx} style={{ display: "flex", justifyContent: "flex-start", margin: "0 0 10px" }}>
              <div
                style={{
                  maxWidth: "92%",
                  padding: "6px 10px",
                  borderRadius: "var(--ldc-radius-lg)",
                  background: "var(--ldc-error-soft)",
                  color: "var(--ldc-error)",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {item.text}
              </div>
            </div>
          );
        }
        return (
          <ToolCardView key={item.card.callId} card={item.card} onOpenRecord={onOpenRecord} onApplyScenario={onApplyScenario} />
        );
      })}
      {running && (
        // 生成中指示（#450）：替代静态省略号。Spin 只有旋转，不带 antd 的缩放
        // 位移，与 ADR 0037 关闭位移动效的口径一致
        // Generating indicator (#450): replaces the static ellipsis. Spin only
        // rotates — no antd scale/slide — which matches the motion rule of ADR 0037.
        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 2px 4px" }}>
          <Spin size="small" />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t("assistant.generating")}
          </Text>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
