/**
 * 快捷指令的 prompt 组装与全书文本抽取：
 * 「这本书说了什么？」按 spine 遍历 section 抽正文（复用章节总结的抽文本），
 * 总量截断；「当前页讲了什么？」用 foliate 上报的可见区 Range 取文本。
 */
import type { View as FoliateView } from "@/vendor/foliate-js/view.js";
import { extractSectionText, truncateChapterText } from "./chapterSummary";

/** 全书文本带入 prompt 的字符上限（按 Unicode 码点计）。 */
export const BOOK_SUMMARY_CHAR_LIMIT = 30_000;

/** 当前页文本带入 prompt 的字符上限。 */
export const PAGE_SUMMARY_CHAR_LIMIT = 3_000;

/**
 * 组装全书总结 prompt（外层仍会套 N1 的书名/章节上下文）。
 * 截断时要求模型把说明作为总结第一行，读者能一眼看到依据范围。
 */
export function buildBookSummaryPrompt(
  bookText: string,
  limit: number = BOOK_SUMMARY_CHAR_LIMIT,
): { prompt: string; truncated: boolean } {
  const { text, truncated } = truncateChapterText(bookText, limit);
  const note = truncated
    ? `\n全书过长，总结基于前 ${limit} 字符。请把「全书过长，总结基于前 ${limit} 字符」作为总结的第一行。`
    : "";
  return {
    prompt: [
      "请总结这本书：先用三五句话概括这本书讲了什么，再列出主要论点或故事线索。",
      ...note.split("\n").filter(Boolean),
      "",
      "以下是全书内容：",
      "",
      text,
    ].join("\n"),
    truncated,
  };
}

/** 组装当前页总结 prompt。 */
export function buildPageSummaryPrompt(
  pageText: string,
  limit: number = PAGE_SUMMARY_CHAR_LIMIT,
): { prompt: string; truncated: boolean } {
  const { text, truncated } = truncateChapterText(pageText, limit);
  const note = truncated
    ? `\n（内容已截断到前 ${limit} 字符）`
    : "";
  return {
    prompt: [
      "请用三五句话概括当前页的内容，突出读者此刻正在读的要点。",
      ...note.split("\n").filter(Boolean),
      "",
      "以下是当前页内容：",
      "",
      text,
    ].join("\n"),
    truncated,
  };
}

/**
 * 从已打开的 foliate view 抽全书可读正文：按 spine 遍历各 section，
 * 单节抽不出（图片页/损坏节）就跳过，累计超过上限即停。
 * 返回 null 表示全书抽不出任何可读正文（如 CBZ/PDF 的图片书）。
 */
export async function extractBookTextFromView(
  view: FoliateView | null,
  limit: number = BOOK_SUMMARY_CHAR_LIMIT,
): Promise<{ text: string; truncated: boolean } | null> {
  if (!view) return null;
  const parts: string[] = [];
  let stoppedEarly = false;
  for (const section of view.book.sections) {
    if (section.linear === "no") continue;
    try {
      const doc = await section.createDocument?.();
      const text = doc ? extractSectionText(doc) : "";
      if (text) parts.push(text);
    } catch {
      // 单节失败不影响其余节的抽取。
    }
    if (parts.join("\n\n").length > limit) {
      stoppedEarly = true;
      break;
    }
  }
  const joined = parts.join("\n\n");
  if (!joined.trim()) return null;
  const result = truncateChapterText(joined, limit);
  return { text: result.text, truncated: stoppedEarly || result.truncated };
}
