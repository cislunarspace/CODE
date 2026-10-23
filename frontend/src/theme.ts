// LDC 视觉语言（linux-do/cdk）：shadcn/ui new-york + Tailwind v4 的 zinc 中性灰阶。
// 亮色为主、暗色可切。扁平，无渐变、无霓虹、无多层投影，圆角 8–12px，卡片与弹层更大。
// 中性色承担全部控件与选中态，彩色只用于状态（成功、失败、警告）与数据面强调（画布选中、
// 时间轴游标、链接）。取代 ADR 0020 的直角线框口径，见 docs/adr/0037-ui-ldc-visual-language.md。
// LDC visual language (linux-do/cdk): shadcn/ui new-york on Tailwind v4's zinc neutral
// scale. Light-first with a dark switch; flat, no gradients, no neon, no stacked
// shadows; 8–12px radii with larger cards and overlays. Neutral tones carry every
// control and selected state; colour is reserved for status (success, error, warning)
// and for data-surface emphasis (canvas selection, timeline cursor, links). Supersedes
// the square wireframe direction of ADR 0020. See docs/adr/0037-ui-ldc-visual-language.md.

// 与 token 平级的主题开关
// Theme switches at the same level as tokens.
export const themeBehavior = {
  // 关闭 antd 组件级的缓动：弹窗、下拉的缩放位移是"卡通感"的主要来源。
  // 交互反馈改由 CSS 的颜色过渡承担（见 ldc.css 的 .ldc-hover-row），
  // 不靠位移与缩放。
  // Disable antd's component-level easing: modal and dropdown scale/slide is the main
  // source of the "cartoonish" feel. Feedback comes from CSS colour transitions
  // instead (see .ldc-hover-row in ldc.css), never from movement or scaling.
  motion: false,
  // 线框风：组件去渐变、阴影改边框式，走向平面观感
  // Wireframe style: remove gradients, turn shadows into borders, go flat.
  wireframe: true,
} as const;

/** 界面圆角分档：徽标与行 6px、控件 8px、卡片与面板 12px、模态弹层 16px。
 *  一处定义，色板与 antd token 共用，避免两套取值各自漂移。
 *  Radius scale: 6px for badges and rows, 8px for controls, 12px for cards and
 *  panels, 16px for modal overlays. Defined once and shared by the palette and
 *  the antd tokens so the two cannot drift apart. */
const RADII = {
  radiusSm: 6,
  radius: 8,
  radiusLg: 12,
  radiusXl: 16,
  radiusPill: 999,
} as const;

/** 界面色板与几何：一处定义，antd token、内联样式与 CSS 变量（--ldc-*）共用。
 *  One palette and geometry source shared by the antd tokens, the inline styles and
 *  the --ldc-* CSS variables. */
export interface ShellColors {
  mode: "dark" | "light";
  /** 页面底（主页面、顶边栏、标签条同色，靠一条淡分隔线区分） */
  pageBg: string;
  /** 侧边栏、助手边栏、停靠面板底色 */
  panelBg: string;
  /** 顶边栏与标签条底色 */
  barBg: string;
  /** 卡片、浮层底色 */
  cardBg: string;
  /** 次级块、统计块、徽标底 */
  mutedBg: string;
  /** 行与图标按钮的悬停底 */
  hoverBg: string;
  /** 选中行底色 */
  activeBg: string;
  /** 选中行文字 */
  activeText: string;
  /** 分隔线与描边（很淡） */
  border: string;
  /** 需要更明显区分的描边（输入框、分隔） */
  borderStrong: string;
  /** 主文字 */
  text: string;
  /** 次级文字（说明、标签） */
  textSecondary: string;
  /** 三级文字（元数据、占位） */
  textMuted: string;
  /** 四级文字（停用、极弱提示） */
  textFaint: string;
  /** 控件主色：中性近黑（亮）／近白（暗） */
  primary: string;
  primaryHover: string;
  /** 主色上的文字 */
  onPrimary: string;
  /** 主色的浅底（选中态、徽标） */
  primarySoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  error: string;
  errorSoft: string;
  /** 数据面强调色：画布选中、时间轴游标、链接 */
  info: string;
  infoSoft: string;
  /** 链接悬停：比 info 亮/深一档 */
  infoHover: string;
  /** 弹窗遮罩：暗色下要比亮色更深，否则压不住背景 */
  mask: string;
  /** 阴影：卡片几乎不用，浮层一层柔和投影 */
  shadow: string;
  shadowOverlay: string;
  radiusSm: number;
  radius: number;
  radiusLg: number;
  radiusXl: number;
  radiusPill: number;
}

