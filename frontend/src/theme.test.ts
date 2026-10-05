import { describe, expect, it } from "vitest";
import { themeBehavior, themeCssVars, themeTokens } from "./theme";

describe("themeBehavior（#409）", () => {
  it("motion 关闭——全部过渡动画停用（去卡通感）", () => {
    expect(themeBehavior.motion).toBe(false);
  });

  it("wireframe 开启——组件平面化，去渐变、阴影改边框式", () => {
    expect(themeBehavior.wireframe).toBe(true);
  });
});

describe("themeTokens（#409）", () => {
  it("圆角全系列统一为 2px（严肃直角风格，偏离 antd 默认 6-8px）", () => {
    expect(themeTokens.borderRadius).toBe(2);
    expect(themeTokens.borderRadiusLG).toBe(2);
    expect(themeTokens.borderRadiusSM).toBe(2);
    expect(themeTokens.borderRadiusXS).toBe(2);
    expect(themeTokens.borderRadiusOuter).toBe(2);
  });

  it("控件高度收紧为桌面工具密度（antd 默认 32/24/40）", () => {
    expect(themeTokens.controlHeight).toBe(26);
    expect(themeTokens.controlHeightSM).toBe(22);
    expect(themeTokens.controlHeightLG).toBe(30);
  });

  it("阴影收平为一层浅投影（替换 antd 默认多层大扩散阴影）", () => {
    expect(themeTokens.boxShadow).toBe("0 1px 2px rgba(0, 0, 0, 0.10)");
    expect(themeTokens.boxShadowSecondary).toBe("0 2px 6px rgba(0, 0, 0, 0.12)");
  });

  it("字体为桌面系统 UI 栈（Windows 上 Segoe UI + 雅黑）", () => {
    expect(themeTokens.fontFamily).toContain("Segoe UI");
    expect(themeTokens.fontFamily).toContain("Microsoft YaHei UI");
  });

  it("主色与信息色为收敛深蓝 #0958d9（替换 antd 默认亮蓝）", () => {
    expect(themeTokens.colorPrimary).toBe("#0958d9");
    expect(themeTokens.colorInfo).toBe("#0958d9");
  });

  it("语义色沿用 antd 默认：绿=成功、橙=警告、红=错误", () => {
    expect(themeTokens.colorSuccess).toBe("#52c41a");
    expect(themeTokens.colorWarning).toBe("#faad14");
    expect(themeTokens.colorError).toBe("#ff4d4f");
  });
});

describe("themeCssVars（--tod-* 主题变量，修复助手边栏深色缺失，#450）", () => {
  it("浅色值 = 各消费端 var(--tod-*, fallback) 的既有 fallback，浅色零回归", () => {
    expect(themeCssVars("light")).toEqual({
      "--tod-border": "#e8e8e8",
      "--tod-panel-bg": "transparent",
      "--tod-user-bubble": "#0958d9",
      "--tod-assistant-bubble": "rgba(128,128,128,0.10)",
      "--tod-text-secondary": "#8c8c8c",
      "--tod-card-bg": "rgba(128,128,128,0.06)",
      "--tod-code-bg": "rgba(128,128,128,0.1)",
    });
  });

  it("深色值：边框/气泡/卡片底随主题变深，主色与次要文字保持不变", () => {
    const dark = themeCssVars("dark");
    const light = themeCssVars("light");
    expect(dark["--tod-border"]).not.toBe(light["--tod-border"]);
    expect(dark["--tod-panel-bg"]).not.toBe(light["--tod-panel-bg"]);
    expect(dark["--tod-assistant-bubble"]).not.toBe(light["--tod-assistant-bubble"]);
    expect(dark["--tod-card-bg"]).not.toBe(light["--tod-card-bg"]);
    expect(dark["--tod-code-bg"]).not.toBe(light["--tod-code-bg"]);
    // 与 App 深色界面同源：边框 #303030、面板 #1a1a1a
    expect(dark["--tod-border"]).toBe("#303030");
    expect(dark["--tod-panel-bg"]).toBe("#1a1a1a");
    expect(dark["--tod-user-bubble"]).toBe("#0958d9");
    expect(dark["--tod-text-secondary"]).toBe("#8c8c8c");
  });

  it("两种模式暴露同一组键（App 注入不因模式缺变量）", () => {
    expect(Object.keys(themeCssVars("dark")).sort()).toEqual(
      Object.keys(themeCssVars("light")).sort(),
    );
  });
});
