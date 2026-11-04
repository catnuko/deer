import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { applyTheme, type ReadingTheme } from "@/lib/theme";

export const FONT_SIZES = [12, 14, 15, 17, 19, 22] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const LINE_HEIGHTS = [1.4, 1.6, 1.8, 2.0, 2.2] as const;
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

/** 翻页动效三档（motion.md §3.1）：关 / 淡入 / 滑动，默认滑动。 */
export const PAGE_TURN_MODES = ["off", "fade", "slide"] as const;
export type PageTurnMode = (typeof PAGE_TURN_MODES)[number];
export const PAGE_TURN_DEFAULT: PageTurnMode = "slide";

/**
 * 正文字体：book 跟随书籍自带排版，不注入 font-family；
 * serif / sans 只用系统字体，不打包字体文件。
 */
export const FONT_FAMILIES = ["book", "serif", "sans"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];
export const FONT_FAMILY_DEFAULT: FontFamily = "book";
export const FONT_FAMILY_CSS: Record<FontFamily, string | undefined> = {
  book: undefined,
  serif: '"Songti SC", "Noto Serif SC", Georgia, serif',
  sans: '"PingFang SC", "Helvetica Neue", Arial, sans-serif',
};

export const PAGE_MARGINS = ["narrow", "medium", "wide"] as const;
export type PageMargin = (typeof PAGE_MARGINS)[number];
export const PAGE_MARGIN_DEFAULT: PageMargin = "medium";
/** 正文左右内边距（px）：窄 12 / 适中 24 / 宽 40。 */
export const PAGE_MARGIN_PX: Record<PageMargin, number> = {
  narrow: 12,
  medium: 24,
  wide: 40,
};

export type ReadingSettings = {
  fontSize: FontSize;
  lineHeight: LineHeight;
  theme: ReadingTheme;
  paperColor: PaperColor;
  pageFlow: PageFlow;
  fontFamily: FontFamily;
  pageMargin: PageMargin;
  pageTurn: PageTurnMode;
  footnotePreview: boolean;
};

/** 默认值按 docs/design-handoff/tokens.md：正文 serif 15px / 行高 1.8。 */
export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  fontSize: 15,
  lineHeight: 1.8,
  theme: "system",
  paperColor: PAPER_COLOR_DEFAULT,
  pageFlow: PAGE_FLOW_DEFAULT,
  fontFamily: FONT_FAMILY_DEFAULT,
  pageMargin: PAGE_MARGIN_DEFAULT,
  pageTurn: PAGE_TURN_DEFAULT,
  footnotePreview: true,
};

const THEMES: readonly ReadingTheme[] = ["light", "dark", "system"];

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

export function isPageTurn(value: string): value is PageTurnMode {
  return (PAGE_TURN_MODES as readonly string[]).includes(value);
}

export function isFontFamily(value: string): value is FontFamily {
  return (FONT_FAMILIES as readonly string[]).includes(value);
}

export function isPageMargin(value: string): value is PageMargin {
  return (PAGE_MARGINS as readonly string[]).includes(value);
}

export function isReadingTheme(value: string): value is ReadingTheme {
  return (THEMES as readonly string[]).includes(value);
}

type ReadingSettingsStore = ReadingSettings & {
  setFontSize(fontSize: FontSize): void;
  setLineHeight(lineHeight: LineHeight): void;
  setTheme(theme: ReadingTheme): void;
  setPaperColor(paperColor: PaperColor): void;
  setPageFlow(pageFlow: PageFlow): void;
  setFontFamily(fontFamily: FontFamily): void;
  setPageMargin(pageMargin: PageMargin): void;
  setPageTurn(pageTurn: PageTurnMode): void;
  setFootnotePreview(footnotePreview: boolean): void;
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
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setPageMargin: (pageMargin) => set({ pageMargin }),
      setPageTurn: (pageTurn) => set({ pageTurn }),
      setFootnotePreview: (footnotePreview) => set({ footnotePreview }),
      reset: () => set({ ...DEFAULT_READING_SETTINGS }),
    }),
    {
      name: "deer-reading-settings",
      version: 4,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
      partialize: ({
        fontSize,
        lineHeight,
        theme,
        paperColor,
        pageFlow,
        fontFamily,
        pageMargin,
        pageTurn,
        footnotePreview,
      }) => ({
        fontSize,
        lineHeight,
        theme,
        paperColor,
        pageFlow,
        fontFamily,
        pageMargin,
        pageTurn,
        footnotePreview,
      }),
      // v1 没有纸色/翻页方式，v2 没有字体/页边距/动画/脚注开关，
      // v4 把布尔翻页动画换成三档。
      // 任何非法或缺失值一律回落默认，合法旧值全部保留。
      migrate: (persisted) => {
        const state = { ...(persisted ?? {}) } as Record<string, unknown>;
        // 旧布尔值 pageTurnAnimation（true/false）按拍板一律迁到「滑动」。
        delete state.pageTurnAnimation;
        return {
          ...state,
          fontSize:
            typeof state.fontSize === "number" && isFontSize(state.fontSize)
              ? state.fontSize
              : DEFAULT_READING_SETTINGS.fontSize,
          lineHeight:
            typeof state.lineHeight === "number" &&
            isLineHeight(state.lineHeight)
              ? state.lineHeight
              : DEFAULT_READING_SETTINGS.lineHeight,
          theme:
            typeof state.theme === "string" && isReadingTheme(state.theme)
              ? state.theme
              : DEFAULT_READING_SETTINGS.theme,
          paperColor:
            typeof state.paperColor === "string" &&
            isPaperColor(state.paperColor)
              ? state.paperColor
              : PAPER_COLOR_DEFAULT,
          pageFlow:
            typeof state.pageFlow === "string" && isPageFlow(state.pageFlow)
              ? state.pageFlow
              : PAGE_FLOW_DEFAULT,
          fontFamily:
            typeof state.fontFamily === "string" &&
            isFontFamily(state.fontFamily)
              ? state.fontFamily
              : FONT_FAMILY_DEFAULT,
          pageMargin:
            typeof state.pageMargin === "string" &&
            isPageMargin(state.pageMargin)
              ? state.pageMargin
              : PAGE_MARGIN_DEFAULT,
          pageTurn:
            typeof state.pageTurn === "string" && isPageTurn(state.pageTurn)
              ? state.pageTurn
              : PAGE_TURN_DEFAULT,
          footnotePreview:
            typeof state.footnotePreview === "boolean"
              ? state.footnotePreview
              : DEFAULT_READING_SETTINGS.footnotePreview,
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