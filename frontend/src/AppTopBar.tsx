// 顶边栏：应用名 + 菜单栏（文件 / 视图 / 工具 / 帮助）+ 右侧全局区（当前历元、
// 助手边栏开关、主题、设置、关于）。菜单项全部指向本应用已有的动作，不放占位项。
// Top bar: the product name, the menu bar (File / View / Tools / Help) and the
// global zone on the right (current epoch, assistant-sidebar toggle, theme,
// settings, about). Every menu item drives an action the app really has — no
// placeholder entries.

import { Button, Dropdown } from "antd";
import type { ReactNode } from "react";
import {
  InfoCircleOutlined,
  MoonOutlined,
  RobotOutlined,
  SettingOutlined,
  SunOutlined,
} from "@ant-design/icons";
import cislunarLogo from "./assets/cislunar_logo.png";
import { shellColors, type ShellColors } from "./theme";
import { useTranslation } from "./i18n";

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

/** 可点区域的悬停底：外层透明容器挂 .ldc-hover-row 拿 colors.hoverBg，
 *  内部按钮自身透明透出它。antd 文本按钮自带的悬停底色不来自本仓库令牌，
 *  直接内联透明又会连它一起压掉，所以悬停底放在外层。
 *  Hover fill for a clickable area: the transparent wrapper carries
 *  .ldc-hover-row for colors.hoverBg and the inner button stays transparent so
 *  it shows through. antd's own text-button hover fill is not one of our tokens,
 *  and an inline transparent background would suppress it anyway, so the fill
 *  lives on the wrapper. */
function HoverShell({
  children,
  radius,
}: {
  children: ReactNode;
  radius: number | "pill";
}) {
  return (
    <div
      className="ldc-hover-row"
      style={{
        display: "flex",
        flexShrink: 0,
        borderRadius: radius === "pill" ? 999 : radius,
      }}
    >
      {children}
    </div>
  );
}

/** 顶栏图标按钮：28px 见方、圆角 8；激活态用 primarySoft 底配 primary 前景。
 *  Top-bar icon button: a 28px square with an 8px radius; the active state uses
 *  the primarySoft fill with a primary foreground. */
function TopBarIconButton({
  colors,
  testId,
  title,
  icon,
  active = false,
  onClick,
}: {
  colors: ShellColors;
  testId: string;
  title: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <HoverShell radius={colors.radius}>
      <Button
        type="text"
        size="small"
        icon={icon}
        data-testid={testId}
        onClick={onClick}
        title={title}
        style={{
          width: 28,
          height: 28,
          borderRadius: colors.radius,
          background: active ? colors.primarySoft : "transparent",
          color: active ? colors.primary : colors.textSecondary,
        }}
      />
    </HoverShell>
  );
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
        gap: 2,
        height: 40,
        padding: "0 10px",
        flexShrink: 0,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.barBg,
      }}
    >
      {/* 品牌标记：cislunar space 标志（tools/assets/logo.png 的 128px 副本），
          产品名是紧邻的文字。标志本体是深藏青描边配银灰球体、透明底，缩小后描边
          会变淡，所以统一垫一块白色圆角底衬，浅色下再补一条描边把边界交代清楚。 */}
      {/* Brand mark: the cislunar space logo (a 128px copy of tools/assets/logo.png)
          with the product name as adjacent text. The mark is navy linework over a
          silver sphere on a transparent ground, which fades once scaled down, so it
          always sits on a white rounded plate; light mode adds a hairline so the
          plate still has an edge against the white bar. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 10 }}>
        <span
          style={{
            width: 32,
            height: 32,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 2,
            borderRadius: colors.radius,
            background: "#ffffff",
            border: mode === "dark" ? "none" : `1px solid ${colors.border}`,
          }}
        >
          <img
            src={cislunarLogo}
            alt="cislunar space"
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, letterSpacing: 0.4 }}>
          CODE
        </span>
      </div>

      {menus.map((menu) => (
        <HoverShell key={menu.key} radius={colors.radius}>
          <Dropdown
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
            <Button
              type="text"
              size="small"
              data-testid={`menu-${menu.key}`}
              style={{
                height: 26,
                padding: "0 8px",
                borderRadius: colors.radius,
                background: "transparent",
                color: colors.textSecondary,
                fontSize: 12,
              }}
            >
              {menu.label}
            </Button>
          </Dropdown>
        </HoverShell>
      ))}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
        <span className="ldc-chip" data-testid="header-epoch">
          {epochLabel}
        </span>
        <TopBarIconButton
          colors={colors}
          testId="header-assistant-toggle"
          title={t("assistant.title")}
          icon={<RobotOutlined style={{ fontSize: 14 }} />}
          active={assistantOpen}
          onClick={onToggleAssistant}
        />
        <TopBarIconButton
          colors={colors}
          testId="header-theme"
          title={t("app.theme_toggle_title")}
          icon={
            mode === "dark" ? (
              <SunOutlined style={{ fontSize: 14 }} />
            ) : (
              <MoonOutlined style={{ fontSize: 14 }} />
            )
          }
          onClick={onToggleTheme}
        />
        <TopBarIconButton
          colors={colors}
          testId="header-settings"
          title={t("app.settings_title")}
          icon={<SettingOutlined style={{ fontSize: 14 }} />}
          onClick={onOpenSettings}
        />
        <TopBarIconButton
          colors={colors}
          testId="header-about"
          title={t("app.about_title")}
          icon={<InfoCircleOutlined style={{ fontSize: 14 }} />}
          onClick={onOpenAbout}
        />
      </div>
    </div>
  );
}
