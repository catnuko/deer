// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  CHAPTER_SUMMARY_CHAR_LIMIT,
  buildChapterSummaryPrompt,
  extractSectionText,
  truncateChapterText,
} from "./chapterSummary";

describe("truncateChapterText", () => {
  it("未超限原样返回（仅去首尾空白），超限按码点截断", () => {
    expect(truncateChapterText("  正文内容  ")).toEqual({
      text: "正文内容",
      truncated: false,
    });
    expect(
      truncateChapterText("字".repeat(CHAPTER_SUMMARY_CHAR_LIMIT)).truncated,
    ).toBe(false);
    const over = truncateChapterText("字".repeat(CHAPTER_SUMMARY_CHAR_LIMIT + 5));
    expect(over.truncated).toBe(true);
    expect(over.text).toBe("字".repeat(CHAPTER_SUMMARY_CHAR_LIMIT));
  });

  it("emoji 占两个码元但按码点计数，不会被截成半个", () => {
    const text = "读".repeat(CHAPTER_SUMMARY_CHAR_LIMIT - 1) + "📚📚📚";
    const { text: cut, truncated } = truncateChapterText(text);
    expect(truncated).toBe(true);
    expect(cut.endsWith("📚")).toBe(true);
    expect(Array.from(cut)).toHaveLength(CHAPTER_SUMMARY_CHAR_LIMIT);
  });

  it("limit 可注入，方便小数字直接测", () => {
    expect(truncateChapterText("一二三四五", 3)).toEqual({
      text: "一二三",
      truncated: true,
    });
  });
});

describe("buildChapterSummaryPrompt", () => {
  it("正常章节：固定指令 + 章节全文", () => {
    const { prompt, truncated } = buildChapterSummaryPrompt("第一段全文。");
    expect(truncated).toBe(false);
    expect(prompt).toBe(
      "请总结本书当前章节：先用三五句话概括内容，再列出值得记住的观点或细节。\n\n以下是章节全文：\n\n第一段全文。",
    );
  });

  it("超长章节附说明，并要求模型把说明作为总结第一行", () => {
    const { prompt, truncated } = buildChapterSummaryPrompt("字".repeat(31_000));
    expect(truncated).toBe(true);
    expect(prompt).toContain(
      `本章过长，总结基于前 ${CHAPTER_SUMMARY_CHAR_LIMIT} 字符。请把「本章过长，总结基于前 ${CHAPTER_SUMMARY_CHAR_LIMIT} 字符」作为总结的第一行。`,
    );
    // 正文只带前 limit 字。
    expect(prompt).toContain(`\n\n${"字".repeat(CHAPTER_SUMMARY_CHAR_LIMIT)}`);
    expect(prompt).not.toContain("……");
  });
});

describe("extractSectionText", () => {
  const parse = (html: string) =>
    new DOMParser().parseFromString(html, "text/html");

  it("段落各成一行，换行拼接", () => {
    const doc = parse("<body><p>第一段。</p><p>第二段。</p></body>");
    expect(extractSectionText(doc)).toBe("第一段。\n第二段。");
  });

  it("script 与 style 整块剥掉，不进正文", () => {
    const doc = parse(
      "<body><style>p { color: red }</style><p>正文。</p><script>evil()</script></body>",
    );
    expect(extractSectionText(doc)).toBe("正文。");
  });

  it("行内元素拼进所在行，br 断行，嵌套块各成一行", () => {
    const doc = parse(
      "<body><p>他说：<em>要活着</em>。<br/>继续。</p><div><h2>小节</h2><blockquote>引文</blockquote></div></body>",
    );
    expect(extractSectionText(doc)).toBe(
      "他说：要活着。 继续。\n小节\n引文",
    );
  });

  it("多余空白压成一个空格，空文档返回空串", () => {
    const doc = parse("<body><p>  有   很多    空白 </p><p>  </p></body>");
    expect(extractSectionText(doc)).toBe("有 很多 空白");
    expect(extractSectionText(parse("<body></body>"))).toBe("");
  });
});
