// 文档标签条：主页面顶部的可开关标签（三维视图 / 轨道信息 / 轨道库）。
// 关闭标签只是把它从标签条收起，内容仍常驻挂载。三维视图里的 WebGL 画布
// 是全局唯一实例，卸载即丢相机与场景。“+”把已收起的标签放回来。至少保留
// 一个标签，最后一个不给关闭按钮。
// Document tab strip: the closable tabs at the top of the main area (3D view /
// orbit info / catalog). Closing hides the tab only — its content stays mounted,
// because the WebGL canvas in the 3D view is a single global instance whose
// unmount would drop the camera and scene. The "+" control restores a hidden
// tab. At least one tab always stays open.

import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { shellColors } from "./theme";
import { useTranslation } from "./i18n";

/** 一个文档标签：key 是稳定标识，label 是显示名 */
/** A document tab: a stable key plus its display label. */
export interface DocTabSpec {
  key: string;
  label: string;
}

export interface DocTabsProps {
  /** 已打开的标签，按打开顺序（先开在左） */
  tabs: DocTabSpec[];
  /** 全部可选标签，“+”菜单列出其中未打开的部分 */
  available: DocTabSpec[];
  activeKey: string;
  mode: "dark" | "light";
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onOpen: (key: string) => void;
}

export function DocTabs({
  tabs,
  available,
  activeKey,
  mode,
  onActivate,
  onClose,
  onOpen,
}: DocTabsProps) {
  const { t } = useTranslation();
  const colors = shellColors(mode);
  const closed = available.filter((a) => !tabs.some((tab) => tab.key === a.key));
  const menuItems: MenuProps["items"] = closed.map((c) => ({ key: c.key, label: c.label }));

  return (
    <div
      data-testid="doc-tabs"
      className="ldc-scroll"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 2,
        height: 36,
        padding: "0 8px",
        flexShrink: 0,
        background: colors.barBg,
        borderBottom: `1px solid ${colors.border}`,
        overflowX: "auto",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          // 指针停靠或键盘聚焦都现出关闭按钮：透明但仍可聚焦的按钮不该是
          // 唯一的关闭入口。显隐交给 .ldc-hover-actions，激活标签直接常显
          // Pointer hover and keyboard focus both reveal the close button: an
          // invisible but focusable button must never be the only way out. The
          // reveal is .ldc-hover-actions, overridden to always-on for the active tab.
          <div
            key={tab.key}
            className="ldc-hover-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              flexShrink: 0,
              // 激活标签用 2px 主色下边线压住标签条自己的分隔线，形成连着
              // 内容区的“当前页”指示
              // The active tab draws a 2px primary underline over the strip's own
              // hairline, marking the page that the content below belongs to.
              marginBottom: -1,
              borderBottom: `2px solid ${active ? colors.primary : "transparent"}`,
              borderRadius: `${colors.radiusSm}px ${colors.radiusSm}px 0 0`,
            }}
          >
            <Button
              type="text"
              size="small"
              data-testid={`doc-tab-${tab.key}`}
              onClick={() => onActivate(tab.key)}
              style={{
                height: 32,
                padding: "0 8px",
                borderRadius: 0,
                background: "transparent",
                color: active ? colors.text : colors.textSecondary,
                fontSize: 12,
                fontWeight: active ? 500 : 400,
              }}
            >
              {tab.label}
            </Button>
            {tabs.length > 1 && (
              <span className="ldc-hover-actions" style={active ? { opacity: 1 } : undefined}>
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined style={{ fontSize: 10 }} />}
                  data-testid={`doc-tab-close-${tab.key}`}
                  onClick={() => onClose(tab.key)}
                  title={t("doc.tabs.close").replace("{label}", tab.label)}
                  style={{
                    width: 18,
                    height: 18,
                    marginRight: 4,
                    borderRadius: colors.radiusSm,
                    background: "transparent",
                    color: colors.textFaint,
                  }}
                />
              </span>
            )}
          </div>
        );
      })}

      <div
        className="ldc-hover-row"
        style={{
          display: "flex",
          alignSelf: "center",
          marginLeft: 2,
          flexShrink: 0,
          borderRadius: colors.radiusSm,
        }}
      >
        <Dropdown
          trigger={["click"]}
          disabled={closed.length === 0}
          menu={{ items: menuItems, onClick: ({ key }) => onOpen(key) }}
        >
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined style={{ fontSize: 12 }} />}
            data-testid="doc-tab-open"
            title={t("doc.tabs.add")}
            style={{
              width: 24,
              height: 24,
              borderRadius: colors.radiusSm,
              background: "transparent",
              color: colors.textMuted,
            }}
          />
        </Dropdown>
      </div>

      {closed.length === 0 && (
        <span
          style={{ fontSize: 11, color: colors.textMuted, alignSelf: "center", marginLeft: 8 }}
        >
          {/* 全部标签已打开：占位说明，避免“+”看起来是坏的 */}
          {/* Every tab is open: a hint so the "+" does not look broken. */}
          {t("doc.tabs.all_open")}
        </span>
      )}
    </div>
  );
}
