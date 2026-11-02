import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

/** 阅读页目录栏宽度：克制区间，避免把正文挤瘦。 */
export const TOC_MIN_WIDTH = 240;
export const TOC_MAX_WIDTH = 440;
export const TOC_DEFAULT_WIDTH = 280;
/** 键盘方向键单次步长。 */
export const TOC_WIDTH_STEP = 8;

export function clampTocWidth(width: number): number {
  if (!Number.isFinite(width)) return TOC_DEFAULT_WIDTH;
  return Math.min(TOC_MAX_WIDTH, Math.max(TOC_MIN_WIDTH, Math.round(width)));
}

type ReaderLayoutStore = {
  tocWidth: number;
  setTocWidth(width: number): void;
  resetTocWidth(): void;
};

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useReaderLayout = create<ReaderLayoutStore>()(
  persist(
    (set) => ({
      tocWidth: TOC_DEFAULT_WIDTH,
      setTocWidth: (width) => set({ tocWidth: clampTocWidth(width) }),
      resetTocWidth: () => set({ tocWidth: TOC_DEFAULT_WIDTH }),
    }),
    {
      name: "deer-reader-layout",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
      partialize: ({ tocWidth }) => ({ tocWidth }),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        return {
          tocWidth: clampTocWidth(
            typeof state.tocWidth === "number"
              ? state.tocWidth
              : TOC_DEFAULT_WIDTH,
          ),
        };
      },
    },
  ),
);
