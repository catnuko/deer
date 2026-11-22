import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  buildSystemPrompt,
  contextLine,
  memorySummaryBlock,
  MEMORY_SUMMARY_CHAR_BUDGET,
  type ReadingContext,
} from "./readingContext";
import type { MemoryEntry, MemoryEntryType } from "@/store/memoryStore";

describe("contextLine", () => {
  it("书名、章节、进度都在时压成一行，缺谁就省谁", () => {
    for (const [ctx, expected] of [
      [
        { bookTitle: "三体", chapterTitle: "疯狂年代", progress: 0.423 },
        "【阅读上下文】《三体》 · 当前章节：疯狂年代 · 全书进度 42%",
      ],
      [
        { bookTitle: "三体", chapterTitle: null, progress: 0.5 },
        "【阅读上下文】《三体》 · 全书进度 50%",
      ],
      [
        { bookTitle: "三体", chapterTitle: "第一章", progress: null },
        "【阅读上下文】《三体》 · 当前章节：第一章",
      ],
    ] as const) {
      expect(contextLine(ctx)).toBe(expected);
    }
  });

  it("只剩书名时返回 null，不值得和身份行重复一行", () => {
    expect(contextLine({ bookTitle: "三体", chapterTitle: null, progress: null })).toBeNull();
  });

  it("书名空白时视为没有书名，返回 null", () => {
    expect(contextLine({ bookTitle: "   ", chapterTitle: "第一章" })).toBeNull();
  });

  it("章节标题只剥首尾空白，中间原样保留", () => {
    expect(contextLine({ bookTitle: "书", chapterTitle: " 第三章 · 上山 " })).toBe(
      "【阅读上下文】《书》 · 当前章节：第三章 · 上山",
    );
  });

  it("进度越界被夹回 0–100，非数字进度整段省略", () => {
    expect(contextLine({ bookTitle: "书", progress: 1.5 })).toContain("全书进度 100%");
    expect(contextLine({ bookTitle: "书", progress: -0.2 })).toContain("全书进度 0%");
    expect(contextLine({ bookTitle: "书", progress: Number.NaN })).toBeNull();
    expect(contextLine({ bookTitle: "书", progress: Number.POSITIVE_INFINITY })).toBeNull();
    expect(contextLine({ bookTitle: "书", progress: undefined })).toBeNull();
  });

  it("进度四舍五入到整数百分比", () => {
    expect(contextLine({ bookTitle: "书", progress: 0.4249 })).toContain("42%");
    expect(contextLine({ bookTitle: "书", progress: 0.425 })).toContain("43%");
  });
});

describe("buildPrompt", () => {
  it("只有书名时保持一行身份声明，正文紧跟空行之后（与旧格式一致）", () => {
    expect(buildPrompt("主角是谁", { bookTitle: "三体" })).toBe(
      "你是《三体》这本书的伴读助手。\n\n主角是谁",
    );
  });

  it("有章节和进度时上下文行插在身份行与正文之间", () => {
    expect(
      buildPrompt("这部分讲什么", {
        bookTitle: "山中来信",
        chapterTitle: "第三章 · 一本没读完的书",
        progress: 0.3,
      }),
    ).toBe(
      [
        "你是《山中来信》这本书的伴读助手。",
        "【阅读上下文】《山中来信》 · 当前章节：第三章 · 一本没读完的书 · 全书进度 30%",
        "",
        "这部分讲什么",
      ].join("\n"),
    );
  });

  it("没传上下文时只返回用户输入本身", () => {
    expect(buildPrompt("你好")).toBe("你好");
    expect(buildPrompt("你好", null)).toBe("你好");
  });

  it("用户输入为空白时返回空串（发送方上层已挡，纯函数兜底）", () => {
    for (const question of ["", "  \n\t "]) {
      expect(buildPrompt(question, { bookTitle: "三体", progress: 0.5 })).toBe("");
    }
  });

  it("用户输入只剥首尾空白，内部换行原样保留", () => {
    expect(buildPrompt("第一行\n第二行", { bookTitle: "三体" })).toBe(
      "你是《三体》这本书的伴读助手。\n\n第一行\n第二行",
    );
  });
});

function entry(
  id: string,
  type: MemoryEntryType,
  content: string,
  updatedAt: number,
): MemoryEntry {
  return {
    id,
    bookId: "book-1",
    type,
    content,
    updatedAt,
    createdAt: updatedAt,
  };
}

