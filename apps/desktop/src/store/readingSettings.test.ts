import { beforeEach, describe, expect, it } from "vitest";
import { resolveTheme } from "@/lib/theme";
import {
  DEFAULT_READING_SETTINGS,
  isFontSize,
  isLineHeight,
  isPageFlow,
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
    expect(DEFAULT_READING_SETTINGS).toEqual({
      fontSize: 15,
      lineHeight: 1.8,
      theme: "system",
      paperColor: "#ffffff",
      pageFlow: "paginated",
    });
  });

  it("设置项可独立更新，互不影响", () => {
    useReadingSettings.getState().setFontSize(19);
    useReadingSettings.getState().setLineHeight(2.0);
    useReadingSettings.getState().setTheme("dark");
    useReadingSettings.getState().setPaperColor("#c7edcc");
    useReadingSettings.getState().setPageFlow("scrolled");

    const state = useReadingSettings.getState();
    expect(state.fontSize).toBe(19);
    expect(state.lineHeight).toBe(2.0);
    expect(state.theme).toBe("dark");
    expect(state.paperColor).toBe("#c7edcc");
    expect(state.pageFlow).toBe("scrolled");
  });

  it("reset 回到默认值", () => {
    useReadingSettings.getState().setFontSize(14);
    useReadingSettings.getState().setTheme("light");
    useReadingSettings.getState().setPaperColor("#f5eede");
    useReadingSettings.getState().setPageFlow("scrolled");
    useReadingSettings.getState().reset();

    const state = useReadingSettings.getState();
    expect(state.fontSize).toBe(15);
    expect(state.theme).toBe("system");
    expect(state.paperColor).toBe("#ffffff");
    expect(state.pageFlow).toBe("paginated");
  });

  it("v1 迁移补上纸色/翻页方式默认值，v2 非法值也兜底", () => {
    const migrate = useReadingSettings.persist.getOptions().migrate;
    expect(migrate?.({ fontSize: 17 }, 1)).toMatchObject({
      paperColor: "#ffffff",
      pageFlow: "paginated",
      fontSize: 17,
    });
    expect(migrate?.({ paperColor: "#ff0000", pageFlow: "diagonal" }, 2)).toEqual({
      paperColor: "#ffffff",
      pageFlow: "paginated",
    });
  });

  it("isPaperColor / isPageFlow 只认预设档位", () => {
    expect(isPaperColor("#f5eede")).toBe(true);
    expect(isPaperColor("#123456")).toBe(false);
    expect(isPageFlow("scrolled")).toBe(true);
    expect(isPageFlow("diagonal")).toBe(false);
  });
});

describe("选项守卫", () => {
  it("只放行设计 token 里的字号与行距", () => {
    expect(isFontSize(15)).toBe(true);
    expect(isFontSize(16)).toBe(false);
    expect(isLineHeight(1.8)).toBe(true);
    expect(isLineHeight(1.9)).toBe(false);
  });
});
