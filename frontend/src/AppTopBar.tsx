// 顶边栏：应用名 + 菜单栏（文件 / 视图 / 工具 / 帮助）+ 右侧全局区（当前历元、
// 助手边栏开关、主题、设置、关于）。菜单项全部指向本应用已有的动作，不放占位项。
// Top bar: the product name, the menu bar (File / View / Tools / Help) and the
// global zone on the right (current epoch, assistant-sidebar toggle, theme,
// settings, about). Every menu item drives an action the app really has — no
// placeholder entries.

import { Button, Dropdown, Typography } from "antd";
import {
  InfoCircleOutlined,
  MoonOutlined,
  RobotOutlined,
  SettingOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { shellColors } from "./theme";
import { useTranslation } from "./i18n";

const { Text } = Typography;

/** 一个菜单项（type: "divider" 时只画分隔线，标签为空） */
/** One menu entry; type: "divider" draws a separator and leaves the label empty. */
export interface TopMenuItemSpec {
  key: string;
  label?: string;
  type?: "divider";
  onClick?: () => void;
}

export interface TopMenuSpec {
  key: string;
  label: string;
  items: TopMenuItemSpec[];
}

export interface AppTopBarProps {
  mode: "dark" | "light";
  /** 当前历元显示文本（无时刻时由调用方给占位文案） */
  epochLabel: string;
  menus: TopMenuSpec[];
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}

export function AppTopBar({
  mode,
  epochLabel,
  menus,
  assistantOpen,
  onToggleAssistant,
  onToggleTheme,
  onOpenSettings,
  onOpenAbout,
}: AppTopBarProps) {
  const { t } = useTranslation();
  const colors = shellColors(mode);

  return (
    <div
      data-testid="app-header"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        flexShrink: 0,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.barBg,
      }}
    >
      <Text strong style={{ fontSize: 14, letterSpacing: 0.5, marginRight: 10 }}>
        CODE
      </Text>

      {menus.map((menu) => (
        <Dropdown
          key={menu.key}
          trigger={["click"]}
          menu={{
            items: menu.items.map((item) =>
              item.type === "divider"
                ? { type: "divider" as const, key: item.key }
                : { key: item.key, label: item.label, disabled: !item.onClick },
            ),
            onClick: ({ key }) => {
              const item = menu.items.find((i) => i.key === key);
              item?.onClick?.();
            },
          }}
        >
          <Button type="text" size="small" data-testid={`menu-${menu.key}`}>
            {menu.label}
          </Button>
        </Dropdown>
      ))}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        <Text
          data-testid="header-epoch"
          style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
        >
          {epochLabel}
        </Text>
        <Button
          type="text"
          size="small"
          icon={<RobotOutlined />}
          data-testid="header-assistant-toggle"
          onClick={onToggleAssistant}
          title={t("assistant.title")}
          style={{
            background: assistantOpen ? colors.activeBg : "transparent",
            color: assistantOpen ? colors.activeText : "inherit",
          }}
        />
        <Button
          type="text"
          size="small"
          icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
          data-testid="header-theme"
          onClick={onToggleTheme}
          title={t("app.theme_toggle_title")}
        />
        <Button
          type="text"
          size="small"
          icon={<SettingOutlined />}
          data-testid="header-settings"
          onClick={onOpenSettings}
          title={t("app.settings_title")}
        />
        <Button
          type="text"
          size="small"
          icon={<InfoCircleOutlined />}
          data-testid="header-about"
          onClick={onOpenAbout}
          title={t("app.about_title")}
        />
      </div>
    </div>
  );
}
