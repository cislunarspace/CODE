// 侧边栏：项目树宿主（场景与库记录）+ 动力学工具列表 + 折叠开关。
// 工具列表点选即切换要运行的工具，供用户按工具、参数、运行的顺序操作。
// 项目树经 children 注入，侧边栏只管外壳。
// Sidebar: hosts the project tree (scene and catalog records), lists the dynamics
// tools and carries the collapse toggle. Picking a tool switches the tool to run,
// so the flow reads tool, parameters, run. The tree arrives as children and this
// component owns the chrome only.

import type { ReactNode } from "react";
import { Button } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { shellColors } from "./theme";
import { useTranslation } from "./i18n";

export interface SidebarToolSpec {
  key: string;
  label: string;
}

export interface AppSidebarProps {
  mode: "dark" | "light";
  collapsed: boolean;
  onToggleCollapse: () => void;
  tools: SidebarToolSpec[];
  selectedTool: string;
  onSelectTool: (key: string) => void;
  /** 项目树（或其它侧边栏主体内容） */
  children: ReactNode;
}

export function AppSidebar({
  mode,
  collapsed,
  onToggleCollapse,
  tools,
  selectedTool,
  onSelectTool,
  children,
}: AppSidebarProps) {
  const { t } = useTranslation();
  const colors = shellColors(mode);

  if (collapsed) {
    return (
      // 折叠态只留一条 24px 的窄轨：宽度被 App.shell 测试与持久化口径钉住，
      // 里面的展开按钮再窄一档，避免贴边时被裁掉
      // The collapsed state leaves a 24px rail — the width is pinned by the
      // App.shell test and the persisted layout, so the expand button inside is
      // one step narrower to stay clear of the edge.
      <div
        data-testid="app-sider"
        style={{
          width: 24,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 6,
          background: colors.panelBg,
          borderRight: `1px solid ${colors.border}`,
        }}
      >
        <div className="ldc-hover-row" style={{ display: "flex", borderRadius: colors.radiusSm }}>
          <Button
            type="text"
            size="small"
            icon={<MenuUnfoldOutlined style={{ fontSize: 13 }} />}
            data-testid="sider-expand"
            onClick={onToggleCollapse}
            title={t("sider.expand")}
            style={{
              width: 20,
              height: 24,
              borderRadius: colors.radiusSm,
              background: "transparent",
              color: colors.textMuted,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="app-sider"
      style={{
        width: 240,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.panelBg,
        borderRight: `1px solid ${colors.border}`,
        minHeight: 0,
      }}
    >
      {/* 侧栏头：32px，与面板头同高，标题 12px/500 */}
      {/* Sidebar head: 32px, matching the panel heads, with a 12px/500 title. */}
      <div
        style={{
          height: 32,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 6px 0 10px",
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>
          {t("sider.title")}
        </span>
        <div
          className="ldc-hover-row"
          style={{ marginLeft: "auto", display: "flex", borderRadius: colors.radiusSm }}
        >
          <Button
            type="text"
            size="small"
            icon={<MenuFoldOutlined style={{ fontSize: 13 }} />}
            data-testid="sider-collapse"
            onClick={onToggleCollapse}
            title={t("sider.collapse")}
            style={{
              width: 24,
              height: 24,
              borderRadius: colors.radiusSm,
              background: "transparent",
              color: colors.textMuted,
            }}
          />
        </div>
      </div>

      {/* 项目树占满剩余高度（滚动由树内部虚拟滚动与容器共同承担） */}
      {/* The project tree fills the rest (scrolling shared by the tree's virtual
          scroll and this container). */}
      <div
        className="ldc-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>

      <div
        className="ldc-scroll"
        style={{
          borderTop: `1px solid ${colors.border}`,
          flexShrink: 0,
          maxHeight: 176,
          overflowY: "auto",
          padding: "6px 6px 8px",
        }}
      >
        <div className="ldc-section-label" style={{ padding: "0 4px 4px" }}>
          {t("sider.tools")}
        </div>
        {/* 工具行 26px、圆角 6：行本身作为命中区拿悬停底与选中底，内部按钮
            透明并左对齐，长工具名在 240px 侧栏里省略号收尾
            Tool rows are 26px with a 6px radius: the row itself is the hit area
            carrying the hover and active fills, the inner button stays
            transparent and left-aligned, and long tool names ellipsize inside
            the 240px sidebar. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {tools.map((tool) => {
            const active = tool.key === selectedTool;
            return (
              <div
                key={tool.key}
                className="ldc-hover-row"
                style={{
                  display: "flex",
                  borderRadius: colors.radiusSm,
                  background: active ? colors.activeBg : undefined,
                }}
              >
                <Button
                  type="text"
                  size="small"
                  data-testid={`sider-tool-${tool.key}`}
                  onClick={() => onSelectTool(tool.key)}
                  title={tool.label}
                  style={{
                    height: 26,
                    width: "100%",
                    minWidth: 0,
                    padding: "0 8px",
                    borderRadius: colors.radiusSm,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    background: "transparent",
                    color: active ? colors.activeText : colors.textSecondary,
                    fontWeight: active ? 500 : 400,
                    fontSize: 12,
                  }}
                >
                  {/* 长工具名（如“参数空间扫描 (Sweep)”）在 240px 侧栏里必须
                      省略号收尾，否则文字会越过面板边界压到画布上 */}
                  {/* Long tool names must ellipsize inside the 240px sidebar —
                      otherwise the text spills over the panel edge onto the canvas. */}
                  <span
                    style={{
                      display: "block",
                      width: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textAlign: "left",
                    }}
                  >
                    {tool.label}
                  </span>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