export function shellColors(mode: "dark" | "light"): ShellColors {
  const dark = mode === "dark";
  if (dark) {
    return {
      mode,
      pageBg: "#09090b",
      panelBg: "#111113",
      barBg: "#09090b",
      cardBg: "#18181b",
      mutedBg: "#1f1f23",
      hoverBg: "#27272a",
      activeBg: "#27272a",
      activeText: "#fafafa",
      border: "rgba(255, 255, 255, 0.10)",
      borderStrong: "rgba(255, 255, 255, 0.18)",
      text: "#fafafa",
      textSecondary: "#d4d4d8",
      textMuted: "#a1a1aa",
      textFaint: "#71717a",
      primary: "#fafafa",
      primaryHover: "#e4e4e7",
      onPrimary: "#18181b",
      primarySoft: "rgba(255, 255, 255, 0.08)",
      success: "#34d399",
      successSoft: "rgba(52, 211, 153, 0.12)",
      warning: "#fbbf24",
      warningSoft: "rgba(251, 191, 36, 0.12)",
      error: "#f87171",
      errorSoft: "rgba(248, 113, 113, 0.12)",
      info: "#60a5fa",
      infoSoft: "rgba(96, 165, 250, 0.14)",
      infoHover: "#93c5fd",
      mask: "rgba(0, 0, 0, 0.60)",
      shadow: "0 1px 2px rgba(0, 0, 0, 0.45)",
      shadowOverlay: "0 16px 40px rgba(0, 0, 0, 0.55)",
      ...RADII,
    };
  }
  return {
    mode,
    pageBg: "#ffffff",
    panelBg: "#fafafa",
    barBg: "#ffffff",
    cardBg: "#ffffff",
    mutedBg: "#f4f4f5",
    hoverBg: "#f4f4f5",
    activeBg: "#f4f4f5",
    activeText: "#18181b",
    border: "#e4e4e7",
    borderStrong: "#d4d4d8",
    text: "#18181b",
    textSecondary: "#52525b",
    textMuted: "#71717a",
    textFaint: "#a1a1aa",
    primary: "#18181b",
    primaryHover: "#27272a",
    onPrimary: "#fafafa",
    primarySoft: "#f4f4f5",
    success: "#10b981",
    successSoft: "rgba(16, 185, 129, 0.10)",
    warning: "#f59e0b",
    warningSoft: "rgba(245, 158, 11, 0.14)",
    error: "#ef4444",
    errorSoft: "rgba(239, 68, 68, 0.10)",
    info: "#2563eb",
    infoSoft: "rgba(37, 99, 235, 0.10)",
    infoHover: "#1d4ed8",
    mask: "rgba(9, 9, 11, 0.32)",
    shadow: "0 1px 2px rgba(24, 24, 27, 0.06)",
    shadowOverlay: "0 16px 40px rgba(24, 24, 27, 0.12)",
    ...RADII,
  };
}

/** 与主题无关的几何与字体：圆角、控件高度、字体栈。
 *  Theme-independent geometry and typography: radii, control heights, font stack. */
export const themeShape = {
  // 圆角取 RADII：控件 8、行与徽标 6、卡片与浮层 12、模态弹层 16（在 ldc.css 消费）
  // Radii come from RADII: 8 for controls, 6 for rows and badges, 12 for cards and
  // popovers, 16 for modal overlays (consumed in ldc.css).
  borderRadius: RADII.radius,
  borderRadiusSM: RADII.radiusSm,
  borderRadiusXS: 4,
  borderRadiusLG: RADII.radiusLg,
  borderRadiusOuter: RADII.radiusXl,
  // 密度：桌面工具量级，比 antd 默认略紧，比上一版直角口径略松
  // Density: desktop-tool scale. A little tighter than antd's default, a little
  // looser than the previous square-cornered pass.
  controlHeight: 28,
  controlHeightSM: 24,
  controlHeightLG: 32,
  // 字体：拉丁走 Inter，中文走系统黑体。不随安装包分发 Web 字体
  // Fonts: Inter for Latin, the system sans for Chinese; no web font is shipped
  // with the installer.
  fontFamily:
    '"Inter", "Segoe UI Variable Text", "Segoe UI", "Noto Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
} as const;

/** antd token：色板随明暗切换，几何与字体固定。
 *  antd tokens: the palette follows the theme switch, geometry and typography do not. */
