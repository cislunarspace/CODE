// 文档标签条：主页面顶部的可开关标签（三维视图 / 轨道信息 / 轨道库）。
// 关闭标签只是把它从标签条收起，内容仍常驻挂载。三维视图里的 WebGL 画布
// 是全局唯一实例，卸载即丢相机与场景。“+”把已收起的标签放回来。至少保留
// 一个标签，最后一个不给关闭按钮。
// Document tab strip: the closable tabs at the top of the main area (3D view /
// orbit info / catalog). Closing hides the tab only — its content stays mounted,
// because the WebGL canvas in the 3D view is a single global instance whose
// unmount would drop the camera and scene. The "+" control restores a hidden
// tab. At least one tab always stays open.

import { Button, Dropdown, Typography } from "antd";
import type { MenuProps } from "antd";
import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { shellColors } from "./theme";
import { useTranslation } from "./i18n";

const { Text } = Typography;

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
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 2,
        paddingLeft: 6,
        paddingRight: 6,
        flexShrink: 0,
        background: colors.barBg,
        borderBottom: `1px solid ${colors.border}`,
        overflowX: "auto",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              flexShrink: 0,
              marginBottom: -1,
              borderBottom: `2px solid ${active ? colors.activeText : "transparent"}`,
              background: active ? colors.activeBg : "transparent",
            }}
          >
            <Button
              type="text"
              size="small"
              data-testid={`doc-tab-${tab.key}`}
              onClick={() => onActivate(tab.key)}
              style={{
                padding: "4px 2px 6px 8px",
                borderRadius: 0,
                color: active ? colors.activeText : "inherit",
                fontWeight: active ? 500 : 400,
              }}
            >
              {tab.label}
            </Button>
            {tabs.length > 1 && (
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined style={{ fontSize: 9 }} />}
                data-testid={`doc-tab-close-${tab.key}`}
                onClick={() => onClose(tab.key)}
                title={t("doc.tabs.close").replace("{label}", tab.label)}
                style={{ marginRight: 4 }}
              />
            )}
          </div>
        );
      })}

      <Dropdown
        trigger={["click"]}
        disabled={closed.length === 0}
        menu={{ items: menuItems, onClick: ({ key }) => onOpen(key) }}
      >
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          data-testid="doc-tab-open"
          title={t("doc.tabs.add")}
          style={{ marginTop: 2, flexShrink: 0 }}
        />
      </Dropdown>

      {closed.length === 0 && (
        <Text type="secondary" style={{ fontSize: 11, alignSelf: "center", marginLeft: 6 }}>
          {/* 全部标签已打开：占位说明，避免“+”看起来是坏的 */}
          {/* Every tab is open: a hint so the "+" does not look broken. */}
          {t("doc.tabs.all_open")}
        </Text>
      )}
    </div>
  );
}
