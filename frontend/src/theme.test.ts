import { describe, expect, it } from "vitest";
import { neutralTagStyle, shellColors, themeBehavior, themeCssVars, themeTokens } from "./theme";

describe("themeBehavior（ADR 0037）", () => {
  it("motion 关闭——关闭 antd 的位移与缩放缓动", () => {
    expect(themeBehavior.motion).toBe(false);
  });

  it("wireframe 开启——组件平面化，阴影改描边", () => {
    expect(themeBehavior.wireframe).toBe(true);
  });
});

describe("themeTokens（ADR 0037）", () => {
  it("圆角分档：按钮与输入框 8px、卡片与弹层 12px、小控件 6px", () => {
    expect(themeTokens("light").borderRadius).toBe(8);
    expect(themeTokens("light").borderRadiusLG).toBe(12);
    expect(themeTokens("light").borderRadiusSM).toBe(6);
  });

  it("控件高度按桌面工具密度：28 / 24 / 32", () => {
    const token = themeTokens("light");
    expect(token.controlHeight).toBe(28);
    expect(token.controlHeightSM).toBe(24);
    expect(token.controlHeightLG).toBe(32);
  });

  it("主色是中性色：亮色近黑、暗色近白，且与主文字/页面底互为反差", () => {
    const light = themeTokens("light");
    const dark = themeTokens("dark");
    expect(light.colorPrimary).toBe("#18181b");
    expect(dark.colorPrimary).toBe("#fafafa");
    expect(light.colorPrimary).toBe(light.colorText);
    expect(dark.colorPrimary).toBe(dark.colorText);
    expect(dark.colorPrimary).not.toBe(light.colorPrimary);
  });

  it("语义色保持色相：信息、成功、警告、错误不等同主色，且明暗各一套", () => {
    const light = themeTokens("light");
    const dark = themeTokens("dark");
    for (const key of ["colorInfo", "colorSuccess", "colorWarning", "colorError"] as const) {
      expect(light[key]).not.toBe(light.colorPrimary);
      expect(dark[key]).not.toBe(dark.colorPrimary);
      expect(dark[key]).not.toBe(light[key]);
    }
  });

  it("表面分档：次级面与页面底分开，暗色整体压暗", () => {
    const light = themeTokens("light");
    const dark = themeTokens("dark");
    expect(light.colorBgLayout).not.toBe(light.colorFillSecondary);
    expect(dark.colorBgLayout).not.toBe(dark.colorBgContainer);
    expect(dark.colorBgLayout).not.toBe(light.colorBgLayout);
  });

  it("投影收敛：控件一层浅投影，浮层一层柔和投影", () => {
    const token = themeTokens("light");
    expect(token.boxShadow).toContain("0 1px 2px");
    expect(token.boxShadowSecondary).not.toBe(token.boxShadow);
  });

  it("字体栈以 Inter 为首选，中文回落系统黑体", () => {
    const { fontFamily } = themeTokens("light");
    expect(fontFamily).toContain("Inter");
    expect(fontFamily).toContain("Segoe UI");
    expect(fontFamily).toContain("Microsoft YaHei UI");
  });
});

describe("shellColors（ADR 0037）", () => {
  it("页面、面板、卡片三档表面互不相同，明暗各一套", () => {
    for (const mode of ["light", "dark"] as const) {
      const c = shellColors(mode);
      expect(c.pageBg).not.toBe(c.panelBg);
      expect(c.panelBg).not.toBe(c.mutedBg);
      expect(c.cardBg).toBeTruthy();
    }
    expect(shellColors("dark").pageBg).not.toBe(shellColors("light").pageBg);
  });

  it("圆角令牌与 antd token 同源", () => {
    const c = shellColors("light");
    expect(c.radius).toBe(8);
    expect(c.radiusLg).toBe(12);
    expect(c.radiusXl).toBe(16);
    expect(c.radiusSm).toBe(6);
  });

  it("选中态用中性底与主文字，不引入彩色", () => {
    const c = shellColors("light");
    expect(c.activeBg).toBe(c.mutedBg);
    expect(c.activeText).toBe(c.text);
  });
});

describe("neutralTagStyle（元数据标签中性化，ADR 0034 与 0037）", () => {
  it("中性底与次级文字都取 CSS 变量，调用方不必知道明暗模式", () => {
    expect(neutralTagStyle.borderColor).toBe("transparent");
    expect(neutralTagStyle.background).toBe("var(--ldc-muted-bg)");
    expect(neutralTagStyle.color).toBe("var(--ldc-text-secondary)");
    expect(neutralTagStyle.fontSize).toBe(11);
  });
});

describe("themeCssVars（--ldc-* 与旧名 --tod-*）", () => {
  it("两种模式暴露同一组键（App 注入不因模式缺变量）", () => {
    expect(Object.keys(themeCssVars("dark")).sort()).toEqual(
      Object.keys(themeCssVars("light")).sort(),
    );
  });

  it("LDC 变量覆盖表面、文字、主色、语义色与圆角", () => {
    const vars = themeCssVars("light");
    const c = shellColors("light");
    expect(vars["--ldc-page-bg"]).toBe(c.pageBg);
    expect(vars["--ldc-panel-bg"]).toBe(c.panelBg);
    expect(vars["--ldc-border"]).toBe(c.border);
    expect(vars["--ldc-text"]).toBe(c.text);
    expect(vars["--ldc-primary"]).toBe(c.primary);
    expect(vars["--ldc-info"]).toBe(c.info);
    expect(vars["--ldc-radius"]).toBe("8px");
    expect(vars["--ldc-radius-lg"]).toBe("12px");
  });

  it("旧名 --tod-* 仍解析到同一色板：气泡、边框、强调色随明暗切换", () => {
    const light = themeCssVars("light");
    const dark = themeCssVars("dark");
    expect(light["--tod-user-bubble"]).toBe(shellColors("light").primary);
    expect(light["--tod-user-bubble-text"]).toBe(shellColors("light").onPrimary);
    expect(dark["--tod-border"]).toBe(shellColors("dark").border);
    expect(dark["--tod-accent"]).toBe(shellColors("dark").info);
    expect(light["--tod-accent"]).not.toBe(dark["--tod-accent"]);
  });
});
