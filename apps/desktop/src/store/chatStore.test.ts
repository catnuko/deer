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
    ready: true,
  });
}

describe("chatStore", () => {
  beforeEach(reset);

  it("每本书各建一个会话，消息互不污染", () => {
    const store = useChatStore.getState();

    const a = store.ensureThread("book-a", "甲书");
    const b = store.ensureThread("book-b", "乙书");
    expect(a.id).not.toBe(b.id);
    expect(a.bookId).toBe("book-a");
    expect(b.bookId).toBe("book-b");

    store.appendMessage(a.id, "user", "只属于甲书的问题");
    store.appendMessage(a.id, "assistant", "只属于甲书的回答");

    const state = useChatStore.getState();
    expect(state.messages[a.id]).toHaveLength(2);
    expect(state.messages[b.id]).toHaveLength(0);
    // threads 按 bookId 分桶，各自只有自己的会话
    expect(state.threads["book-a"]).toHaveLength(1);
    expect(state.threads["book-b"]).toHaveLength(1);
  });

  it("ensureThread 对同一本书复用当前会话，不重复创建", () => {
    const first = useChatStore.getState().ensureThread("book-a", "甲书");
    const again = useChatStore.getState().ensureThread("book-a", "甲书");
    expect(again.id).toBe(first.id);
    expect(useChatStore.getState().threads["book-a"]).toHaveLength(1);
  });

  it("新建会话会把当前会话切过去，旧会话消息仍保留", () => {
    const store = useChatStore.getState();
    const first = store.ensureThread("book-a", "甲书");
    store.appendMessage(first.id, "user", "第一段对话");

    const second = useChatStore.getState().createThread("book-a", "甲书");
    const state = useChatStore.getState();
    expect(state.activeThreadByBook["book-a"]).toBe(second.id);
    expect(state.messages[first.id]).toHaveLength(1);
    expect(state.messages[second.id]).toHaveLength(0);
    expect(state.threads["book-a"]).toHaveLength(2);
  });

  it("点赞点踩只存本地，可以撤回", () => {
    const store = useChatStore.getState();
    const thread = store.ensureThread("book-a", "甲书");
    const msg = store.appendMessage(thread.id, "assistant", "回答");

    store.setFeedback(msg.id, "up");
    expect(useChatStore.getState().feedback[msg.id]).toBe("up");

    store.setFeedback(msg.id, "down");
    expect(useChatStore.getState().feedback[msg.id]).toBe("down");

    store.setFeedback(msg.id, undefined);
    expect(useChatStore.getState().feedback[msg.id]).toBeUndefined();
  });

  it("清空会话只清消息，不删会话本身", () => {
    const store = useChatStore.getState();
    const thread = store.ensureThread("book-a", "甲书");
    store.appendMessage(thread.id, "user", "会被清掉");

    store.clearThread(thread.id);
    const state = useChatStore.getState();
    expect(state.messages[thread.id]).toHaveLength(0);
    expect(state.threads["book-a"]).toHaveLength(1);
  });
});
