import { create } from "zustand";

/**
 * 读书记忆（按书维度）：跨会话记住与每本书的讨论，供后续
 * 「提取写入」「prompt 注入」「设置页管理」共用。
 * 桌面端走 Tauri plugin-store（memory.json），浏览器（Vite 预览）退化为 localStorage。
 */

/** 记忆类型：讨论主题 / 用户偏好 / 进度上下文。 */
export type MemoryEntryType = "topic" | "preference" | "progress";

export type MemoryEntry = {
  id: string;
  bookId: string;
  type: MemoryEntryType;
  /** 记忆文本，注入 prompt 时直接拼接。 */
  content: string;
  /** 来源会话（chatStore 的 threadId）；手工添加的记忆缺省。 */
  sourceThreadId?: string;
  createdAt: number;
  updatedAt: number;
};

/** upsert 入参：带 id 视为更新（缺失字段保留旧值），不带 id 视为新增。 */
export type MemoryEntryInput = {
  id?: string;
  bookId: string;
  type: MemoryEntryType;
  content: string;
  sourceThreadId?: string;
};

type MemoryState = {
  /** bookId -> 该书的记忆（新写的在前）。 */
  memories: Record<string, MemoryEntry[]>;
  ready: boolean;
};

export type MemoryStore = MemoryState & {
  load(): Promise<void>;
  listByBook(bookId: string): MemoryEntry[];
  /** 批量写入：返回写入后的条目（新增带生成的 id，更新带新的 updatedAt）。 */
  upsertEntries(inputs: MemoryEntryInput[]): MemoryEntry[];
  /** 只改文本与类型，不动归属书与会话来源。 */
  updateEntry(id: string, patch: { type?: MemoryEntryType; content?: string }): void;
  deleteEntry(id: string): void;
  /** 清空一本书的全部记忆（设置页「按书清除」）。 */
  clearByBook(bookId: string): void;
  /** 清空全部书的记忆（设置页「清空记忆」）。 */
  clearAll(): void;
};

const STORE_FILE = "memory.json";
const STORE_KEY = "memory";
const LS_KEY = "deer.memory.v1";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object)
  );
}

const EMPTY: MemoryState = { memories: {}, ready: false };

async function readPersisted(): Promise<MemoryState | null> {
  try {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(STORE_FILE, { autoSave: false });
      const value = await store.get<MemoryState>(STORE_KEY);
      return value ? { ...EMPTY, ...value } : null;
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as MemoryState) } : null;
  } catch (err) {
    console.error("[memory] 读取记忆失败，按空库启动", err);
    return null;
  }
}

async function writePersisted(state: MemoryState): Promise<void> {
  const data: MemoryState = { memories: state.memories, ready: true };
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
    console.error("[memory] 写入记忆失败", err);
  }
}

function id(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `mem_${rand}`;
}

/** 在按书分组的列表里找到条目，返回 [bookId, 列表下标]。 */
function locate(
  memories: MemoryState["memories"],
  entryId: string,
): [string, number] | null {
  for (const [bookId, list] of Object.entries(memories)) {
    const index = list.findIndex((m) => m.id === entryId);
    if (index >= 0) return [bookId, index];
  }
  return null;
}

export const useMemoryStore = create<MemoryStore>((set, get) => {
  const persist = () => {
    void writePersisted(get());
  };

  return {
    ...EMPTY,

    async load() {
      const data = await readPersisted();
      set({ ...EMPTY, ...(data ?? {}), ready: true });
    },

    listByBook(bookId) {
      return get().memories[bookId] ?? [];
    },

    upsertEntries(inputs) {
      const created: MemoryEntry[] = [];
      set((s) => {
        const memories = { ...s.memories };
        for (const input of inputs) {
          const existing = input.id ? locate(memories, input.id) : null;
          if (existing) {
            const [bookId, index] = existing;
            const old = memories[bookId][index];
            const next: MemoryEntry = {
              ...old,
              type: input.type ?? old.type,
              content: input.content ?? old.content,
              ...(input.sourceThreadId !== undefined
                ? { sourceThreadId: input.sourceThreadId }
                : {}),
              updatedAt: Date.now(),
            };
            memories[bookId] = memories[bookId].map((m, i) =>
              i === index ? next : m,
            );
            created.push(next);
            continue;
          }
          const now = Date.now();
          const entry: MemoryEntry = {
            id: input.id ?? id(),
            bookId: input.bookId,
            type: input.type,
            content: input.content,
            ...(input.sourceThreadId ? { sourceThreadId: input.sourceThreadId } : {}),
            createdAt: now,
            updatedAt: now,
          };
          memories[input.bookId] = [entry, ...(memories[input.bookId] ?? [])];
          created.push(entry);
        }
        return { memories };
      });
      persist();
      return created;
    },

    updateEntry(id, patch) {
      set((s) => {
        const found = locate(s.memories, id);
        if (!found) return s;
        const [bookId, index] = found;
        const memories = { ...s.memories };
        memories[bookId] = memories[bookId].map((m, i) =>
          i === index ? { ...m, ...patch, updatedAt: Date.now() } : m,
        );
        return { memories };
      });
      persist();
    },

    deleteEntry(id) {
      set((s) => {
        const found = locate(s.memories, id);
        if (!found) return s;
        const [bookId, index] = found;
        const memories = { ...s.memories };
        memories[bookId] = memories[bookId].filter((_, i) => i !== index);
        return { memories };
      });
      persist();
    },

    clearByBook(bookId) {
      set((s) => {
        if (!s.memories[bookId]) return s;
        const memories = { ...s.memories };
        delete memories[bookId];
        return { memories };
      });
      persist();
    },

    clearAll() {
      set({ memories: {} });
      persist();
    },
  };
});
