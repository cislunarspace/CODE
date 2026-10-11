// 侧边栏：项目树宿主（场景与库记录）+ 动力学工具列表 + 折叠开关。
// 工具列表点选即切换要运行的工具，供用户按工具、参数、运行的顺序操作。
// 项目树经 children 注入，侧边栏只管外壳。
// Sidebar: hosts the project tree (scene and catalog records), lists the dynamics
// tools and carries the collapse toggle. Picking a tool switches the tool to run,
// so the flow reads tool, parameters, run. The tree arrives as children and this
// component owns the chrome only.

import type { ReactNode } from "react";
import { Button, Typography } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { shellColors } from "./theme";
import { useTranslation } from "./i18n";

const { Text } = Typography;

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
      <div
        data-testid="app-sider"
        style={{
          width: 24,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 8,
          background: colors.panelBg,
          borderRight: `1px solid ${colors.border}`,
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<MenuUnfoldOutlined />}
          data-testid="sider-expand"
          onClick={onToggleCollapse}
          title={t("sider.expand")}
        />
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 4px 4px 10px",
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 12 }}>
          {t("sider.title")}
        </Text>
        <Button
          type="text"
          size="small"
          icon={<MenuFoldOutlined />}
          data-testid="sider-collapse"
          onClick={onToggleCollapse}
          title={t("sider.collapse")}
          style={{ marginLeft: "auto" }}
        />
      </div>

      {/* 项目树占满剩余高度（滚动由树内部虚拟滚动与容器共同承担） */}
      {/* The project tree fills the rest (scrolling shared by the tree's virtual
          scroll and this container). */}
      <div
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
        style={{
          borderTop: `1px solid ${colors.border}`,
          flexShrink: 0,
          maxHeight: 176,
          overflowY: "auto",
          padding: "6px 6px 8px",
        }}
      >
        <Text type="secondary" style={{ fontSize: 11, paddingLeft: 4 }}>
          {t("sider.tools")}
        </Text>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 4 }}>
          {tools.map((tool) => {
            const active = tool.key === selectedTool;
            return (
              <Button
                key={tool.key}
                type="text"
                size="small"
                data-testid={`sider-tool-${tool.key}`}
                onClick={() => onSelectTool(tool.key)}
                title={tool.label}
                style={{
                  height: 24,
                  width: "100%",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  background: active ? colors.activeBg : "transparent",
                  color: active ? colors.activeText : "inherit",
                  fontWeight: active ? 500 : 400,
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
