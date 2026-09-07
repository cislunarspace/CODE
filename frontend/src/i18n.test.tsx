// 词典单测：界面固定简体中文——词条完整、多组件共享同一中文翻译、
// 挂载后 <html lang> 固定为 zh-CN、缺失 key 原样返回暴露漏配。

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation, translations } from "./i18n";

describe("i18n 词典（固定中文）", () => {
  it("每个词条非空字符串且键非空", () => {
    for (const [key, value] of Object.entries(translations)) {
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("词典不含语言切换词条", () => {
    expect(Object.keys(translations)).not.toContain("app.lang_toggle_title");
  });
});

/** 测试桩：渲染一条词典文案，探针语义与消费组件一致。 */
function ZhProbe() {
  const { t } = useTranslation();
  return <span>{t("action.save")}</span>;
}

beforeEach(() => {
  document.documentElement.lang = "";
});

describe("i18n 中文共享状态", () => {
  it("同一 Provider 下两个组件渲染同一中文文案", () => {
    render(
      <I18nProvider>
        <ZhProbe />
        <ZhProbe />
      </I18nProvider>,
    );
    expect(screen.getAllByText("保存")).toHaveLength(2);
  });

  it("无 Provider 裸渲染同样取中文词典", () => {
    render(<ZhProbe />);
    expect(screen.getByText("保存")).toBeDefined();
  });

  it("挂载后将 document.documentElement.lang 固定为 zh-CN", () => {
    render(
      <I18nProvider>
        <ZhProbe />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe("zh-CN");
  });
  it("缺失 key 返回 key 本身，暴露开发期漏配", () => {
    function MissingKeyProbe() {
      const { t } = useTranslation();
      return <span data-testid="missing-key">{t("definitely.not.a.key")}</span>;
    }
    render(
      <I18nProvider>
        <MissingKeyProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("missing-key").textContent).toBe("definitely.not.a.key");
  });
});
