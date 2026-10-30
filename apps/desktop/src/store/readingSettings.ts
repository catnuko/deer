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

/** 阅读纸色预设：仅浅色主题生效，深色主题维持深色背景。 */
export const PAPER_COLORS = {
  "#ffffff": "白",
  "#f5eede": "米黄",
  "#c7edcc": "豆沙绿",
  "#e9e7e2": "浅灰",
} as const;
export type PaperColor = keyof typeof PAPER_COLORS;
export const PAPER_COLOR_DEFAULT: PaperColor = "#ffffff";

export const PAGE_FLOWS = ["paginated", "scrolled"] as const;
export type PageFlow = (typeof PAGE_FLOWS)[number];
export const PAGE_FLOW_DEFAULT: PageFlow = "paginated";

export type ReadingSettings = {
  fontSize: FontSize;
  lineHeight: LineHeight;
  theme: ReadingTheme;
  paperColor: PaperColor;
  pageFlow: PageFlow;
};

/** 默认值按 docs/design-handoff/tokens.md：正文 serif 15px / 行高 1.8。 */
export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  fontSize: 15,
  lineHeight: 1.8,
  theme: "system",
  paperColor: PAPER_COLOR_DEFAULT,
  pageFlow: PAGE_FLOW_DEFAULT,
};

export function isFontSize(value: number): value is FontSize {
  return (FONT_SIZES as readonly number[]).includes(value);
}

export function isLineHeight(value: number): value is LineHeight {
  return (LINE_HEIGHTS as readonly number[]).includes(value);
}

export function isPaperColor(value: string): value is PaperColor {
  return value in PAPER_COLORS;
}

export function isPageFlow(value: string): value is PageFlow {
  return (PAGE_FLOWS as readonly string[]).includes(value);
}

type ReadingSettingsStore = ReadingSettings & {
  setFontSize(fontSize: FontSize): void;
  setLineHeight(lineHeight: LineHeight): void;
  setTheme(theme: ReadingTheme): void;
  setPaperColor(paperColor: PaperColor): void;
  setPageFlow(pageFlow: PageFlow): void;
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
      setPaperColor: (paperColor) => set({ paperColor }),
      setPageFlow: (pageFlow) => set({ pageFlow }),
      reset: () => set({ ...DEFAULT_READING_SETTINGS }),
    }),
    {
      name: "deer-reading-settings",
      version: 2,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
      partialize: ({ fontSize, lineHeight, theme, paperColor, pageFlow }) => ({
        fontSize,
        lineHeight,
        theme,
        paperColor,
        pageFlow,
      }),
      // v1 没有纸色/翻页方式；非预设值（手改 localStorage）一律兜底默认。
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...state,
          paperColor:
            typeof state.paperColor === "string" &&
            isPaperColor(state.paperColor)
              ? state.paperColor
              : PAPER_COLOR_DEFAULT,
          pageFlow:
            typeof state.pageFlow === "string" && isPageFlow(state.pageFlow)
              ? state.pageFlow
              : PAGE_FLOW_DEFAULT,
        };
      },
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
