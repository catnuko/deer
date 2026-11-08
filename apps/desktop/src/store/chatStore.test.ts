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

  it("深度思考恒开：store 不再有开关状态，旧版落盘值读入即丢弃", async () => {
    // 直连链路时代的落盘数据：深度思考 false、引擎 claude、按书会话映射。
    memory.set(
      "deer.chat.v1",
      JSON.stringify({
        threads: {},
        messages: {},
        activeThreadByBook: {},
        feedback: {},
        deepThinking: false,
        harness: "claude",
        claudeSessionByBook: { "book-a": "session-a1" },
        ready: true,
      }),
    );

    await useChatStore.getState().load();

    const state = useChatStore.getState() as unknown as Record<string, unknown>;
    expect(state.deepThinking).toBeUndefined();
    expect(state.harness).toBeUndefined();
    expect(state.claudeSessionByBook).toBeUndefined();

    // 再落盘时旧字段不复写回（迁移彻底，不留死数据）。
    useChatStore.getState().appendMessage("t-1", "user", "问题");
    await new Promise((r) => setTimeout(r, 0));
    const saved = JSON.parse(memory.get("deer.chat.v1") ?? "{}");
    expect(saved.deepThinking).toBeUndefined();
    expect(saved.harness).toBeUndefined();
    expect(saved.claudeSessionByBook).toBeUndefined();
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

  it("思考增量追加到消息的 thinking 字段，与正文分开", () => {
    const store = useChatStore.getState();
    const thread = store.ensureThread("book-a", "甲书");
    const msg = store.appendMessage(thread.id, "assistant", "");

    store.appendToMessageThinking(thread.id, msg.id, "先想");
    store.appendToMessageThinking(thread.id, msg.id, "一下");

    const saved = useChatStore.getState().messages[thread.id][0];
    expect(saved.thinking).toBe("先想一下");
    expect(saved.content).toBe("");
  });

  it("书单并入消息的 books 字段，按书 id 去重且后到覆盖先到", () => {
    const store = useChatStore.getState();
    const thread = store.ensureThread("book-a", "甲书");
    const msg = store.appendMessage(thread.id, "assistant", "");

    store.appendToMessageBooks(thread.id, msg.id, [
      { id: "b1", title: "三体", author: "刘慈欣", format: "epub", progress: 0.4 },
    ]);
    // 同一模型回复可能调多次工具：get_library 全量 + search_books 精确，
    // 后到的进度应覆盖先到的，且已有书不重复。
    store.appendToMessageBooks(thread.id, msg.id, [
      { id: "b1", title: "三体", author: "刘慈欣", format: "epub", progress: 0.6 },
      { id: "b2", title: "球状闪电", author: "刘慈欣", format: "epub", progress: 0 },
    ]);

    const saved = useChatStore.getState().messages[thread.id][0];
    expect(saved.books).toHaveLength(2);
    expect(saved.books?.find((b) => b.id === "b1")?.progress).toBe(0.6);
  });

  it("appendToMessageBooks 不影响其它消息", () => {
    const store = useChatStore.getState();
    const thread = store.ensureThread("book-a", "甲书");
    const first = store.appendMessage(thread.id, "assistant", "第一条");
    const second = store.appendMessage(thread.id, "assistant", "第二条");

    store.appendToMessageBooks(thread.id, first.id, [
      { id: "b1", title: "三体", author: "刘慈欣", format: "epub", progress: 0 },
    ]);

    expect(useChatStore.getState().messages[thread.id][0].books).toHaveLength(1);
    expect(useChatStore.getState().messages[thread.id][1].books).toBeUndefined();
    expect(second.content).toBe("第二条");
  });

  it("load 丢弃直连时代遗留字段，acpx 会话映射保留", async () => {
    memory.set(
      "deer.chat.v1",
      JSON.stringify({
        threads: {},
        messages: {},
        activeThreadByBook: {},
        feedback: {},
        acpxSessionByThread: { t1: "acp-1" },
        claudeSessionByBook: { b1: "s1" },
        harness: "x",
        deepThinking: false,
      }),
    );
    await useChatStore.getState().load();

    const state = useChatStore.getState();
    expect(state.acpxSessionByThread).toEqual({ t1: "acp-1" });
    expect(
      (state as unknown as Record<string, unknown>).claudeSessionByBook,
    ).toBeUndefined();
    expect((state as unknown as Record<string, unknown>).harness).toBeUndefined();
  });

  it("setAcpxSession 记录会话映射，clearThread 同步清掉", () => {
    const store = useChatStore.getState();
    const thread = store.ensureThread("book-a", "甲书");

    store.setAcpxSession(thread.id, "acp-9");
    expect(useChatStore.getState().acpxSessionByThread[thread.id]).toBe("acp-9");

    store.setAcpxSession(thread.id, undefined);
    expect(
      useChatStore.getState().acpxSessionByThread[thread.id],
    ).toBeUndefined();

    store.setAcpxSession(thread.id, "acp-9");
    store.clearThread(thread.id);
    expect(
      useChatStore.getState().acpxSessionByThread[thread.id],
    ).toBeUndefined();
  });

  it("clearAllChat 清空全部线程、消息与反馈", () => {
    const store = useChatStore.getState();
    const a = store.ensureThread("book-a", "甲书");
    store.appendMessage(a.id, "user", "问题");
    store.setFeedback("msg-x", "up");

    store.clearAllChat();

    const state = useChatStore.getState();
    expect(state.threads).toEqual({});
    expect(state.messages).toEqual({});
    expect(state.activeThreadByBook).toEqual({});
    expect(state.feedback).toEqual({});
    expect(state.ready).toBe(true);
  });
});
