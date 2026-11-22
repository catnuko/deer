import { beforeEach, describe, expect, it, vi } from "vitest";

// 记忆写入走 memoryStore（浏览器降级 localStorage），替换成内存实现。
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
});

vi.mock("./cloudEngine", () => ({
  runCloudOnce: vi.fn(),
}));
vi.mock("./claudeBackend", () => ({
  acpxChat: vi.fn(),
  acpxEnvCheck: vi.fn(async () => ({
    ok: false,
    nodeOk: false,
    nodeVersion: null,
    acpxVersion: null,
    message: "测试环境无 acpx",
  })),
}));

const { runCloudOnce } = await import("./cloudEngine");
const { acpxChat } = await import("./claudeBackend");
const {
  buildMemoryExtractPrompt,
  compactMemories,
  extractSessionMemories,
  MEMORY_PER_BOOK_LIMIT,
  parseMemoryEntries,
} = await import("./memoryExtract");
const { useMemoryStore } = await import("@/store/memoryStore");
type MemoryEntry = import("@/store/memoryStore").MemoryEntry;
const { useAppSettings } = await import("@/store/appSettings");

function msg(
  role: "user" | "assistant",
  content: string,
): { id: string; role: "user" | "assistant"; content: string; createdAt: number } {
  return { id: `${role}-${Math.random()}`, role, content, createdAt: 0 };
}

function resetMemory() {
  memory.clear();
  useMemoryStore.setState({ memories: {}, ready: true });
}

beforeEach(() => {
  resetMemory();
  useAppSettings.setState({
    aiEngineMode: "cloud",
    aiApiKey: "test-key",
    memoryAutoSummarize: true,
  });
  vi.mocked(runCloudOnce).mockReset();
  vi.mocked(acpxChat).mockReset();
});

describe("buildMemoryExtractPrompt", () => {
  it("把会话转录成 用户/AI 逐行，并要求只输出 JSON 数组", () => {
    const built = buildMemoryExtractPrompt(
      [
        msg("user", "遗忘曲线怎么用？"),
        msg("assistant", "可以按章节安排复习间隔。"),
      ],
      "三体",
    );
    expect(built).not.toBeNull();
    expect(built!.prompt).toContain("《三体》");
    expect(built!.prompt).toContain("用户：遗忘曲线怎么用？");
    expect(built!.prompt).toContain("AI：可以按章节安排复习间隔。");
    expect(built!.prompt).toContain('"type":"topic"');
  });

  it("没有用户发言时返回 null（空面板误关不发起提取）", () => {
    expect(buildMemoryExtractPrompt([msg("assistant", "……")], "三体")).toBeNull();
    expect(buildMemoryExtractPrompt([], "三体")).toBeNull();
    expect(buildMemoryExtractPrompt([msg("user", "  ")], "三体")).toBeNull();
  });

  it("超长对话只保留最近的部分", () => {
    const messages = [
      msg("user", "开".repeat(8000)),
      msg("assistant", "答".repeat(8000)),
    ];
    const built = buildMemoryExtractPrompt(messages, "三体");
    expect(built!.prompt.length).toBeLessThan(9000);
    // 保留的是尾部（最近的话）
    expect(built!.prompt).toContain("答".repeat(50));
  });
});

describe("parseMemoryEntries", () => {
  it("解析合法 JSON 数组", () => {
    const parsed = parseMemoryEntries(
      '[{"type":"topic","content":"在讨论遗忘曲线"},{"type":"progress","content":"读到第三章"}]',
    );
    expect(parsed).toEqual([
      { type: "topic", content: "在讨论遗忘曲线" },
      { type: "progress", content: "读到第三章" },
    ]);
  });

  it("容忍代码块围栏与前后闲话", () => {
    const parsed = parseMemoryEntries(
      '好的，以下是归纳：\n```json\n[{"type":"preference","content":"喜欢简短回答"}]\n```',
    );
    expect(parsed).toEqual([{ type: "preference", content: "喜欢简短回答" }]);
  });

  it("非法类型与空内容丢弃，全非法返回 null", () => {
    expect(
      parseMemoryEntries('[{"type":"other","content":"x"},{"type":"topic","content":"  "}'),
    ).toBeNull();
    expect(parseMemoryEntries("不是 JSON")).toBeNull();
    expect(parseMemoryEntries('{"type":"topic"}')).toBeNull();
  });

  it("超长 content 截断，条目数封顶 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      type: "topic",
      content: `条目${i}${"长".repeat(300)}`,
    }));
    const parsed = parseMemoryEntries(JSON.stringify(many));
    expect(parsed).toHaveLength(5);
    expect(parsed![0]!.content.length).toBeLessThanOrEqual(200);
  });
});

