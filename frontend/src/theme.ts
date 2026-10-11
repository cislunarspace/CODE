// 严肃视觉语言：直角(2px) + 高密度平面化 + 收敛语义色板（黑/白/灰/红/蓝/绿/橙）
// 有意偏离 antd 圆润亮色默认，见 docs/adr/0020-serious-semantic-ui-visual-language.md
// Serious visual language: square corners (2px) + high-density flatness + a restrained semantic palette
// (black/white/gray/red/blue/green/orange); deliberately departs from antd's rounded bright defaults — see
// docs/adr/0020-serious-semantic-ui-visual-language.md.

// 与 token 平级的主题开关
// Theme switches at the same level as tokens.
export const themeBehavior = {
  // 关闭全部过渡动画：按钮/弹窗/下拉的缓动是"卡通感"的主要来源
  // Disable all transition animations: button/modal/dropdown easing is the main source of the "cartoonish" feel.
  motion: false,
  // 线框风：组件去渐变、阴影改边框式，走向平面观感
  // Wireframe style: remove gradients, turn shadows into borders, and go flat.
  wireframe: true,
} as const;

export const themeTokens = {
  // 直角：antd 默认 6–8px 圆角，全系列统一收到 2px
  // Square corners: antd defaults to 6-8px radii; the whole series is tightened to 2px.
  borderRadius: 2,
  borderRadiusLG: 2,
  borderRadiusSM: 2,
  borderRadiusXS: 2,
  borderRadiusOuter: 2,
  // 密度：控件高度从默认 32/24/40 收紧到桌面工具量级
  // Density: control heights tightened from the default 32/24/40 to desktop-tool scale.
  controlHeight: 26,
  controlHeightSM: 22,
  controlHeightLG: 30,
  // 平面阴影：只留一层浅投影，不用 antd 默认的大扩散多层阴影
  // Flat shadows: keep one shallow shadow layer, not antd's default wide multi-layer shadows.
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.10)",
  boxShadowSecondary: "0 2px 6px rgba(0, 0, 0, 0.12)",
  // 字体：桌面系统 UI 栈，Windows 上 Segoe UI + 雅黑
  // Fonts: desktop system UI stack; on Windows Segoe UI + Microsoft YaHei.
  fontFamily:
    '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
  // 主色/信息色：收敛深蓝（替换 antd 默认亮蓝 #1677ff）
  // Primary/info colors: restrained deep blue (replacing antd's default bright blue #1677ff).
  colorPrimary: "#0958d9",
  colorInfo: "#0958d9",
  // 语义色沿用 antd 默认：绿=成功、橙=警告、红=错误
  // Semantic colors follow antd defaults: green = success, orange = warning, red = error.
  colorSuccess: "#52c41a",
  colorWarning: "#faad14",
  colorError: "#ff4d4f",
} as const;

/** 界面外壳配色：顶边栏、侧边栏、停靠面板、标签条共用一份取值，集中一处便于
 *  整体调整对比度。
 * Shell palette: one source for the top bar, sidebar, docked panel and tab strip,
 * so contrast adjustments stay a single edit. */
export interface ShellColors {
  /** 面板分隔线 */
  border: string;
  /** 顶边栏与标签条底色（比面板亮/深一档，拉出层次） */
  barBg: string;
  /** 侧边栏与停靠面板底色 */
  panelBg: string;
  /** 标签激活底色 */
  activeBg: string;
  /** 标签激活文字 */
  activeText: string;
}

export function shellColors(mode: "dark" | "light"): ShellColors {
  const dark = mode === "dark";
  return {
    border: dark ? "#303030" : "#e8e8e8",
    barBg: dark ? "#1f1f1f" : "#ffffff",
    panelBg: dark ? "#1a1a1a" : "#fafafa",
    activeBg: dark ? "rgba(64, 150, 255, 0.16)" : "rgba(9, 88, 217, 0.08)",
    activeText: dark ? "#ffffff" : "#0958d9",
  };
}

