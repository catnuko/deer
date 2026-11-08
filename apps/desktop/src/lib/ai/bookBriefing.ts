/**
 * 开读简报（book-to-skill 的 analyze-only 借鉴）：读一本厚书之前，让模型
 * 先给一张「全书骨架」卡——作者的心智模型、章节地图、反复出现的核心概念。
 * 与概念地图同构：prompt 组装、输出解析兜底都是纯函数，便于单测。
 */
import { truncateChapterText } from "@/lib/ai/chapterSummary";

export type BookBriefingChapter = {
  title: string;
  note: string;
};

export type BookBriefingConcept = {
  term: string;
  note: string;
};

export type BookBriefingData = {
  /** 全书心智模型：这本书要解决什么问题、整体怎么组织。 */
  mentalModel: string;
  chapters: BookBriefingChapter[];
  concepts: BookBriefingConcept[];
};

/** 章节条目上限：简报是导览不是目录复刻，太长读者不会看。 */
export const MAX_BRIEFING_CHAPTERS = 24;

/** 核心概念条目上限：与概念地图同量级，防模型跑飞。 */
export const MAX_BRIEFING_CONCEPTS = 12;

/** 全书文本带入 prompt 的字符上限（与全书总结共用截断逻辑）。 */
export const BOOK_BRIEFING_CHAR_LIMIT = 30_000;

/** 目录标题带入 prompt 的条数上限：超出只保留前段顶层骨架。 */
export const MAX_BRIEFING_TOC_LINES = 48;

/**
 * 组装开读简报 prompt（外层仍会套 N1 的书名上下文）。
 * 目录标题作为章节地图的参照系：模型按真实章节顺序输出，不自己编章名。
 * 要求只输出一个 JSON 对象，便于 parseBookBriefing 解析。
 */
export function buildBookBriefingPrompt(
  bookText: string,
  chapterTitles: string[],
  limit: number = BOOK_BRIEFING_CHAR_LIMIT,
): { prompt: string; truncated: boolean } {
  const { text, truncated } = truncateChapterText(bookText, limit);
  const note = truncated
    ? `\n本书过长，以下只包含前 ${limit} 字符与目录标题，简报基于这个范围。`
    : "";
  const toc =
    chapterTitles.length > 0
      ? [
          "",
          "参考目录标题（章节地图按这个顺序组织，可合并小节）：",
          ...chapterTitles
            // 深目录可能上百条：简报只需要顶层骨架，多出的条目只烧 token。
            .slice(0, MAX_BRIEFING_TOC_LINES)
            .map((t) => `- ${t}`),
        ].join("\n")
      : "";
  return {
    prompt: [
      "读者还没开始读这本书。请生成一张「开读简报」，帮读者在动手之前建立全书骨架。",
      "只输出一个 JSON 对象，不要输出任何其他文字或代码块标记，格式如下：",
      '{"mentalModel":"三到五句话讲清这本书的问题意识与整体框架","chapters":[{"title":"章节标题","note":"一句话说明这一章在全书中的作用"}],"concepts":[{"term":"核心概念","note":"一句话说明"}]}',
      "要求：chapters 按书的实际顺序列出主要章节（不超过 24 个）；concepts 列 5 到 12 个全书反复出现的核心概念，术语 2 到 16 个字；只提炼结构，不要复述情节或复制原文；没有把握的内容不要编。",
      ...note.split("\n").filter(Boolean),
      toc,
      "",
      "以下是全书内容：",
      "",
      text,
    ].join("\n"),
    truncated,
  };
}

/**
 * 解析模型输出的简报 JSON，非法输入一律返回 null（调用方兜底提示，不崩）。
 * 容忍代码块围栏和 JSON 前后的闲话：取首个 { 到最后一个 } 之间再解析。
 * 章节与概念条目各自截到上限，缺 note/title/term 的条目丢弃；
 * 三块内容都拿不到时整体判失败，避免渲染出半张空卡。
 */
export function parseBookBriefing(raw: string): BookBriefingData | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { mentalModel, chapters: rawChapters, concepts: rawConcepts } =
    parsed as {
      mentalModel?: unknown;
      chapters?: unknown;
      concepts?: unknown;
    };
  const model =
    typeof mentalModel === "string" && mentalModel.trim()
      ? mentalModel.trim()
      : null;
  if (!model) return null;

  const chapters: BookBriefingChapter[] = [];
  if (Array.isArray(rawChapters)) {
    for (const item of rawChapters) {
      if (typeof item !== "object" || item === null) continue;
      const { title, note } = item as Record<string, unknown>;
      if (typeof title !== "string" || !title.trim()) continue;
      if (typeof note !== "string" || !note.trim()) continue;
      chapters.push({ title: title.trim(), note: note.trim() });
      if (chapters.length >= MAX_BRIEFING_CHAPTERS) break;
    }
  }

  const concepts: BookBriefingConcept[] = [];
  if (Array.isArray(rawConcepts)) {
    for (const item of rawConcepts) {
      if (typeof item !== "object" || item === null) continue;
      const { term, note } = item as Record<string, unknown>;
      if (typeof term !== "string" || !term.trim()) continue;
      if (typeof note !== "string" || !note.trim()) continue;
      concepts.push({ term: term.trim(), note: note.trim() });
      if (concepts.length >= MAX_BRIEFING_CONCEPTS) break;
    }
  }

  // 心智模型是简报的地基，没有它整卡失去意义；章节和概念至少要有一块。
  if (chapters.length === 0 && concepts.length === 0) return null;
  return { mentalModel: model, chapters, concepts };
}
