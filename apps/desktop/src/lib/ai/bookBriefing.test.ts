import { describe, expect, it } from "vitest";
import {
  BOOK_BRIEFING_CHAR_LIMIT,
  MAX_BRIEFING_CHAPTERS,
  MAX_BRIEFING_CONCEPTS,
  MAX_BRIEFING_TOC_LINES,
  buildBookBriefingPrompt,
  parseBookBriefing,
} from "./bookBriefing";

const VALID =
  '{"mentalModel":"现象—机制—对策的三段式论证。","chapters":[{"title":"第一章 深度工作","note":"定义问题。"},{"title":"第二章 诱因设计","note":"解释机制。"}],"concepts":[{"term":"深度工作","note":"无干扰的高专注状态"}]}';

describe("buildBookBriefingPrompt", () => {
  it("固定指令（含 JSON 格式与上限要求）+ 目录标题 + 全书内容", () => {
    const { prompt, truncated } = buildBookBriefingPrompt(
      "全书正文。",
      ["第一章", "第二章"],
    );
    expect(truncated).toBe(false);
    expect(prompt).toContain("只输出一个 JSON 对象");
    expect(prompt).toContain('"mentalModel"');
    expect(prompt).toContain("不超过 24 个");
    expect(prompt).toContain("参考目录标题（章节地图按这个顺序组织，可合并小节）：");
    expect(prompt).toContain("- 第一章");
    expect(prompt).toContain("\n\n以下是全书内容：\n\n全书正文。");
  });

  it("无目录时省略目录段，其余照常", () => {
    const { prompt } = buildBookBriefingPrompt("全书正文。", []);
    expect(prompt).not.toContain("参考目录标题");
    expect(prompt).toContain("以下是全书内容：");
  });

  it("超长正文按码点截断，并说明简报基于前 limit 字符", () => {
    const { prompt, truncated } = buildBookBriefingPrompt(
      "字".repeat(BOOK_BRIEFING_CHAR_LIMIT + 3),
      [],
    );
    expect(truncated).toBe(true);
    expect(prompt).toContain(
      `本书过长，以下只包含前 ${BOOK_BRIEFING_CHAR_LIMIT} 字符`,
    );
    expect(prompt).toContain(`\n\n${"字".repeat(BOOK_BRIEFING_CHAR_LIMIT)}`);
    expect(prompt).not.toContain("字".repeat(BOOK_BRIEFING_CHAR_LIMIT + 1));
  });

  it("目录条数截到上限，多出的不进 prompt", () => {
    const titles = Array.from(
      { length: MAX_BRIEFING_TOC_LINES + 5 },
      (_, i) => `第${i + 1}章`,
    );
    const { prompt } = buildBookBriefingPrompt("正文。", titles);
    expect(prompt).toContain(`- 第${MAX_BRIEFING_TOC_LINES}章`);
    expect(prompt).not.toContain(`- 第${MAX_BRIEFING_TOC_LINES + 1}章`);
  });
});

describe("parseBookBriefing", () => {
  it("合法 JSON（裸对象）解析出三块内容", () => {
    const data = parseBookBriefing(VALID);
    expect(data).toEqual({
      mentalModel: "现象—机制—对策的三段式论证。",
      chapters: [
        { title: "第一章 深度工作", note: "定义问题。" },
        { title: "第二章 诱因设计", note: "解释机制。" },
      ],
      concepts: [{ term: "深度工作", note: "无干扰的高专注状态" }],
    });
  });

  it("容忍代码块围栏和 JSON 前后的闲话", () => {
    const fenced = `好的，这是开读简报：\n\`\`\`json\n${VALID}\n\`\`\`\n希望有帮助。`;
    expect(parseBookBriefing(fenced)).toEqual(parseBookBriefing(VALID));
  });

  it("没有章节时概念可以独立撑起简报，反之亦然", () => {
    const noChapters = parseBookBriefing(
      '{"mentalModel":"骨架。","chapters":[],"concepts":[{"term":"概念","note":"说明"}]}',
    );
    expect(noChapters?.chapters).toEqual([]);
    expect(noChapters?.concepts).toHaveLength(1);

    const noConcepts = parseBookBriefing(
      '{"mentalModel":"骨架。","chapters":[{"title":"章","note":"注"}],"concepts":[]}',
    );
    expect(noConcepts?.chapters).toHaveLength(1);
    expect(noConcepts?.concepts).toEqual([]);
  });

  it.each([
    ["空字符串", ""],
    ["没有 JSON", "这本书不太好总结。"],
    ["JSON 语法错误", '{"mentalModel":"骨架",}'],
    ["缺 mentalModel", '{"chapters":[],"concepts":[]}'],
    ["mentalModel 为空串", '{"mentalModel":"  ","chapters":[{"title":"章","note":"注"}],"concepts":[]}'],
    ["章节和概念都为空", '{"mentalModel":"骨架。","chapters":[],"concepts":[]}'],
    ["chapters 不是数组", '{"mentalModel":"骨架。","chapters":"很多","concepts":[]}'],
    ["章节缺 title（且无概念可救）", '{"mentalModel":"骨架。","chapters":[{"note":"注"}],"concepts":[]}'],
    ["概念缺 note", '{"mentalModel":"骨架。","chapters":[],"concepts":[{"term":"概念"}]}'],
    ["顶层不是对象", "[1,2,3]"],
  ])("%s → 返回 null", (_name, raw) => {
    expect(parseBookBriefing(raw)).toBeNull();
  });

  it("章节与概念条目各自截到上限", () => {
    const chapters = Array.from({ length: MAX_BRIEFING_CHAPTERS + 5 }, (_, i) => ({
      title: `第${i + 1}章`,
      note: "注",
    }));
    const concepts = Array.from({ length: MAX_BRIEFING_CONCEPTS + 5 }, (_, i) => ({
      term: `概念${i + 1}`,
      note: "说明",
    }));
    const data = parseBookBriefing(
      JSON.stringify({ mentalModel: "骨架。", chapters, concepts }),
    );
    expect(data?.chapters).toHaveLength(MAX_BRIEFING_CHAPTERS);
    expect(data?.concepts).toHaveLength(MAX_BRIEFING_CONCEPTS);
    expect(data?.chapters[0]?.title).toBe("第1章");
  });
});
