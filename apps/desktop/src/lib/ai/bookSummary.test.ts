// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { View as FoliateView } from "@/vendor/foliate-js/view.js";
import {
  BOOK_SUMMARY_CHAR_LIMIT,
  buildBookSummaryPrompt,
  buildPageSummaryPrompt,
  extractBookTextFromView,
  PAGE_SUMMARY_CHAR_LIMIT,
} from "./bookSummary";

function sectionOf(html: string, linear?: string) {
  return {
    ...(linear ? { linear } : {}),
    createDocument: () =>
      new DOMParser().parseFromString(html, "text/html"),
  };
}

function fakeView(
  sections: Array<ReturnType<typeof sectionOf> | Record<string, never>>,
): FoliateView {
  return { book: { sections } } as unknown as FoliateView;
}

describe("buildBookSummaryPrompt", () => {
  it("组装全书总结 prompt，短文本不截断", () => {
    const { prompt, truncated } = buildBookSummaryPrompt("第一段。\n\n第二段。");
    expect(truncated).toBe(false);
    expect(prompt).toContain("请总结这本书");
    expect(prompt).toContain("以下是全书内容：");
    expect(prompt).toContain("第一段。\n\n第二段。");
  });

  it("超长全书截断到 30000 码点，并要求模型注明依据范围", () => {
    const long = "甲".repeat(BOOK_SUMMARY_CHAR_LIMIT + 500);
    const { prompt, truncated } = buildBookSummaryPrompt(long);
    expect(truncated).toBe(true);
    expect(prompt).toContain("全书过长，总结基于前 30000 字符");
    // 截断按码点：emoji 不会被切成半个。
    const body = prompt.split("以下是全书内容：\n\n")[1] ?? "";
    expect(Array.from(body.trim()).length).toBe(BOOK_SUMMARY_CHAR_LIMIT);
  });
});

describe("buildPageSummaryPrompt", () => {
  it("组装当前页总结 prompt，默认 3000 码点上限", () => {
    const short = buildPageSummaryPrompt("这一页讲了两件事。");
    expect(short.truncated).toBe(false);
    expect(short.prompt).toContain("概括当前页的内容");

    const long = "乙".repeat(PAGE_SUMMARY_CHAR_LIMIT + 10);
    const { prompt, truncated } = buildPageSummaryPrompt(long);
    expect(truncated).toBe(true);
    expect(prompt).toContain("内容已截断到前 3000 字符");
  });
});

describe("extractBookTextFromView", () => {
  it("按 spine 顺序拼接各节正文", async () => {
    const view = fakeView([
      sectionOf("<html><body><p>第一章正文</p></body></html>"),
      sectionOf("<html><body><p>第二章正文</p></body></html>"),
    ]);
    const result = await extractBookTextFromView(view);
    expect(result?.text).toContain("第一章正文");
    expect(result?.text).toContain("第二章正文");
    expect(result?.truncated).toBe(false);
  });

  it("跳过 linear=no 的节与抽不出正文的图片节", async () => {
    const view = fakeView([
      sectionOf("<p>正文内容</p>"),
      sectionOf("<p>不在线性序列</p>", "no"),
      sectionOf("<html><body></body></html>"),
    ]);
    const result = await extractBookTextFromView(view);
    expect(result?.text).toContain("正文内容");
    expect(result?.text).not.toContain("不在线性序列");
  });

  it("全书抽不出正文（图片书）返回 null", async () => {
    const view = fakeView([
      sectionOf("<html><body></body></html>"),
      // 没有 createDocument 的节（图片书）直接跳过。
      {},
    ]);
    expect(await extractBookTextFromView(view)).toBeNull();
    expect(await extractBookTextFromView(null)).toBeNull();
  });

  it("累计超限即停，不遍历剩余 section，truncated 为 true", async () => {
    let visited = 0;
    const big = "丙".repeat(BOOK_SUMMARY_CHAR_LIMIT + 1);
    const view = {
      book: {
        sections: [
          {
            createDocument: () => {
              visited += 1;
              return new DOMParser().parseFromString(
                `<p>${big}</p>`,
                "text/html",
              );
            },
          },
          {
            createDocument: () => {
              visited += 1;
              return new DOMParser().parseFromString(
                "<p>不应被访问的章节</p>",
                "text/html",
              );
            },
          },
        ],
      },
    } as unknown as FoliateView;

    const result = await extractBookTextFromView(view);
    expect(visited).toBe(1);
    expect(result?.truncated).toBe(true);
    expect(Array.from(result?.text ?? "").length).toBe(
      BOOK_SUMMARY_CHAR_LIMIT,
    );
  });
});