describe("memorySummaryBlock", () => {
  it("空列表 / 全空内容返回 null，不产生空注入段", () => {
    expect(memorySummaryBlock([])).toBeNull();
    expect(memorySummaryBlock(null)).toBeNull();
    expect(memorySummaryBlock(undefined)).toBeNull();
    expect(memorySummaryBlock([entry("a", "topic", "  \n", 1)])).toBeNull();
  });

  it("按类型标签组装：偏好 > 进度 > 话题，同级新的在前", () => {
    const block = memorySummaryBlock([
      entry("t1", "topic", "聊过大 filter 理论", 10),
      entry("p1", "preference", "喜欢简洁回答", 5),
      entry("g1", "progress", "读到第七章", 8),
      entry("t2", "topic", "聊过面壁计划", 20),
    ])!;
    expect(block).toBe(
      [
        "【读书记忆】以下是此前会话中值得延续的信息，回答时自然衔接，不必复述：",
        "- 偏好：喜欢简洁回答",
        "- 进度：读到第七章",
        "- 话题：聊过面壁计划",
        "- 话题：聊过大 filter 理论",
      ].join("\n"),
    );
  });

  it("条目内容只剥首尾空白", () => {
    const block = memorySummaryBlock([entry("a", "topic", " 喜欢举例说明 ", 1)]);
    expect(block).toContain("- 话题：喜欢举例说明");
  });

  it("超出预算时从尾部（低优先级/更旧）开始整条丢弃", () => {
    const entries = [
      entry("p1", "preference", "偏好甲".repeat(50), 1), // 150 字
      entry("p2", "preference", "偏好乙".repeat(50), 2), // 150 字
      entry("g1", "progress", "进度丙".repeat(50), 3), // 150 字
      entry("t1", "topic", "话题丁".repeat(50), 4), // 150 字
    ];
    // 头部约 30 字 + 每行 153 字：预算只装得下前两条多一点。
    const block = memorySummaryBlock(entries, 400)!;
    expect(block).toContain("偏好甲");
    expect(block).toContain("偏好乙");
    expect(block).not.toContain("进度丙");
    expect(block).not.toContain("话题丁");
    // 产出的块不超过预算。
    expect(block.length).toBeLessThanOrEqual(400);
  });

  it("单条就超预算时截断该条装入，保证至少注入一条", () => {
    const long = "很长的记忆".repeat(100); // 500 字 > 行上限 200
    const block = memorySummaryBlock([entry("a", "topic", long, 1)], 100)!;
    const line = block.split("\n")[1]!;
    // 内容截到 200（尾部省略号），行总长 = 前缀「- 话题：」5 字 + 内容 200。
    expect(line.length).toBeLessThanOrEqual(205);
    expect(line.endsWith("…")).toBe(true);
    // 装入的是截断后的唯一一条，而不是空块。
    expect(block.split("\n")).toHaveLength(2);
    expect(block.length).toBeLessThanOrEqual(250);
  });

  it("默认预算常量控制在注入规模内", () => {
    expect(MEMORY_SUMMARY_CHAR_BUDGET).toBe(1200);
    const many = Array.from({ length: 30 }, (_, i) =>
      entry(`m${i}`, "topic", `记忆内容第${i}条，用来撑长度。`.repeat(6), i),
    );
    const block = memorySummaryBlock(many)!;
    expect(block.length).toBeLessThanOrEqual(MEMORY_SUMMARY_CHAR_BUDGET);
  });
});

describe("buildSystemPrompt 记忆注入", () => {
  const ctx: ReadingContext = {
    bookTitle: "三体",
    chapterTitle: "疯狂年代",
    progress: 0.4,
  };

  it("带记忆条目时 system 末尾追加空行 + 摘要块", () => {
    const system = buildSystemPrompt(ctx, [
      entry("a", "preference", "喜欢简洁回答", 1),
    ]);
    expect(system).toBe(
      [
        "你是 Deer 电子书阅读器的 AI 伴读助手，帮读者理解与讨论书的内容。回答基于工具取到的真实内容，拿不到就如实说明。",
        "你现在是《三体》这本书的伴读助手。",
        "【阅读上下文】《三体》 · 当前章节：疯狂年代 · 全书进度 40%",
        "",
        "【读书记忆】以下是此前会话中值得延续的信息，回答时自然衔接，不必复述：",
        "- 偏好：喜欢简洁回答",
      ].join("\n"),
    );
  });

  it("不传记忆 / 空记忆时 system 与旧行为完全一致（幂等回归）", () => {
    const expected = [
      "你是 Deer 电子书阅读器的 AI 伴读助手，帮读者理解与讨论书的内容。回答基于工具取到的真实内容，拿不到就如实说明。",
      "你现在是《三体》这本书的伴读助手。",
      "【阅读上下文】《三体》 · 当前章节：疯狂年代 · 全书进度 40%",
    ].join("\n");
    expect(buildSystemPrompt(ctx)).toBe(expected);
    expect(buildSystemPrompt(ctx, [])).toBe(expected);
    expect(buildSystemPrompt(ctx, null)).toBe(expected);
  });
});
