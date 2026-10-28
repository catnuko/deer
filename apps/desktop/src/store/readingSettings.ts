import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { applyTheme, type ReadingTheme } from "@/lib/theme";

export const FONT_SIZES = [14, 15, 17, 19] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const LINE_HEIGHTS = [1.6, 1.8, 2.0] as const;
export type LineHeight = (typeof LINE_HEIGHTS)[number];

export type ReadingSettings = {
  fontSize: FontSize;
  lineHeight: LineHeight;
  theme: ReadingTheme;
};

/** 默认值按 docs/design-handoff/tokens.md：正文 serif 15px / 行高 1.8。 */
export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  fontSize: 15,
  lineHeight: 1.8,
  theme: "system",
};

export function isFontSize(value: number): value is FontSize {
  return (FONT_SIZES as readonly number[]).includes(value);
}

export function isLineHeight(value: number): value is LineHeight {
  return (LINE_HEIGHTS as readonly number[]).includes(value);
}

type ReadingSettingsStore = ReadingSettings & {
  setFontSize(fontSize: FontSize): void;
  setLineHeight(lineHeight: LineHeight): void;
  setTheme(theme: ReadingTheme): void;
  reset(): void;
};

/** 测试 / 非浏览器环境下没有 localStorage，用它兜底，保证 store 逻辑可测。 */
const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useReadingSettings = create<ReadingSettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_READING_SETTINGS,
      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setTheme: (theme) => set({ theme }),
      reset: () => set({ ...DEFAULT_READING_SETTINGS }),
    }),
    {
      name: "deer-reading-settings",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
      partialize: ({ fontSize, lineHeight, theme }) => ({
        fontSize,
        lineHeight,
        theme,
      }),
    },
  ),
);

let themeSyncStarted = false;

/**
 * 应用启动时把已保存的主题落到 <html>，并在「跟随系统」时跟随系统外观变化。
 * 幂等，可重复调用（React StrictMode 下会被调两次）。
 */
export function initThemeSync(): void {
  if (themeSyncStarted) return;
  themeSyncStarted = true;

  applyTheme(useReadingSettings.getState().theme);

  useReadingSettings.subscribe((state, previous) => {
    if (state.theme !== previous.theme) applyTheme(state.theme);
  });

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (useReadingSettings.getState().theme === "system") applyTheme("system");
    });
}
