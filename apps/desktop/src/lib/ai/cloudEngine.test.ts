import { describe, expect, it } from "vitest";
import type { Book, ChatMessage } from "@/lib/types";
import {
  HISTORY_MESSAGE_LIMIT,
  MAX_AGENT_STEPS,
  toModelMessages,
  trimHistory,
} from "./cloudEngine";
import {
  SEARCH_RESULT_LIMIT,
  bookToRef,
  filterBooks,
  readingStateOf,
} from "./deerTools";

function book(overrides: Partial<Book>): Book {
  return {
    id: "b",
    title: "书",
    author: "作者",
    format: "epub",
    filePath: "/books/b.epub",
    sizeBytes: 1,
    addedAt: 0,
    progress: 0,
    shelfIds: [],
    tags: [],
    ...overrides,
  };
}

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${role}-${content}`,
    role,
    content,
    createdAt: 0,
  } as ChatMessage;
}

describe("cloudEngine 纯函数", () => {
  it("步数与历史上限为约定值", () => {
    expect(MAX_AGENT_STEPS).toBe(8);
    expect(HISTORY_MESSAGE_LIMIT).toBe(40);
  });

  it("trimHistory 只保留最近 N 条", () => {
    const many = Array.from({ length: 50 }, (_, i) => message("user", `m${i}`));
    const trimmed = trimHistory(many);
    expect(trimmed).toHaveLength(40);
    expect(trimmed[0]!.content).toBe("m10");
    expect(trimmed[39]!.content).toBe("m49");
  });

  it("toModelMessages 只取正文、跳过空内容（书卡/思考块是展示层）", () => {
    const messages: ChatMessage[] = [
      message("user", "你好"),
      { ...message("assistant", ""), books: [{ id: "b", title: "书" }] } as ChatMessage,
      { ...message("assistant", "答案"), thinking: "思考" } as ChatMessage,
    ];
    expect(toModelMessages(messages)).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "答案" },
    ]);
  });
});

describe("deerTools 纯函数", () => {
  it("bookToRef 抽书卡字段，无封面不带 coverPath", () => {
    const ref = bookToRef(
      book({ id: "b1", title: "三体", author: "刘慈欣", progress: 0.5 }),
    );
    expect(ref).toEqual({
      id: "b1",
      title: "三体",
      author: "刘慈欣",
      format: "epub",
      progress: 0.5,
    });
  });

  it("filterBooks 按 书名/作者/标签 子串匹配（大小写不敏感），空关键词返回全部", () => {
    const books = [
      book({ id: "1", title: "三体", author: "刘慈欣", tags: ["科幻"] }),
      book({ id: "2", title: "Thinking, Fast and Slow", author: "Kahneman", tags: [] }),
    ];
    expect(filterBooks(books, "")).toHaveLength(2);
    expect(filterBooks(books, "三体").map((b) => b.id)).toEqual(["1"]);
    expect(filterBooks(books, "刘慈欣").map((b) => b.id)).toEqual(["1"]);
    expect(filterBooks(books, "SF")).toHaveLength(0);
    expect(filterBooks(books, "FAST").map((b) => b.id)).toEqual(["2"]);
  });

  it("readingStateOf 按最后打开时间倒序取最近 10 本在读", () => {
    const books = Array.from({ length: 12 }, (_, i) =>
      book({ id: String(i), lastOpenedAt: i }),
    );
    books.push(book({ id: "never" }));
    const state = readingStateOf(books);
    expect(state).toHaveLength(10);
    expect(state[0]!.id).toBe("11");
    expect(state.map((b) => b.id)).not.toContain("never");
  });

  it("搜索结果上限为约定值", () => {
    expect(SEARCH_RESULT_LIMIT).toBe(20);
  });
});
