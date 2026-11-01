import { describe, expect, it } from "vitest";
import { buildPrompt, contextLine } from "./readingContext";

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
