/**
 * Deer 原生工具集（AI SDK tool 协议，中文 description）：书架/阅读状态/
 * 目录/当前章文本/划线笔记 + 书内搜索与跳转。书架类工具对齐原 Rust MCP
 * 三工具语义；阅读类工具经 readerBridge 由阅读页提供，不在阅读页时降级。
 */

import { jsonSchema, tool, type ToolSet } from "ai";
import type {
  Book,
  ChatBookRef,
  ChatDictionaryEntry,
  ChatTranslationEntry,
  DictionarySense,
} from "@/lib/types";
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

/** 词典 senses 上限：控制上下文体积与卡片高度（词典卡设计稿 §5 约定）。 */
export const DICTIONARY_SENSE_LIMIT = 6;

/** 翻译原文上限：超长截断并提示（不改变上下文体积预算的约定）。 */
export const MAX_TRANSLATION_CHARS = 2000;

/**
 * translate_text 的入参形态：翻译由模型自行完成，把原文、译文与语言方向
 * 一并提交，工具只负责校验与承载结构化结果（不引外部翻译 API）。
 */
export type TranslateTextInput = {
  text: string;
  targetLang?: string;
  translatedText: string;
  sourceLang?: string;
};

/**
 * 校验并规范化 translate_text 的结果：
 * - 空文本/空译文返回可读错误提示（模型据此向用户说明）；
 * - 原文超 MAX_TRANSLATION_CHARS 截断并带 truncated 标记。
 */
export function normalizeTranslation(
  input: TranslateTextInput,
): ChatTranslationEntry | string {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const translatedText =
    typeof input.translatedText === "string" ? input.translatedText.trim() : "";
  if (!text) return "待翻译文本为空，请提供要翻译的内容。";
  if (!translatedText) return "译文为空，请先完成翻译再调用本工具。";

  const sourceText =
    text.length > MAX_TRANSLATION_CHARS
      ? text.slice(0, MAX_TRANSLATION_CHARS)
      : text;
  const targetLang =
    typeof input.targetLang === "string" && input.targetLang.trim()
      ? input.targetLang.trim()
      : undefined;
  const sourceLang =
    typeof input.sourceLang === "string" && input.sourceLang.trim()
      ? input.sourceLang.trim()
      : undefined;

  return {
    sourceText,
    translatedText,
    ...(sourceLang ? { sourceLang } : {}),
    ...(targetLang ? { targetLang } : {}),
    ...(text.length > MAX_TRANSLATION_CHARS ? { truncated: true } : {}),
  };
}

/** 词典查询结果：found:false 时模型按自身知识作答并说明查无词条。 */
export type DictionaryLookupResult =
  | ChatDictionaryEntry
  | { found: false; word: string };

/** dictionaryapi.dev 的原始词条形态（只标注我们消费的字段）。 */
type DictionaryApiEntry = {
  word?: unknown;
  phonetic?: unknown;
  phonetics?: { text?: unknown }[];
  meanings?: {
    partOfSpeech?: unknown;
    definitions?: { definition?: unknown; example?: unknown }[];
  }[];
};

/**
 * 解析 dictionaryapi.dev 的词条数组 → 词典卡形态。
 * 空释义直接丢弃、senses 截到上限；没有任何可用释义时返回 found:false。
 */
export function parseDictionaryEntry(
  word: string,
  payload: unknown,
): DictionaryLookupResult {
  if (!Array.isArray(payload)) return { found: false, word };
  const entry = payload.find(
    (candidate): candidate is DictionaryApiEntry =>
      !!candidate &&
      typeof candidate === "object" &&
      Array.isArray((candidate as DictionaryApiEntry).meanings),
  );
  if (!entry) return { found: false, word };

  const senses: DictionarySense[] = [];
  for (const meaning of entry.meanings ?? []) {
    if (!meaning || typeof meaning !== "object") continue;
    const partOfSpeech =
      typeof meaning.partOfSpeech === "string" && meaning.partOfSpeech.trim()
        ? meaning.partOfSpeech
        : undefined;
    for (const item of meaning.definitions ?? []) {
      if (!item || typeof item !== "object") continue;
      const definition =
        typeof item.definition === "string" ? item.definition.trim() : "";
      if (!definition) continue;
      const example =
        typeof item.example === "string" ? item.example.trim() : "";
      senses.push({
        ...(partOfSpeech ? { partOfSpeech } : {}),
        definition,
        ...(example ? { example } : {}),
      });
      if (senses.length >= DICTIONARY_SENSE_LIMIT) break;
    }
    if (senses.length >= DICTIONARY_SENSE_LIMIT) break;
  }
  if (!senses.length) return { found: false, word };

  const fallbackPhonetic = (entry.phonetics ?? []).find(
    (p) => typeof p?.text === "string" && p.text.trim(),
  )?.text as string | undefined;
  const phonetic =
    typeof entry.phonetic === "string" && entry.phonetic.trim()
      ? entry.phonetic
      : fallbackPhonetic?.trim();

  return {
    found: true,
    word:
      typeof entry.word === "string" && entry.word.trim()
        ? entry.word
        : word,
    senses,
    ...(phonetic ? { phonetic } : {}),
  };
}

