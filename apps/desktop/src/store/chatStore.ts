import { create } from "zustand";
import type { ChatBookRef, ChatMessage, ChatThread } from "@/lib/types";

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
  /** threadId -> 该线程的 ACP session id（acpx 命名会话恢复用）。 */
  acpxSessionByThread: Record<string, string>;
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
  /** 流式追加：给已有消息的正文追加一段增量。 */
  appendToMessage(threadId: string, messageId: string, delta: string): void;
  /** 整体替换某条消息的正文（失败提示、空回复兜底用）。 */
  setMessageContent(threadId: string, messageId: string, content: string): void;
  setFeedback(messageId: string, value: ChatFeedback | undefined): void;
  setAcpxSession(threadId: string, sessionId: string | undefined): void;
  /** 流式追加：给已有消息的思考过程追加一段增量。 */
  appendToMessageThinking(threadId: string, messageId: string, delta: string): void;
  /** 书架工具返回的书单并入消息（按书 id 去重，后到的覆盖先到的）。 */
  appendToMessageBooks(
    threadId: string,
    messageId: string,
    books: ChatBookRef[],
  ): void;
  clearThread(threadId: string): void;
  /** 清空全部本机聊天记录（设置页「清空聊天记录」）。 */
  clearAllChat(): void;
};

/* ------------------------------------------------------------------ */
/* 持久化：桌面端走 Tauri plugin-store，浏览器（Vite 预览）退化为 localStorage */
/* ------------------------------------------------------------------ */

const STORE_FILE = "chat.json";
const STORE_KEY = "chat";
const LS_KEY = "deer.chat.v1";

/** 旧版落盘字段（直连链路时代）：读入时丢弃，深度思考恒开、无引擎概念。 */
const LEGACY_KEYS = ["claudeSessionByBook", "harness", "deepThinking"] as const;

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
  acpxSessionByThread: {},
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
    acpxSessionByThread: state.acpxSessionByThread,
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
      // 旧版落盘字段（直连链路时代的开关/引擎/按书会话映射）读入即丢弃：
      // 深度思考恒开，acpx 是本地链路的会话管理者，Deer 只存 session id。
      if (data) {
        for (const key of LEGACY_KEYS) delete (data as Record<string, unknown>)[key];
      }
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
      set((s) => {
        const next: ChatStoreState = {
          ...s,
          messages: { ...s.messages, [threadId]: [] },
        };
        // 清空会话 = 重新开新会话：同步清掉 acpx 会话映射。
        next.acpxSessionByThread = { ...next.acpxSessionByThread };
        delete next.acpxSessionByThread[threadId];
        return next;
      });
      touchThread(threadId);
      persist();
    },

    clearAllChat() {
      // 全清 = 回到空库；复用既有 EMPTY 形态与 persist，不新造持久化。
      set({ ...EMPTY, ready: true });
      persist();
    },

    setAcpxSession(threadId, sessionId) {
      set((s) => {
        const next = { ...s.acpxSessionByThread };
        if (sessionId === undefined) delete next[threadId];
        else next[threadId] = sessionId;
        return { acpxSessionByThread: next };
      });
      persist();
    },

    appendToMessage(threadId, messageId, delta) {
      set((s) => ({
        messages: {
          ...s.messages,
          [threadId]: (s.messages[threadId] ?? []).map((m) =>
            m.id === messageId ? { ...m, content: m.content + delta } : m,
          ),
        },
      }));
    },

    setMessageContent(threadId, messageId, content) {
      set((s) => ({
        messages: {
          ...s.messages,
          [threadId]: (s.messages[threadId] ?? []).map((m) =>
            m.id === messageId ? { ...m, content } : m,
          ),
        },
      }));
      touchThread(threadId);
      persist();
    },

    appendToMessageThinking(threadId, messageId, delta) {
      set((s) => ({
        messages: {
          ...s.messages,
          [threadId]: (s.messages[threadId] ?? []).map((m) =>
            m.id === messageId
              ? { ...m, thinking: (m.thinking ?? "") + delta }
              : m,
          ),
        },
      }));
    },

    appendToMessageBooks(threadId, messageId, books) {
      set((s) => ({
        messages: {
          ...s.messages,
          [threadId]: (s.messages[threadId] ?? []).map((m) => {
            if (m.id !== messageId) return m;
            const seen = new Set(books.map((b) => b.id));
            const kept = (m.books ?? []).filter((b) => !seen.has(b.id));
            return { ...m, books: [...kept, ...books] };
          }),
        },
      }));
    },
  };
});