describe("compactMemories（每书条数上限的滚动合并）", () => {
  function entry(partial: Partial<MemoryEntry> & { id: string }): MemoryEntry {
    return {
      bookId: "book-a",
      type: "topic",
      content: partial.content ?? "内容",
      createdAt: 0,
      updatedAt: 0,
      ...partial,
    };
  }

  it("未超限不动任何条目", () => {
    const list = [entry({ id: "a" }), entry({ id: "b" })];
    expect(compactMemories(list, 20)).toEqual({ updates: [], deletions: [] });
  });

  it("超限时从最旧端找同类型两条合并，保留较新一条的 id", () => {
    // 新写的在前，最旧在尾部：progress 同类型两条在最旧端。
    const list = [
      entry({ id: "new", content: "新的讨论" }),
      entry({ id: "mid", type: "preference", content: "喜欢简短回答" }),
      entry({ id: "old2", type: "progress", content: "读到第二章" }),
      entry({ id: "old1", type: "progress", content: "第一章读完了" }),
    ];
    const { updates, deletions } = compactMemories(list, 3);
    expect(deletions).toEqual(["old1"]);
    expect(updates).toEqual([{ id: "old2", content: "第一章读完了；读到第二章" }]);
  });

  it("类型互不相同时直接淘汰最旧一条", () => {
    const list = [
      entry({ id: "a", type: "topic", content: "1" }),
      entry({ id: "b", type: "preference", content: "2" }),
      entry({ id: "c", type: "progress", content: "3" }),
    ];
    const { updates, deletions } = compactMemories(list, 2);
    expect(updates).toEqual([]);
    expect(deletions).toEqual(["c"]);
  });

  it("默认上限为 MEMORY_PER_BOOK_LIMIT，连续超限持续滚动", () => {
    const list = Array.from({ length: MEMORY_PER_BOOK_LIMIT + 3 }, (_, i) =>
      entry({ id: `m${i}`, type: "topic", content: `第${i}条` }),
    );
    const { updates, deletions } = compactMemories(list);
    expect(list.length - deletions.length).toBe(MEMORY_PER_BOOK_LIMIT);
    // 合并发生在最旧的三条之间，三条并成两条；中间两条的更新被后续合并吞掉
    expect(deletions).toHaveLength(3);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("m19");
    expect(updates[0]!.content).toContain("第22条；第21条；第20条");
  });

  it("被后续淘汰吞掉的更新不会出现在 updates 里", () => {
    const list = [
      entry({ id: "a", type: "topic", content: "1" }),
      entry({ id: "b", type: "topic", content: "2" }),
      entry({ id: "c", type: "topic", content: "3" }),
    ];
    const { updates, deletions } = compactMemories(list, 1);
    // c+b 合并进 b，b 再与 a 合并进 a，b 的更新被过滤
    expect(deletions).toEqual(["c", "b"]);
    expect(updates).toEqual([{ id: "a", content: expect.stringContaining("3") }]);
  });
});

