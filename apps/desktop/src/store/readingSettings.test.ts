import { beforeEach, describe, expect, it } from "vitest";
import { resolveTheme } from "@/lib/theme";
import {
  DEFAULT_READING_SETTINGS,
  isFontFamily,
  isFontSize,
  isLineHeight,
  isPageFlow,
  isPageMargin,
  isPageTurn,
  isPaperColor,
  useReadingSettings,
} from "@/store/readingSettings";

describe("resolveTheme", () => {
  it("显式主题直接生效", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("跟随系统时取系统偏好", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("readingSettings store", () => {
  beforeEach(() => {
    useReadingSettings.getState().reset();
  });

  it("默认值符合设计 token（15px / 1.8 / 跟随系统）", () => {
    const state = useReadingSettings.getState();
    expect(state.fontSize).toBe(15);
    expect(state.lineHeight).toBe(1.8);
    expect(state.theme).toBe("system");
    expect(state.paperColor).toBe("#ffffff");
    expect(state.pageFlow).toBe("paginated");
    expect(state.fontFamily).toBe("book");
    expect(state.pageMargin).toBe("medium");
    expect(state.pageTurn).toBe("slide");
    expect(state.footnotePreview).toBe(true);
    expect(DEFAULT_READING_SETTINGS).toEqual({
      fontSize: 15,
      lineHeight: 1.8,
      theme: "system",
      paperColor: "#ffffff",
      pageFlow: "paginated",
      fontFamily: "book",
      pageMargin: "medium",
      pageTurn: "slide",
      footnotePreview: true,
    });
  });

  it("设置项可独立更新，互不影响", () => {
    useReadingSettings.getState().setFontSize(19);
    useReadingSettings.getState().setLineHeight(2.0);
    useReadingSettings.getState().setTheme("dark");
    useReadingSettings.getState().setPaperColor("#c7edcc");
    useReadingSettings.getState().setPageFlow("scrolled");
    useReadingSettings.getState().setFontFamily("sans");
    useReadingSettings.getState().setPageMargin("wide");
    useReadingSettings.getState().setPageTurn("fade");
    useReadingSettings.getState().setFootnotePreview(false);

    const state = useReadingSettings.getState();
    expect(state.fontSize).toBe(19);
    expect(state.lineHeight).toBe(2.0);
    expect(state.theme).toBe("dark");
    expect(state.paperColor).toBe("#c7edcc");
    expect(state.pageFlow).toBe("scrolled");
    expect(state.fontFamily).toBe("sans");
    expect(state.pageMargin).toBe("wide");
    expect(state.pageTurn).toBe("fade");
    expect(state.footnotePreview).toBe(false);
  });

  it("reset 回到默认值", () => {
    useReadingSettings.getState().setFontSize(14);
    useReadingSettings.getState().setTheme("light");
    useReadingSettings.getState().setPaperColor("#f5eede");
    useReadingSettings.getState().setPageFlow("scrolled");
    useReadingSettings.getState().setFontFamily("serif");
    useReadingSettings.getState().setPageMargin("narrow");
    useReadingSettings.getState().setPageTurn("fade");
    useReadingSettings.getState().setFootnotePreview(false);
    useReadingSettings.getState().reset();

    const state = useReadingSettings.getState();
    expect(state.fontSize).toBe(15);
    expect(state.theme).toBe("system");
    expect(state.paperColor).toBe("#ffffff");
    expect(state.pageFlow).toBe("paginated");
    expect(state.fontFamily).toBe("book");
    expect(state.pageMargin).toBe("medium");
    expect(state.pageTurn).toBe("slide");
    expect(state.footnotePreview).toBe(true);
  });

  it("v2 升级保留全部旧值，新字段补默认", () => {
    const migrate = useReadingSettings.persist.getOptions().migrate;
    expect(
      migrate?.(
        {
          fontSize: 17,
          lineHeight: 1.6,
          theme: "dark",
          paperColor: "#c7edcc",
          pageFlow: "scrolled",
        },
        2,
      ),
    ).toMatchObject({
      fontSize: 17,
      lineHeight: 1.6,
      theme: "dark",
      paperColor: "#c7edcc",
      pageFlow: "scrolled",
      fontFamily: "book",
      pageMargin: "medium",
      pageTurn: "slide",
      footnotePreview: true,
    });
  });

  it("v1 迁移补上纸色/翻页方式默认值，非法值也兜底", () => {
    const migrate = useReadingSettings.persist.getOptions().migrate;
    expect(migrate?.({ fontSize: 17 }, 1)).toMatchObject({
      paperColor: "#ffffff",
      pageFlow: "paginated",
      fontSize: 17,
    });
    expect(
      migrate?.({
        paperColor: "#ff0000",
        pageFlow: "diagonal",
        fontFamily: "mono",
        pageMargin: "huge",
        fontSize: 16,
        lineHeight: 3,
        theme: "blue",
        pageTurnAnimation: "yes",
      }, 2),
    ).toMatchObject({
      paperColor: "#ffffff",
      pageFlow: "paginated",
      fontFamily: "book",
      pageMargin: "medium",
      fontSize: 15,
      lineHeight: 1.8,
      theme: "system",
      pageTurn: "slide",
    });
  });

  it("v3→v4：旧布尔翻页动画一律迁到滑动，已存的三档原样保留", () => {
    const migrate = useReadingSettings.persist.getOptions().migrate;
    for (const legacy of [true, false]) {
      const next = migrate?.({ pageTurnAnimation: legacy }, 3) as {
        pageTurn: string;
        pageTurnAnimation?: unknown;
      };
      expect(next.pageTurn).toBe("slide");
      expect("pageTurnAnimation" in next).toBe(false);
    }
    expect(
      (migrate?.({ pageTurn: "off" }, 4) as { pageTurn: string }).pageTurn,
    ).toBe("off");
    expect(
      (migrate?.({ pageTurn: "fade" }, 4) as { pageTurn: string }).pageTurn,
    ).toBe("fade");
    expect(
      (migrate?.({ pageTurn: "bogus" }, 4) as { pageTurn: string }).pageTurn,
    ).toBe("slide");
  });

  it("isPaperColor / isPageFlow / isPageTurn 只认预设档位", () => {
    expect(isPaperColor("#f5eede")).toBe(true);
    expect(isPaperColor("#123456")).toBe(false);
    expect(isPageFlow("scrolled")).toBe(true);
    expect(isPageFlow("diagonal")).toBe(false);
    expect(isPageTurn("slide")).toBe(true);
    expect(isPageTurn("fade")).toBe(true);
    expect(isPageTurn("off")).toBe(true);
    expect(isPageTurn("fancy")).toBe(false);
  });
});

describe("选项守卫", () => {
  it("只放行设计 token 里的字号与行距", () => {
    expect(isFontSize(22)).toBe(true);
    expect(isFontSize(16)).toBe(false);
    expect(isLineHeight(1.4)).toBe(true);
    expect(isLineHeight(1.9)).toBe(false);
  });

  it("字体与页边距只认三档", () => {
    expect(isFontFamily("sans")).toBe(true);
    expect(isFontFamily("mono")).toBe(false);
    expect(isPageMargin("wide")).toBe(true);
    expect(isPageMargin("huge")).toBe(false);
  });
});