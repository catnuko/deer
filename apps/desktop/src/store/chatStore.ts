import { create } from "zustand";
import type { ChatMessage, ChatThread } from "@/lib/types";

/** 点赞/点踩的本地 UI 状态，只存不发请求。 */
export type ChatFeedback = "up" | "down";

export type ChatStoreState = {
  /** 每本书一个 thread 列表：bookId -> 该书自己的会话。 */
  threads: Record<string, ChatThread[]>;
  /** threadId -> 该会话的消息。 */
  messages: Record<string, ChatMessage[]>;
  /** bookId -> 当前打开的 threadId。 */
  activeThreadByBook: Record<string, string>;
  /** messageId -> 用户给过的反馈（仅本地）。 */
  feedback: Record<string, ChatFeedback>;
  ready: boolean;
};

export type ChatStore = ChatStoreState & {
  load(): Promise<void>;
  listThreads(bookId: string): ChatThread[];
  /** 取该书当前会话，没有就建一个（切书时天然切到自己的会话）。 */
  ensureThread(bookId: string, title?: string): ChatThread;
  activeThread(bookId: string): ChatThread | undefined;
  setActiveThread(bookId: string, threadId: string): void;
  createThread(bookId: string, title?: string): ChatThread;
  appendMessage(
    threadId: string,
    role: ChatMessage["role"],
    content: string,
  ): ChatMessage;
  setFeedback(messageId: string, value: ChatFeedback | undefined): void;
  clearThread(threadId: string): void;
};

/* ------------------------------------------------------------------ */
/* 持久化：桌面端走 Tauri plugin-store，浏览器（Vite 预览）退化为 localStorage */
/* ------------------------------------------------------------------ */

const STORE_FILE = "chat.json";
const STORE_KEY = "chat";
const LS_KEY = "deer.chat.v1";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object)
  );
}

const EMPTY: ChatStoreState = {
  threads: {},
  messages: {},
  activeThreadByBook: {},
  feedback: {},
  ready: false,
};

async function readPersisted(): Promise<ChatStoreState | null> {
  try {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(STORE_FILE, { autoSave: false });
      const value = await store.get<ChatStoreState>(STORE_KEY);
      return value ? { ...EMPTY, ...value } : null;
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as ChatStoreState) } : null;
  } catch (err) {
    console.error("[chat] 读取会话失败，按空库启动", err);
    return null;
  }
}

async function writePersisted(state: ChatStoreState): Promise<void> {
  const data: ChatStoreState = {
    threads: state.threads,
    messages: state.messages,
    activeThreadByBook: state.activeThreadByBook,
    feedback: state.feedback,
    ready: true,
  };
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
    console.error("[chat] 写入会话失败", err);
  }
}

/* ------------------------------------------------------------------ */

function id(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

/** 每本书的默认会话名，取自书名。 */
function threadTitle(bookId: string, title?: string): string {
  return title?.trim() ? `${title.trim()} · 伴读` : `新会话 · ${bookId.slice(0, 6)}`;
}

export const useChatStore = create<ChatStore>((set, get) => {
  /** 写盘：状态变化后异步落盘，失败只记日志不阻塞 UI。 */
  const persist = () => {
    void writePersisted(get());
  };

  const touchThread = (threadId: string) =>
    set((s) => {
      const next = { ...s.threads };
      for (const bookId of Object.keys(next)) {
        next[bookId] = next[bookId].map((t) =>
          t.id === threadId ? { ...t, updatedAt: Date.now() } : t,
        );
      }
      return { threads: next };
    });

  return {
    ...EMPTY,

    async load() {
      const data = await readPersisted();
      set({ ...EMPTY, ...(data ?? {}), ready: true });
    },

    listThreads(bookId) {
      return get().threads[bookId] ?? [];
    },

    ensureThread(bookId, title) {
      const state = get();
      const activeId = state.activeThreadByBook[bookId];
      const existing = (state.threads[bookId] ?? []).find(
        (t) => t.id === activeId,
      );
      if (existing) return existing;

      // 该书还没有会话：建一个并设为当前，保证「切书即切会话」。
      return get().createThread(bookId, title);
    },

    activeThread(bookId) {
      const state = get();
      const activeId = state.activeThreadByBook[bookId];
      return (state.threads[bookId] ?? []).find((t) => t.id === activeId);
    },

    setActiveThread(bookId, threadId) {
      set((s) => ({
        activeThreadByBook: { ...s.activeThreadByBook, [bookId]: threadId },
      }));
      persist();
    },

    createThread(bookId, title) {
      const now = Date.now();
      const thread: ChatThread = {
        id: id("thread"),
        bookId,
        title: threadTitle(bookId, title),
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({
        threads: {
          ...s.threads,
          [bookId]: [thread, ...(s.threads[bookId] ?? [])],
        },
        messages: { ...s.messages, [thread.id]: [] },
        activeThreadByBook: { ...s.activeThreadByBook, [bookId]: thread.id },
      }));
      persist();
      return thread;
    },

    appendMessage(threadId, role, content) {
      const message: ChatMessage = {
        id: id("msg"),
        role,
        content,
        createdAt: Date.now(),
      };
      set((s) => ({
        messages: {
          ...s.messages,
          [threadId]: [...(s.messages[threadId] ?? []), message],
        },
      }));
      touchThread(threadId);
      persist();
      return message;
    },

    setFeedback(messageId, value) {
      set((s) => {
        const next = { ...s.feedback };
        if (value) next[messageId] = value;
        else delete next[messageId];
        return { feedback: next };
      });
      persist();
    },

    clearThread(threadId) {
      set((s) => ({ messages: { ...s.messages, [threadId]: [] } }));
      touchThread(threadId);
      persist();
    },
  };
});