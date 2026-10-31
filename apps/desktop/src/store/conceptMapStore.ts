import { create } from "zustand";
import type { ConceptMapData } from "@/lib/ai/conceptMap";

/**
 * 概念地图缓存（R2）：同书同章生成一次后落盘，重开不重新生成。
 * key 由调用方拼好（bookId + 章节标识），store 只管存取和持久化。
 */

export type CachedConceptMap = ConceptMapData & {
  /** 生成时间，界面上提示「生成于」用。 */
  createdAt: number;
};

type ConceptMapState = {
  /** "bookId::chapterKey" -> 该章的概念地图。 */
  maps: Record<string, CachedConceptMap>;
  ready: boolean;
};

export type ConceptMapStore = ConceptMapState & {
  load(): Promise<void>;
  get(bookId: string, chapterKey: string): CachedConceptMap | undefined;
  save(bookId: string, chapterKey: string, data: ConceptMapData): void;
  remove(bookId: string, chapterKey: string): void;
};

/** 缓存 key：概念地图按「书 + 章」隔离。 */
export function conceptMapKey(bookId: string, chapterKey: string): string {
  return `${bookId}::${chapterKey}`;
}

const STORE_FILE = "conceptmaps.json";
const STORE_KEY = "conceptmaps";
const LS_KEY = "deer.conceptmaps.v1";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object)
  );
}

const EMPTY: ConceptMapState = { maps: {}, ready: false };

async function readPersisted(): Promise<ConceptMapState | null> {
  try {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(STORE_FILE, { autoSave: false });
      const value = await store.get<ConceptMapState>(STORE_KEY);
      return value ? { ...EMPTY, ...value } : null;
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw
      ? { ...EMPTY, ...(JSON.parse(raw) as ConceptMapState) }
      : null;
  } catch (err) {
    console.error("[conceptmap] 读取缓存失败，按空库启动", err);
    return null;
  }
}

async function writePersisted(state: ConceptMapState): Promise<void> {
  const data: ConceptMapState = { maps: state.maps, ready: true };
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
    console.error("[conceptmap] 写入缓存失败", err);
  }
}

export const useConceptMapStore = create<ConceptMapStore>((set, get) => ({
  ...EMPTY,

  async load() {
    const data = await readPersisted();
    set({ ...EMPTY, ...(data ?? {}), ready: true });
  },

  get(bookId, chapterKey) {
    return get().maps[conceptMapKey(bookId, chapterKey)];
  },

  save(bookId, chapterKey, data) {
    set((s) => ({
      maps: {
        ...s.maps,
        [conceptMapKey(bookId, chapterKey)]: { ...data, createdAt: Date.now() },
      },
    }));
    void writePersisted(get());
  },

  remove(bookId, chapterKey) {
    set((s) => {
      const maps = { ...s.maps };
      delete maps[conceptMapKey(bookId, chapterKey)];
      return { maps };
    });
    void writePersisted(get());
  },
}));
