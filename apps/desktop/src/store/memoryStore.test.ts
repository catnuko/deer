import { beforeEach, describe, expect, it, vi } from "vitest";

// memoryStore 只在读写时触碰 localStorage（浏览器预览的降级路径），先替换成内存实现。
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
});

const { useMemoryStore } = await import("./memoryStore");

function reset() {
  memory.clear();
  useMemoryStore.setState({ memories: {}, ready: true });
}

describe("读书记忆持久化（按书隔离）", () => {
  beforeEach(reset);

  it("upsertEntries 新增记忆，listByBook 按书隔离且新写的在前", () => {
    const store = useMemoryStore.getState();
    const first = store.upsertEntries([
      { bookId: "book-a", type: "topic", content: "在讨论遗忘曲线", sourceThreadId: "t1" },
    ])[0];
    const second = store.upsertEntries([
      { bookId: "book-a", type: "preference", content: "喜欢简短回答" },
    ])[0];
    store.upsertEntries([{ bookId: "book-b", type: "progress", content: "读到第三章" }]);

    const list = useMemoryStore.getState().listByBook("book-a");
    expect(list.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(list[0]).toMatchObject({
      type: "preference",
      content: "喜欢简短回答",
    });
    expect(first).toMatchObject({
      bookId: "book-a",
      sourceThreadId: "t1",
      createdAt: expect.any(Number),
    });
    expect(useMemoryStore.getState().listByBook("book-b")).toHaveLength(1);
    // 不带 sourceThreadId 的手工记忆不写该字段
    expect(second.sourceThreadId).toBeUndefined();
  });

  it("upsertEntries 带 id 视为更新：content 变更、updatedAt 前进、createdAt 不变", () => {
    const entry = useMemoryStore
      .getState()
      .upsertEntries([{ bookId: "book-a", type: "topic", content: "旧摘要" }])[0];

    const before = useMemoryStore.getState().listByBook("book-a")[0];
    const [updated] = useMemoryStore.getState().upsertEntries([
      {
        id: entry.id,
        bookId: entry.bookId,
        type: "topic",
        content: "补充后的新摘要",
      },
    ]);

    expect(updated.content).toBe("补充后的新摘要");
    expect(updated.createdAt).toBe(before.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect(useMemoryStore.getState().listByBook("book-a")).toHaveLength(1);
  });

  it("updateEntry 只改指定条目，deleteEntry 只删该条", () => {
    const store = useMemoryStore.getState();
    const [a] = store.upsertEntries([
      { bookId: "book-a", type: "topic", content: "甲" },
    ]);
    const [b] = store.upsertEntries([
      { bookId: "book-a", type: "progress", content: "乙" },
    ]);

    useMemoryStore.getState().updateEntry(a.id, { content: "甲（改）", type: "preference" });
    const list = useMemoryStore.getState().listByBook("book-a");
    const updatedA = list.find((m) => m.id === a.id);
    expect(updatedA).toMatchObject({ content: "甲（改）", type: "preference" });
    expect(updatedA?.sourceThreadId).toBeUndefined();
    expect(list.find((m) => m.id === b.id)?.content).toBe("乙");

    useMemoryStore.getState().deleteEntry(b.id);
    expect(useMemoryStore.getState().listByBook("book-a").map((m) => m.id)).toEqual([
      a.id,
    ]);
    // 删不存在的 id 不报错
    expect(() => useMemoryStore.getState().deleteEntry("mem_none")).not.toThrow();
  });

  it("浏览器预览降级写 localStorage，重新 load 能恢复", () => {
    useMemoryStore
      .getState()
      .upsertEntries([{ bookId: "book-a", type: "topic", content: "要落盘的记忆" }]);
    expect(memory.size).toBe(1);
    const raw = [...memory.values()][0];
    expect(raw).toContain("要落盘的记忆");

    useMemoryStore.setState({ memories: {}, ready: false });
    return useMemoryStore.getState().load().then(() => {
      expect(useMemoryStore.getState().listByBook("book-a")[0]?.content).toBe(
        "要落盘的记忆",
      );
      expect(useMemoryStore.getState().ready).toBe(true);
    });
  });

  it("clearByBook 只清该书，clearAll 清空全部", () => {
    const store = useMemoryStore.getState();
    store.upsertEntries([{ bookId: "book-a", type: "topic", content: "a" }]);
    store.upsertEntries([{ bookId: "book-b", type: "topic", content: "b" }]);

    useMemoryStore.getState().clearByBook("book-a");
    expect(useMemoryStore.getState().listByBook("book-a")).toHaveLength(0);
    expect(useMemoryStore.getState().listByBook("book-b")).toHaveLength(1);

    useMemoryStore.getState().clearAll();
    expect(useMemoryStore.getState().listByBook("book-b")).toHaveLength(0);
    // 对不存在的书 clear 也不报错
    expect(() => useMemoryStore.getState().clearByBook("book-none")).not.toThrow();
  });
});
