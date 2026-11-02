import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

export const STARTUP_VIEWS = ["bookshelf", "continue"] as const;
export type StartupView = (typeof STARTUP_VIEWS)[number];

export const BOOKSHELF_SORTS = ["recent", "title", "author", "added"] as const;
export type BookshelfSort = (typeof BOOKSHELF_SORTS)[number];

export type AppSettings = {
  /** 冷启动落在书架，还是直接接着上次读的书。 */
  startupView: StartupView;
  bookshelfSort: BookshelfSort;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  startupView: "bookshelf",
  bookshelfSort: "recent",
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
      reset: () => set({ ...DEFAULT_APP_SETTINGS }),
    }),
    {
      name: "deer-app-settings",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
      partialize: ({ startupView, bookshelfSort }) => ({
        startupView,
        bookshelfSort,
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
        };
      },
    },
  ),
);