import { create } from "zustand";
import type { BookBriefingData } from "@/lib/ai/bookBriefing";

/**
 * 开读简报缓存：同书生成一次后落盘，重开不重新生成。
 * 与概念地图缓存同构，只是粒度为整本书（key 就是 bookId）。
 */

export type CachedBookBriefing = BookBriefingData & {
  /** 生成时间，界面上提示「生成于」用。 */
  createdAt: number;
};

type BookBriefingState = {
  /** bookId -> 该书的开读简报。 */
  briefings: Record<string, CachedBookBriefing>;
  ready: boolean;
};

export type BookBriefingStore = BookBriefingState & {
  load(): Promise<void>;
  get(bookId: string): CachedBookBriefing | undefined;
  save(bookId: string, data: BookBriefingData): void;
  remove(bookId: string): void;
};

const STORE_FILE = "briefings.json";
const STORE_KEY = "briefings";
const LS_KEY = "deer.briefings.v1";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object)
  );
}

const EMPTY: BookBriefingState = { briefings: {}, ready: false };

async function readPersisted(): Promise<BookBriefingState | null> {
  try {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(STORE_FILE, { autoSave: false });
      const value = await store.get<BookBriefingState>(STORE_KEY);
      return value ? { ...EMPTY, ...value } : null;
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw
      ? { ...EMPTY, ...(JSON.parse(raw) as BookBriefingState) }
      : null;
  } catch (err) {
    console.error("[briefing] 读取缓存失败，按空库启动", err);
    return null;
  }
}

async function writePersisted(state: BookBriefingState): Promise<void> {
  const data: BookBriefingState = { briefings: state.briefings, ready: true };
  try {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(STORE_FILE, { autoSave: false });
      await store.set(STORE_KEY, data);
      await store.save();
      return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("[briefing] 写入缓存失败", err);
  }
}

export const useBookBriefingStore = create<BookBriefingStore>((set, get) => ({
  ...EMPTY,

  async load() {
    const data = await readPersisted();
    set({ ...EMPTY, ...(data ?? {}), ready: true });
  },

  get(bookId) {
    return get().briefings[bookId];
  },

  save(bookId, data) {
    set((s) => ({
      briefings: {
        ...s.briefings,
        [bookId]: { ...data, createdAt: Date.now() },
      },
    }));
    void writePersisted(get());
  },

  remove(bookId) {
    set((s) => {
      const briefings = { ...s.briefings };
      delete briefings[bookId];
      return { briefings };
    });
    void writePersisted(get());
  },
}));
