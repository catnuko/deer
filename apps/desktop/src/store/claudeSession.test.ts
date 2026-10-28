import { beforeEach, describe, expect, it, vi } from "vitest";

// chatStore 只在读写时触碰 localStorage，先替换成内存实现，避免 node 环境报错。
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
});

const { useChatStore } = await import("./chatStore");

function reset() {
  memory.clear();
  useChatStore.setState({
    threads: {},
    messages: {},
    activeThreadByBook: {},
    feedback: {},
    claudeSessionByBook: {},
    ready: true,
  });
}

describe("claude 会话映射（按书隔离）", () => {
  beforeEach(reset);

  it("setClaudeSession 按书记录，互不污染", () => {
    const store = useChatStore.getState();
    store.setClaudeSession("book-a", "session-a1");
    store.setClaudeSession("book-b", "session-b1");

    expect(useChatStore.getState().claudeSessionByBook).toEqual({
      "book-a": "session-a1",
      "book-b": "session-b1",
    });
  });

  it("setClaudeSession(undefined) 清除该书映射", () => {
    const store = useChatStore.getState();
    store.setClaudeSession("book-a", "session-a1");
    store.setClaudeSession("book-a", undefined);

    expect(useChatStore.getState().claudeSessionByBook).toEqual({});
  });

  it("清空会话同时清掉该书的 claude session 映射，别书不受影响", () => {
    const store = useChatStore.getState();
    const a = store.ensureThread("book-a", "甲书");
    store.ensureThread("book-b", "乙书");
    store.setClaudeSession("book-a", "session-a1");
    store.setClaudeSession("book-b", "session-b1");

    store.clearThread(a.id);

    expect(useChatStore.getState().claudeSessionByBook).toEqual({
      "book-b": "session-b1",
    });
  });

  it("appendToMessage 增量累计正文，不影响其他消息", () => {
    const store = useChatStore.getState();
    const thread = store.ensureThread("book-a", "甲书");
    const user = store.appendMessage(thread.id, "user", "问题");
    const assistant = store.appendMessage(thread.id, "assistant", "");

    store.appendToMessage(thread.id, assistant.id, "你好");
    store.appendToMessage(thread.id, assistant.id, "呀");

    const messages = useChatStore.getState().messages[thread.id] ?? [];
    expect(messages.find((m) => m.id === user.id)?.content).toBe("问题");
    expect(messages.find((m) => m.id === assistant.id)?.content).toBe("你好呀");
  });

  it("setMessageContent 整体替换正文（失败提示 / 兜底用）", () => {
    const store = useChatStore.getState();
    const thread = store.ensureThread("book-a", "甲书");
    const assistant = store.appendMessage(thread.id, "assistant", "半截");

    store.setMessageContent(thread.id, assistant.id, "（出错了）超时");

    const messages = useChatStore.getState().messages[thread.id] ?? [];
    expect(messages.find((m) => m.id === assistant.id)?.content).toBe(
      "（出错了）超时",
    );
  });

  it("claudeSessionByBook 持久化：重放落盘数据能还原", async () => {
    const store = useChatStore.getState();
    store.setClaudeSession("book-a", "session-a1");

    // writePersisted 是异步落盘，等一轮微任务。
    await new Promise((r) => setTimeout(r, 0));

    const raw = memory.get("deer.chat.v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).claudeSessionByBook).toEqual({
      "book-a": "session-a1",
    });
  });
});
