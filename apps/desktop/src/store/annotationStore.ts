import { create } from "zustand";
import type { AnnotationStyle } from "@/components/reader/highlightColors";

/**
 * 划选高亮/笔记的持久化：按书分组，CFI 是回显与定位的 key。
 * 桌面端走 Tauri plugin-store，浏览器（Vite 预览）退化为 localStorage。
 */

export type StoredAnnotation = {
  id: string;
  /** foliate CFI，回显与点击命中的 key。 */
  cfi: string;
  /** 高亮色值（highlightColors 的 value）。 */
  color: string;
  /** 划线样式；旧数据无此字段，渲染层按 marker 处理。 */
  style?: AnnotationStyle;
  /** 划选时的文本摘录，编辑菜单与后续引用用。 */
  excerpt?: string;
  note?: string;
  createdAt: number;
};

type AnnotationState = {
  /** bookId -> 该书的注解（新加的在前）。 */
  annotations: Record<string, StoredAnnotation[]>;
  ready: boolean;
};

export type AnnotationStore = AnnotationState & {
  load(): Promise<void>;
  listForBook(bookId: string): StoredAnnotation[];
  add(input: {
    bookId: string;
    cfi: string;
    color: string;
    style?: AnnotationStyle;
    excerpt?: string;
    note?: string;
  }): StoredAnnotation;
  setColor(id: string, color: string): void;
  setStyle(id: string, style: AnnotationStyle): void;
  setNote(id: string, note: string): void;
  remove(id: string): void;
  /** 清空全部书的高亮与笔记（设置页「清空笔记」）。 */
  clearAllAnnotations(): void;
};

const STORE_FILE = "annotations.json";
const STORE_KEY = "annotations";
const LS_KEY = "deer.annotations.v1";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object)
  );
}

const EMPTY: AnnotationState = { annotations: {}, ready: false };

async function readPersisted(): Promise<AnnotationState | null> {
  try {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(STORE_FILE, { autoSave: false });
      const value = await store.get<AnnotationState>(STORE_KEY);
      return value ? { ...EMPTY, ...value } : null;
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw
      ? { ...EMPTY, ...(JSON.parse(raw) as AnnotationState) }
      : null;
  } catch (err) {
    console.error("[annotations] 读取注解失败，按空库启动", err);
    return null;
  }
}

async function writePersisted(state: AnnotationState): Promise<void> {
  const data: AnnotationState = { annotations: state.annotations, ready: true };
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
    console.error("[annotations] 写入注解失败", err);
  }
}

function id(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `anno_${rand}`;
}

export const useAnnotationStore = create<AnnotationStore>((set, get) => {
  const persist = () => {
    void writePersisted(get());
  };

  const patch = (id: string, patch: Partial<StoredAnnotation>) => {
    set((s) => {
      const next: AnnotationState["annotations"] = {};
      for (const [bookId, list] of Object.entries(s.annotations)) {
        next[bookId] = list.map((a) => (a.id === id ? { ...a, ...patch } : a));
      }
      return { annotations: next };
    });
    persist();
  };

  return {
    ...EMPTY,

    async load() {
      const data = await readPersisted();
      set({ ...EMPTY, ...(data ?? {}), ready: true });
    },

    listForBook(bookId) {
      return get().annotations[bookId] ?? [];
    },

    add({ bookId, cfi, color, style, excerpt, note }) {
      const annotation: StoredAnnotation = {
        id: id(),
        cfi,
        color,
        ...(style ? { style } : {}),
        ...(excerpt ? { excerpt } : {}),
        ...(note ? { note } : {}),
        createdAt: Date.now(),
      };
      set((s) => ({
        annotations: {
          ...s.annotations,
          [bookId]: [annotation, ...(s.annotations[bookId] ?? [])],
        },
      }));
      persist();
      return annotation;
    },

    setColor(id, color) {
      patch(id, { color });
    },

    setStyle(id, style) {
      patch(id, { style });
    },

    setNote(id, note) {
      patch(id, note ? { note } : { note: undefined });
    },

    remove(id) {
      set((s) => {
        const next: AnnotationState["annotations"] = {};
        for (const [bookId, list] of Object.entries(s.annotations)) {
          next[bookId] = list.filter((a) => a.id !== id);
        }
        return { annotations: next };
      });
      persist();
    },

    clearAllAnnotations() {
      set({ annotations: {} });
      persist();
    },
  };
});
