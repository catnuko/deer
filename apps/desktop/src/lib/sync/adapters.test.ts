import { beforeEach, describe, expect, it } from "vitest";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { useChatStore } from "@/store/chatStore";
import type { Book } from "@/lib/types";
import { annotationAdapter, bookAdapter, chatAdapter } from "./adapters";
import type { Hlc } from "./types";

const hlc: Hlc = { wall: 1_000, counter: 0, node: "dev-a" };

const book: Book = {
  id: "local-book-1",
  contentHash: "hash-1",
  title: "小王子",
  author: "圣埃克苏佩里",
  format: "epub",
  filePath: "/data/books/local-book-1.epub",
  coverPath: "/data/covers/local-book-1.jpg",
  sizeBytes: 1234,
  addedAt: 100,
  progress: 0.42,
  lastLocationCfi: "epubcfi(/6/4!/2)",
  shelfIds: ["shelf-1"],
  tags: ["童话"],
};

beforeEach(() => {
  useBookStore.setState({
    books: [{ ...book, shelfIds: ["shelf-1"] }],
    shelves: [{ id: "shelf-1", name: "想读", order: 1 }],
    ready: true,
    importing: false,
    error: null,
  });
  useAnnotationStore.setState({ annotations: {}, ready: true });
  useChatStore.setState({
    threads: {
      "local-book-1": [
        { id: "thread-1", bookId: "local-book-1", title: "伴读", createdAt: 10, updatedAt: 20 },
      ],
    },
    messages: {
      "thread-1": [
        { id: "msg-1", role: "user", content: "这本书讲什么？", createdAt: 11 },
      ],
    },
    activeThreadByBook: {},
    feedback: {},
    acpxSessionByThread: {},
    ready: true,
  });
});

describe("书籍适配器", () => {
  it("快照用内容哈希做跨设备键，且不含本机路径", () => {
    const entries = bookAdapter.snapshot();
    const bookEntry = entries.find((entry) => entry.key === "bk:hash-1");
    expect(bookEntry).toBeDefined();
    expect(JSON.stringify(bookEntry?.data)).not.toContain("/data/books");
    expect(entries.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["bk:hash-1", "bs:hash-1:shelf-1", "sh:shelf-1"]),
    );
  });

  it("没有 contentHash 的旧书不进入同步", () => {
    useBookStore.setState({ books: [{ ...book, contentHash: undefined }] });
    expect(bookAdapter.snapshot().filter((e) => e.kind === "book")).toHaveLength(0);
  });

  it("远端新书落成「云端书籍」行，删除时只移出书架", () => {
    bookAdapter.apply({
      kind: "book",
      key: "bk:hash-2",
      hlc,
      data: {
        contentHash: "hash-2",
        title: "云端书",
        author: "某人",
        format: "pdf",
        sizeBytes: 999,
        tags: [],
        addedAt: 50,
        progress: 0.1,
      },
    });

    const cloud = useBookStore.getState().books.find((b) => b.contentHash === "hash-2");
    expect(cloud?.cloudOnly).toBe(true);
    expect(cloud?.filePath).toBe("");

    bookAdapter.apply({ kind: "book", key: "bk:hash-2", hlc: { ...hlc, wall: 2_000 }, deleted: true });
    expect(
      useBookStore.getState().books.some((b) => b.contentHash === "hash-2"),
    ).toBe(false);
  });

  it("远端书架归属按哈希挂到已有书上", () => {
    bookAdapter.apply({
      kind: "bookShelf",
      key: "bs:hash-1:shelf-1",
      hlc,
      deleted: true,
    });
    expect(useBookStore.getState().books[0].shelfIds).toEqual([]);

    bookAdapter.apply({ kind: "bookShelf", key: "bs:hash-1:shelf-1", hlc, data: {} });
    expect(useBookStore.getState().books[0].shelfIds).toEqual(["shelf-1"]);
  });
});

describe("笔记适配器", () => {
  it("笔记用 bookHash 关联，拉回后挂到本机同内容书籍上", () => {
    useAnnotationStore.setState({
      annotations: {
        "local-book-1": [
          { id: "anno-local", color: "#ff0", note: "本地笔记", createdAt: 1 },
        ],
      },
      ready: true,
    });

    const entry = annotationAdapter.snapshot().find((e) => e.key === "an:anno-local");
    expect((entry?.data as { bookHash: string }).bookHash).toBe("hash-1");

    annotationAdapter.apply({
      kind: "annotation",
      key: "an:anno-remote",
      hlc,
      data: { bookHash: "hash-1", color: "#0f0", note: "远端笔记", createdAt: 2 },
    });
    expect(
      useAnnotationStore.getState().annotations["local-book-1"].map((a) => a.id),
    ).toEqual(expect.arrayContaining(["anno-local", "anno-remote"]));

    annotationAdapter.apply({
      kind: "annotation",
      key: "an:anno-remote",
      hlc: { ...hlc, wall: 2_000 },
      deleted: true,
    });
    expect(
      useAnnotationStore
        .getState()
        .annotations["local-book-1"].some((a) => a.id === "anno-remote"),
    ).toBe(false);
  });
});

describe("聊天适配器", () => {
  it("会话与消息按 bookHash/threadKey 映射，消息随线程删除", () => {
    const keys = chatAdapter.snapshot().map((entry) => entry.key);
    expect(keys).toEqual(expect.arrayContaining(["th:thread-1", "ms:msg-1"]));

    chatAdapter.apply({
      kind: "chatThread",
      key: "th:thread-remote",
      hlc,
      data: { bookHash: "hash-1", title: "远端会话", createdAt: 5, updatedAt: 6 },
    });
    chatAdapter.apply({
      kind: "chatMessage",
      key: "ms:msg-remote",
      hlc,
      data: {
        threadKey: "th:thread-remote",
        role: "assistant",
        content: "你好",
        createdAt: 7,
      },
    });

    const state = useChatStore.getState();
    expect(state.threads["local-book-1"].some((t) => t.id === "thread-remote")).toBe(true);
    expect(state.messages["thread-remote"]).toHaveLength(1);

    chatAdapter.apply({
      kind: "chatThread",
      key: "th:thread-remote",
      hlc: { ...hlc, wall: 2_000 },
      deleted: true,
    });
    expect(
      useChatStore.getState().messages["thread-remote"],
    ).toBeUndefined();
  });
});