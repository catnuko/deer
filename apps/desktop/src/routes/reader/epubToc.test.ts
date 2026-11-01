import { describe, expect, it } from "vitest";
import {
  flattenToc,
  hrefWithoutFragment,
  matchTocIndex,
  normalizeHref,
  type RawTocNode,
} from "./epubToc";

describe("normalizeHref / hrefWithoutFragment", () => {
  it("去掉 ./ 前缀与查询串，保留 fragment", () => {
    expect(normalizeHref("./text/part1.html#ch2")).toBe("text/part1.html#ch2");
    expect(normalizeHref("text/part1.html?x=1")).toBe("text/part1.html");
    expect(hrefWithoutFragment("./text/part1.html#ch2")).toBe("text/part1.html");
  });
});

describe("flattenToc", () => {
  it("展平嵌套目录并连续编号，无 href 的节点跳过", () => {
    const raw: RawTocNode[] = [
      { label: "封面", href: "cover.html" },
      {
        label: "第一卷",
        href: "vol1.html",
        subitems: [
          { label: { trim: () => "第一章" }, href: "./vol1/ch1.html" },
          { label: "第二章", href: "vol1/ch2.html", subitems: [] },
        ],
      },
      { label: "无链接项" },
    ];
    const items = flattenToc(raw);
    expect(items.map((item) => item.title)).toEqual([
      "封面",
      "第一卷",
      "第一章",
      "第二章",
    ]);
    expect(items.map((item) => item.href)).toEqual([
      "cover.html",
      "vol1.html",
      "vol1/ch1.html",
      "vol1/ch2.html",
    ]);
    expect(items.map((item) => item.index)).toEqual([0, 1, 2, 3]);
  });
});

describe("matchTocIndex", () => {
  const toc = flattenToc([
    { label: "a", href: "text/part0001.html" },
    { label: "b", href: "text/part0007.html#first" },
    { label: "c", href: "text/part0009.html" },
  ]);

  it("精确匹配（含 fragment）优先", () => {
    expect(matchTocIndex("text/part0007.html#first", toc)).toBe(1);
  });

  it("同文件不同 fragment 退化为文件路径匹配", () => {
    expect(matchTocIndex("text/part0007.html#second", toc)).toBe(1);
    expect(matchTocIndex("text/part0007.html", toc)).toBe(1);
  });

  it("无匹配返回 undefined，空入参安全", () => {
    expect(matchTocIndex("text/other.html", toc)).toBeUndefined();
    expect(matchTocIndex(undefined, toc)).toBeUndefined();
    expect(matchTocIndex("text/part0009.html", [])).toBeUndefined();
  });
});