describe("extractSessionMemories（写入编排）", () => {
  it("云链路：runCloudOnce 返回 JSON，写入条目并带上来源 threadId", async () => {
    vi.mocked(runCloudOnce).mockResolvedValue(
      '[{"type":"topic","content":"在讨论黑暗森林"},{"type":"progress","content":"读到第二章"}]',
    );
    const ok = await extractSessionMemories({
      bookId: "book-1",
      bookTitle: "三体",
      threadId: "thread-1",
      messages: [msg("user", "黑暗森林是什么"), msg("assistant", "是一种猜疑链。")],
      engineMode: "cloud",
      envOk: null,
    });
    expect(ok).toBe(true);
    const list = useMemoryStore.getState().listByBook("book-1");
    expect(list).toHaveLength(2);
    expect(list.every((m) => m.sourceThreadId === "thread-1")).toBe(true);
    expect(list.map((m) => m.type)).toContain("topic");
    // 云链路 system/prompt 分离组装
    const call = vi.mocked(runCloudOnce).mock.calls[0]![0]!;
    expect(call.system).toContain("读书记忆提取器");
    expect(call.prompt).toContain("用户：黑暗森林是什么");
  });

  it("本地链路：envOk 时走 acpxChat 一次性生成，独立命名会话", async () => {
    vi.mocked(acpxChat).mockResolvedValue({
      text: '[{"type":"preference","content":"喜欢先给结论"}]',
      sessionId: "s1",
    });
    const ok = await extractSessionMemories({
      bookId: "book-1",
      bookTitle: "三体",
      threadId: "thread-1",
      messages: [msg("user", "回答简短一点")],
      engineMode: "local",
      envOk: true,
    });
    expect(ok).toBe(true);
    expect(useMemoryStore.getState().listByBook("book-1")).toHaveLength(1);
    const call = vi.mocked(acpxChat).mock.calls[0]![0]!;
    expect(call.threadId).toBe("memory-thread-1");
    expect(call.resumeSessionId).toBeNull();
    expect(call.prompt).toContain("读书记忆提取器");
  });

  it("仅本地但环境不可用时不回落云，静默跳过", async () => {
    const ok = await extractSessionMemories({
      bookId: "book-1",
      bookTitle: "三体",
      threadId: "thread-1",
      messages: [msg("user", "问题")],
      engineMode: "local",
      envOk: false,
    });
    expect(ok).toBe(false);
    expect(vi.mocked(runCloudOnce)).not.toHaveBeenCalled();
    expect(vi.mocked(acpxChat)).not.toHaveBeenCalled();
  });

  it("引擎报错（无 Key 等）静默返回 false，不抛出、不写条目", async () => {
    vi.mocked(runCloudOnce).mockRejectedValue(new Error("云引擎未配置"));
    const ok = await extractSessionMemories({
      bookId: "book-1",
      bookTitle: "三体",
      threadId: "thread-1",
      messages: [msg("user", "问题")],
      engineMode: "cloud",
      envOk: null,
    });
    expect(ok).toBe(false);
    expect(useMemoryStore.getState().listByBook("book-1")).toHaveLength(0);
  });

  it("模型输出解析不出条目时不写库", async () => {
    vi.mocked(runCloudOnce).mockResolvedValue("这段对话没什么可记的。");
    const ok = await extractSessionMemories({
      bookId: "book-1",
      bookTitle: "三体",
      threadId: "thread-1",
      messages: [msg("user", "问题")],
      engineMode: "cloud",
      envOk: null,
    });
    expect(ok).toBe(false);
    expect(useMemoryStore.getState().listByBook("book-1")).toHaveLength(0);
  });

  it("该书已有记忆超限时写入后触发滚动合并", async () => {
    // 预置满额旧条目（最旧端两条 topic）
    const seed = Array.from({ length: MEMORY_PER_BOOK_LIMIT }, (_, i) => ({
      bookId: "book-1",
      type: (i < 2 ? "topic" : "preference") as "topic" | "preference",
      content: `旧条目${i}`,
    }));
    useMemoryStore.getState().upsertEntries(seed.reverse());
    vi.mocked(runCloudOnce).mockResolvedValue(
      '[{"type":"progress","content":"读到第三章"}]',
    );
    const ok = await extractSessionMemories({
      bookId: "book-1",
      bookTitle: "三体",
      threadId: "thread-2",
      messages: [msg("user", "我读到第三章了")],
      engineMode: "cloud",
      envOk: null,
    });
    expect(ok).toBe(true);
    const list = useMemoryStore.getState().listByBook("book-1");
    expect(list).toHaveLength(MEMORY_PER_BOOK_LIMIT);
    // 新条目在最前，最旧端发生同类型合并
    expect(list[0]!.content).toBe("读到第三章");
    expect(list[0]!.sourceThreadId).toBe("thread-2");
    expect(list[list.length - 1]!.content).toContain("；");
  });
});
