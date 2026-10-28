import { beforeEach, describe, expect, it } from "vitest";
import { resolveTheme } from "@/lib/theme";
import {
  DEFAULT_READING_SETTINGS,
  isFontSize,
  isLineHeight,
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
    expect(DEFAULT_READING_SETTINGS).toEqual({
      fontSize: 15,
      lineHeight: 1.8,
      theme: "system",
    });
  });

  it("设置项可独立更新，互不影响", () => {
    useReadingSettings.getState().setFontSize(19);
    useReadingSettings.getState().setLineHeight(2.0);
    useReadingSettings.getState().setTheme("dark");

    const state = useReadingSettings.getState();
    expect(state.fontSize).toBe(19);
    expect(state.lineHeight).toBe(2.0);
    expect(state.theme).toBe("dark");
  });

  it("reset 回到默认值", () => {
    useReadingSettings.getState().setFontSize(14);
    useReadingSettings.getState().setTheme("light");
    useReadingSettings.getState().reset();

    const state = useReadingSettings.getState();
    expect(state.fontSize).toBe(15);
    expect(state.theme).toBe("system");
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
