import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { DEFAULT_AI_ENGINE, isAiEngineId } from "@/lib/ai/engines";

export const STARTUP_VIEWS = ["bookshelf", "continue"] as const;
export type StartupView = (typeof STARTUP_VIEWS)[number];

export const BOOKSHELF_SORTS = ["recent", "title", "author", "added"] as const;
export type BookshelfSort = (typeof BOOKSHELF_SORTS)[number];

export type AppSettings = {
  /** 冷启动落在书架，还是直接接着上次读的书。 */
  startupView: StartupView;
  bookshelfSort: BookshelfSort;
  /** AI 伴读选中的引擎（acpx agent id），聊天与会话命名都按它走。 */
  aiEngine: string;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  startupView: "bookshelf",
  bookshelfSort: "recent",
  aiEngine: DEFAULT_AI_ENGINE,
};

export function isStartupView(value: string): value is StartupView {
  return (STARTUP_VIEWS as readonly string[]).includes(value);
}

export function isBookshelfSort(value: string): value is BookshelfSort {
  return (BOOKSHELF_SORTS as readonly string[]).includes(value);
}

type AppSettingsStore = AppSettings & {
  setStartupView(startupView: StartupView): void;
  setBookshelfSort(bookshelfSort: BookshelfSort): void;
  setAiEngine(aiEngine: string): void;
  reset(): void;
};

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useAppSettings = create<AppSettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_APP_SETTINGS,
      setStartupView: (startupView) => set({ startupView }),
      setBookshelfSort: (bookshelfSort) => set({ bookshelfSort }),
      setAiEngine: (aiEngine) => set({ aiEngine }),
      reset: () => set({ ...DEFAULT_APP_SETTINGS }),
    }),
    {
      name: "deer-app-settings",
      version: 2,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
      partialize: ({ startupView, bookshelfSort, aiEngine }) => ({
        startupView,
        bookshelfSort,
        aiEngine,
      }),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...state,
          startupView:
            typeof state.startupView === "string" &&
            isStartupView(state.startupView)
              ? state.startupView
              : DEFAULT_APP_SETTINGS.startupView,
          bookshelfSort:
            typeof state.bookshelfSort === "string" &&
            isBookshelfSort(state.bookshelfSort)
              ? state.bookshelfSort
              : DEFAULT_APP_SETTINGS.bookshelfSort,
          aiEngine:
            typeof state.aiEngine === "string" && isAiEngineId(state.aiEngine)
              ? state.aiEngine
              : DEFAULT_APP_SETTINGS.aiEngine,
        };
      },
    },
  ),
);