/**
 * Deer 原生工具集（AI SDK tool 协议，中文 description）：书架/阅读状态/
 * 目录/当前章文本/划线笔记 + 书内搜索与跳转。书架类工具对齐原 Rust MCP
 * 三工具语义；阅读类工具经 readerBridge 由阅读页提供，不在阅读页时降级。
 */

import { jsonSchema, tool, type ToolSet } from "ai";
import type { Book, ChatBookRef } from "@/lib/types";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { getReaderBridge } from "./readerBridge";

/** 书卡形态：与聊天书卡一致，模型输出书单时前端能直接渲染。 */
export function bookToRef(book: Book): ChatBookRef {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    progress: book.progress,
    ...(book.coverPath ? { coverPath: book.coverPath } : {}),
  };
}

/** 书名/作者/标签子串匹配（大小写不敏感）；空关键词返回全部。 */
export function filterBooks(books: Book[], query: string): Book[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return books;
  return books.filter((book) =>
    [book.title, book.author, book.tags.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(keyword),
  );
}

/** 阅读状态：按最后打开时间倒序的最近在读（最多 10 本）。 */
export function readingStateOf(books: Book[]): Book[] {
  return [...books]
    .filter((book) => typeof book.lastOpenedAt === "number")
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, 10);
}

/** 搜索结果上限：控制上下文体积，模型按摘录回答足够。 */
export const SEARCH_RESULT_LIMIT = 20;

/** 构建本轮对话可用的工具集（每轮新build，读取最新 store 状态）。 */
export function buildDeerTools(): ToolSet {
  return {
    search_books: tool({
      description:
        "按书名、作者或标签搜索用户的电子书书架（大小写不敏感）。返回匹配书籍的书卡列表（id/书名/作者/格式/进度/封面）。空关键词返回全书架。推荐书籍前用它挑选书架里已有的书。",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词（书名/作者/标签的一部分）" },
        },
        required: ["query"],
      }),
      execute: async ({ query }) => {
        const books = useBookStore.getState().books;
        return filterBooks(books, query).map(bookToRef);
      },
    }),

    get_library: tool({
      description:
        "获取用户完整书架清单（全部书籍的书卡与书架分组名）。与 search_books 的书卡同构。",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        const { books, shelves } = useBookStore.getState();
        return {
          shelves: shelves.map((shelf) => ({ id: shelf.id, name: shelf.name })),
          books: books.map(bookToRef),
        };
      },
    }),

    get_reading_state: tool({
      description:
        "获取用户最近在读的书与阅读进度（按最后打开时间倒序，最多 10 本）。用于了解阅读喜好、续读推荐。",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () =>
        readingStateOf(useBookStore.getState().books).map(bookToRef),
    }),

    get_toc: tool({
      description:
        "获取当前正在读的书目录（章节标题列表，index 可用于 jump_to_location 的 tocIndex）。仅在阅读页打开时可用。",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        const bridge = getReaderBridge();
        if (!bridge) return "当前没有打开中的书（不在阅读页），拿不到目录。";
        return bridge.getToc();
      },
    }),

    get_current_chapter_text: tool({
      description:
        "获取当前正在读章节的全文。回答「这一章讲了什么」等基于正文的问题时用它，不要凭记忆编造。",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        const bridge = getReaderBridge();
        if (!bridge) return "当前没有打开中的书（不在阅读页），拿不到章节正文。";
        const [title, text] = await Promise.all([
          bridge.getCurrentChapterTitle(),
          bridge.getCurrentChapterText(),
        ]);
        if (!text) return "当前章节没有可读正文（可能是图片书或空章节）。";
        return { title: title ?? "", text };
      },
    }),

    list_annotations: tool({
      description:
        "获取当前这本书的全部划线与笔记（含摘录、笔记内容、AI 笔记）。讨论读者想法、整理笔记时用。",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        const bridge = getReaderBridge();
        if (!bridge) return "当前没有打开中的书（不在阅读页），拿不到划线笔记。";
        const annotations = useAnnotationStore.getState().listForBook(bridge.bookId);
        return annotations.map((annotation) => ({
          excerpt: annotation.excerpt ?? "",
          note: annotation.note ?? "",
          source: annotation.source === "ai" ? "ai" : "user",
          createdAt: annotation.createdAt,
        }));
      },
    }),

    search_in_book: tool({
      description:
        "在当前打开的书内全文搜索一个词，返回命中位置的摘录与 CFI（配合 jump_to_location 可跳转）。仅在阅读页可用。",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: { type: "string", description: "要搜索的词或短语" },
        },
        required: ["query"],
      }),
      execute: async ({ query }) => {
        const bridge = getReaderBridge();
        if (!bridge) return "当前没有打开中的书（不在阅读页），无法书内搜索。";
        const trimmed = query.trim();
        if (!trimmed) return "搜索词为空。";
        const matches = await bridge.searchInBook(trimmed);
        return matches.slice(0, SEARCH_RESULT_LIMIT);
      },
    }),

    jump_to_location: tool({
      description:
        "跳转到当前书内的指定位置：传 CFI（如 search_in_book 返回的）或目录序号 tocIndex（来自 get_toc）。跳转成功会翻到该位置。",
      inputSchema: jsonSchema<{ cfi?: string; tocIndex?: number }>({
        type: "object",
        properties: {
          cfi: { type: "string", description: "目标位置的 CFI" },
          tocIndex: { type: "number", description: "目录条目序号（get_toc 返回的 index）" },
        },
      }),
      execute: async ({ cfi, tocIndex }) => {
        const bridge = getReaderBridge();
        if (!bridge) return "当前没有打开中的书（不在阅读页），无法跳转。";
        if (cfi) {
          const ok = await bridge.jumpTo(cfi);
          return ok ? "已跳转到指定位置。" : "跳转失败：CFI 无法解析。";
        }
        if (typeof tocIndex === "number") {
          const ok = await bridge.jumpToTocIndex(tocIndex);
          return ok
            ? "已跳转到该章节。"
            : "跳转失败：目录里没有这个序号。";
        }
        return "请提供 cfi 或 tocIndex 之一。";
      },
    }),
  };
}
