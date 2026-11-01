/**
 * 章节总结（N3）：取当前章节全文，组装成走 N1 上下文注入的总结请求。
 * 纯函数 + 一个 DOM 抽文本工具，便于单测。
 */

/** 章节全文带入 prompt 的字符上限（按 Unicode 码点计）。 */
export const CHAPTER_SUMMARY_CHAR_LIMIT = 30_000;

/**
 * 超长章节按码点截断：emoji 等代理对不会被切成半个。
 */
export function truncateChapterText(
  text: string,
  limit: number = CHAPTER_SUMMARY_CHAR_LIMIT,
): { text: string; truncated: boolean } {
  const chars = Array.from(text.trim());
  const truncated = chars.length > limit;
  return {
    text: truncated ? chars.slice(0, limit).join("") : chars.join(""),
    truncated,
  };
}

/**
 * 组装发给 claude 的总结 prompt（外层仍会套 N1 的书名/章节上下文）。
 * 截断时要求模型把说明作为总结第一行，读者能一眼看到依据范围。
 */
export function buildChapterSummaryPrompt(
  chapterText: string,
  limit: number = CHAPTER_SUMMARY_CHAR_LIMIT,
): { prompt: string; truncated: boolean } {
  const { text, truncated } = truncateChapterText(chapterText, limit);
  const note = truncated
    ? `\n本章过长，总结基于前 ${limit} 字符。请把「本章过长，总结基于前 ${limit} 字符」作为总结的第一行。`
    : "";
  return {
    prompt: [
      "请总结本书当前章节：先用三五句话概括内容，再列出值得记住的观点或细节。",
      ...note.split("\n").filter(Boolean),
      "",
      "以下是章节全文：",
      "",
      text,
    ].join("\n"),
    truncated,
  };
}

/** 提取行级块元素的标签：进入/退出时各换一行。 */
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "blockquote", "li", "ul", "ol",
  "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "table", "pre",
  "figcaption", "header", "footer", "aside", "main", "nav", "figure",
  "dl", "dt", "dd", "tr", "body", "html",
]);

/**
 * 从章节 document 抽出可读文本：剥掉 script/style，
 * 块级元素成行、行内元素拼接，供章节总结用。
 * 返回空串说明这一节没有可读正文（如 CBZ/PDF 的图片页）。
 */
export function extractSectionText(doc: Document): string {
  const root = doc.body ?? doc.documentElement;
  if (!root) return "";
  for (const el of root.querySelectorAll("script, style")) el.remove();

  const lines: string[] = [];
  const inline: string[] = [];
  const flush = () => {
    const text = inline.join("").replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
    inline.length = 0;
  };
  const walk = (node: Node) => {
    if (node.nodeType === node.TEXT_NODE) {
      inline.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      inline.push(" ");
      return;
    }
    if (BLOCK_TAGS.has(tag)) {
      flush();
      for (const child of Array.from(el.childNodes)) walk(child);
      flush();
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(root);
  flush();
  return lines.join("\n");
}