/** 组件级 token（ADR 0020/0034）：主按钮自带的蓝色投影是 antd“立体感”的
 *  主要来源，控制台要平面化，直接去掉。开关胶囊与彩色元数据标签 antd 不给
 *  token，只能逐实例给语义化 styles，见 flatSwitchStyles / neutralTagStyle。
 * Component-level tokens (ADR 0020/0034): the primary button's blue drop shadow is
 * the main source of antd's dimensionality and the console goes flat, so it is
 * removed. The switch pill and coloured metadata tags have no token — they are
 * overridden per instance via the semantic styles below. */
export const themeComponents = {
  Button: { primaryShadow: "none" },
};

/** 开关去胶囊化：antd 的 Switch 根与滑块都是 100px 圆角，与控制台其余直角
 *  控件不一致，收到 2px。 */
/** De-pill the switch: antd's Switch root and handle carry a 100px radius, out of
 *  step with the console's square controls; tightened to 2px. */
export const flatSwitchStyles = {
  root: { borderRadius: themeTokens.borderRadius },
  indicator: { borderRadius: themeTokens.borderRadius },
};

/** 元数据标签：彩色只用于状态（成功/失败/警告/进行中），族名、平动点、动力学
 *  能力这类描述性信息用中性线框标签，避免整屏彩色块。 */
/** Metadata tags: colour is reserved for state (success/error/warning/running);
 *  descriptive facts (family name, libration point, dynamics capability) use a
 *  neutral bordered tag so the screen does not fill with colour chips. */
export const neutralTagStyle = {
  marginInlineEnd: 0,
  fontSize: 11,
  lineHeight: "16px",
  background: "transparent",
  borderColor: "currentColor",
  color: "inherit",
  opacity: 0.85,
} as const;

/** 主题 CSS 变量（#450）：助手边栏/会话视图/工具卡片引用 --tod-* 系列，
 *  此前全仓库只有 var(...) 引用而无定义处，深色模式下永远落到浅色 fallback。
 *  返回值由 App 根容器注入为内联 CSS 变量，随明暗主题切换；浅色值 = 各
 *  消费端既有 fallback（浅色零回归），深色值与 App 深色界面同源
 *  （边框 #303030、面板 #1a1a1a，白系叠加层对齐 antd darkAlgorithm 口径）。
 * Theme CSS variables (#450): the assistant sidebar / chat view / tool cards
 * reference the --tod-* series, which until now had no definition anywhere —
 * dark mode always fell back to the light values. The map is injected as
 * inline CSS variables on the App root and follows the theme switch; light
 * values equal the consumers' existing fallbacks (zero light-mode regression),
 * dark values share the app's dark surfaces (border #303030, panel #1a1a1a;
 * white-overlay layers aligned with antd's darkAlgorithm). */
export function themeCssVars(mode: "dark" | "light"): Record<string, string> {
  const dark = mode === "dark";
  return {
    "--tod-border": dark ? "#303030" : "#e8e8e8",
    "--tod-panel-bg": dark ? "#1a1a1a" : "transparent",
    "--tod-user-bubble": "#0958d9",
    "--tod-assistant-bubble": dark ? "rgba(255,255,255,0.10)" : "rgba(128,128,128,0.10)",
    "--tod-text-secondary": "#8c8c8c",
    // 强调色（ADR 0034）：时间轴等随主题着色的控件用它，浅色沿用控制台主色，
    // 深色提亮一档（与 antd darkAlgorithm 的主色一致）
    // Accent (ADR 0034): used by theme-aware controls such as the timeline. Light
    // keeps the console primary, dark brightens one step (matching antd's
    // darkAlgorithm primary).
    "--tod-accent": dark ? "#4096ff" : "#0958d9",
    "--tod-card-bg": dark ? "rgba(255,255,255,0.06)" : "rgba(128,128,128,0.06)",
    "--tod-code-bg": dark ? "rgba(255,255,255,0.10)" : "rgba(128,128,128,0.1)",
  };
}