/** 调 dictionaryapi.dev 查词；查无词条、非 2xx 或网络失败一律 found:false。 */
export async function lookupDictionaryWord(
  word: string,
): Promise<DictionaryLookupResult> {
  const trimmed = word.trim();
  if (!trimmed) return { found: false, word: trimmed };
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(trimmed)}`,
    );
    if (!res.ok) return { found: false, word: trimmed };
    return parseDictionaryEntry(trimmed, await res.json());
  } catch {
    return { found: false, word: trimmed };
  }
}

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
        "获取用户完整书架清单（全部书籍的书卡与文件夹分组）。书架只有一个，文件夹用于分类。与 search_books 的书卡同构，书卡附带 folderName。",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        const { books, folders } = useBookStore.getState();
        const folderNameById = new Map(
          folders.map((folder) => [folder.id, folder.name]),
        );
        return {
          folders: folders.map((folder) => ({
            id: folder.id,
            name: folder.name,
            bookCount: books.filter((book) => book.folderId === folder.id).length,
          })),
          uncategorizedCount: books.filter(
            (book) => !book.folderId || !folderNameById.has(book.folderId),
          ).length,
          books: books.map((book) => {
            const folderName = book.folderId
              ? folderNameById.get(book.folderId)
              : undefined;
            return folderName
              ? { ...bookToRef(book), folderName }
              : bookToRef(book);
          }),
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

    lookup_dictionary: tool({
      description:
        "查英文单词释义（数据源 dictionaryapi.dev）：返回结构化词条（音标/词性/英文释义/例句）。用户问某个词是什么意思、要词典解释时用它。found:false 表示词典源没收录或网络失败，此时改用自身知识解释，并向用户说明词典源没有查到。targetLang 仅提示用户偏好的解释语言，词典源释义固定为英文，需要其他语言时由你自行翻译。",
      inputSchema: jsonSchema<{ word: string; targetLang?: string }>({
        type: "object",
        properties: {
          word: { type: "string", description: "要查的英文单词（单个词或短语）" },
          targetLang: {
            type: "string",
            description: "期望的解释语言（如 zh-CN）；词典源释义固定为英文，由模型自行翻译",
          },
        },
        required: ["word"],
      }),
      execute: async ({ word }) => lookupDictionaryWord(word),
    }),

    translate_text: tool({
      description:
        "翻译任意语言的文本（由你直接完成翻译，不调外部翻译 API）：先自行翻译，再把原文、译文与语言方向通过本工具提交，前端会渲染成原文/译文对照卡。用户要翻译划选内容、句子或段落时用它；纯闲聊不需要翻译时不要调用。text 超 2000 字符时只取前 2000 字符翻译。",
      inputSchema: jsonSchema<TranslateTextInput>({
        type: "object",
        properties: {
          text: { type: "string", description: "要翻译的原文" },
          targetLang: {
            type: "string",
            description: "目标语言（如 zh-CN、日文、English）",
          },
          translatedText: {
            type: "string",
            description: "你完成的译文（原文本身已是目标语言时，做润色或改写说明）",
          },
          sourceLang: {
            type: "string",
            description: "检测出的原文语言（如 en、zh-CN），无法判断时省略",
          },
        },
        required: ["text", "translatedText"],
      }),
      execute: async (input) => normalizeTranslation(input),
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