export function themeTokens(mode: "dark" | "light") {
  const c = shellColors(mode);
  return {
    ...themeShape,
    colorPrimary: c.primary,
    colorPrimaryHover: c.primaryHover,
    colorPrimaryActive: c.primary,
    colorInfo: c.info,
    colorSuccess: c.success,
    colorWarning: c.warning,
    colorError: c.error,
    colorLink: c.info,
    colorLinkHover: c.infoHover,
    // 表面
    // Surfaces
    colorBgLayout: c.pageBg,
    colorBgContainer: c.cardBg,
    colorBgElevated: c.cardBg,
    colorBgSpotlight: c.primary,
    colorTextLightSolid: c.onPrimary,
    // 描边
    // Borders
    colorBorder: c.border,
    colorBorderSecondary: c.border,
    // 文字
    // Text
    colorText: c.text,
    colorTextSecondary: c.textSecondary,
    colorTextTertiary: c.textMuted,
    colorTextQuaternary: c.textFaint,
    colorTextDescription: c.textMuted,
    colorTextPlaceholder: c.textFaint,
    // 填充：图标按钮与行的悬停底
    // Fills: hover background of icon buttons and rows
    colorFillSecondary: c.mutedBg,
    colorFillTertiary: c.mutedBg,
    colorFillQuaternary: c.hoverBg,
    controlItemBgHover: c.hoverBg,
    controlItemBgActive: c.activeBg,
    // 投影：控件不用，浮层一层
    // Shadows: none on controls, one soft layer on overlays
    boxShadow: c.shadow,
    boxShadowSecondary: c.shadowOverlay,
    boxShadowTertiary: c.shadow,
  };
}

/** 组件级 token：主按钮去掉 antd 自带的投影，按钮文字给到 500。
 *  Component-level tokens: drop the primary button's drop shadow and set button text
 *  to weight 500. */
export const themeComponents = {
  Button: { primaryShadow: "none", fontWeight: 500 },
} as const;

/** 元数据标签：彩色只留给状态。族名、平动点这类描述性信息是中性徽标。
 *  取 CSS 变量而非色板对象，调用方不必持有明暗模式。变量挂在文档根元素上，
 *  弹层里的标签同样解析得到（App 注入）。
 *  Metadata tags: colour is reserved for status; descriptive facts (family name,
 *  libration point) are neutral badges. The style reads CSS variables instead of a
 *  palette object so callers need not know the theme; the variables live on the
 *  document root (injected by App), so tags inside portals resolve them too. */
export const neutralTagStyle = {
  marginInlineEnd: 0,
  fontSize: 11,
  lineHeight: "18px",
  borderRadius: 6,
  borderColor: "transparent",
  background: "var(--ldc-muted-bg)",
  color: "var(--ldc-text-secondary)",
} as const;

/** 主题 CSS 变量（#450）：--ldc-* 供 ldc.css 与内联样式消费，--tod-* 是既有
 *  消费端（状态栏、时间轴、助手边栏）沿用的旧名，两套同源。
 *  Theme CSS variables (#450): --ldc-* feeds ldc.css and inline styles; --tod-* keeps
 *  the older names already consumed by the status bar, timeline and assistant
 *  sidebar. Both series resolve to the same palette. */
export function themeCssVars(mode: "dark" | "light"): Record<string, string> {
  const c = shellColors(mode);
  return {
    "--ldc-page-bg": c.pageBg,
    "--ldc-panel-bg": c.panelBg,
    "--ldc-bar-bg": c.barBg,
    "--ldc-card-bg": c.cardBg,
    "--ldc-muted-bg": c.mutedBg,
    "--ldc-hover-bg": c.hoverBg,
    "--ldc-active-bg": c.activeBg,
    "--ldc-active-text": c.activeText,
    "--ldc-border": c.border,
    "--ldc-border-strong": c.borderStrong,
    "--ldc-text": c.text,
    "--ldc-text-secondary": c.textSecondary,
    "--ldc-text-muted": c.textMuted,
    "--ldc-text-faint": c.textFaint,
    "--ldc-primary": c.primary,
    "--ldc-primary-hover": c.primaryHover,
    "--ldc-on-primary": c.onPrimary,
    "--ldc-primary-soft": c.primarySoft,
    "--ldc-success": c.success,
    "--ldc-success-soft": c.successSoft,
    "--ldc-warning": c.warning,
    "--ldc-warning-soft": c.warningSoft,
    "--ldc-error": c.error,
    "--ldc-error-soft": c.errorSoft,
    "--ldc-info": c.info,
    "--ldc-info-soft": c.infoSoft,
    "--ldc-info-hover": c.infoHover,
    "--ldc-mask": c.mask,
    "--ldc-shadow": c.shadow,
    "--ldc-shadow-overlay": c.shadowOverlay,
    "--ldc-radius-sm": `${c.radiusSm}px`,
    "--ldc-radius": `${c.radius}px`,
    "--ldc-radius-lg": `${c.radiusLg}px`,
    "--ldc-radius-xl": `${c.radiusXl}px`,
    // 旧名（--tod-*）：助手边栏、时间轴、状态栏沿用
    // Legacy names (--tod-*) still used by the assistant sidebar, timeline and status bar.
    "--tod-border": c.border,
    "--tod-panel-bg": c.panelBg,
    "--tod-user-bubble": c.primary,
    "--tod-user-bubble-text": c.onPrimary,
    "--tod-assistant-bubble": c.mutedBg,
    "--tod-text-secondary": c.textMuted,
    "--tod-accent": c.info,
    "--tod-card-bg": c.mutedBg,
    "--tod-code-bg": c.mutedBg,
  };
}
