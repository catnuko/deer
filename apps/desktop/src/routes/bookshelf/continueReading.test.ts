import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/types";
import { continueReadingBookOf } from "./continueReading";

function bookOf(overrides: Partial<Book> & Pick<Book, "id">): Book {
  return {
    title: `书 ${overrides.id}`,
    author: "作者",
    format: "epub",
    filePath: `/books/${overrides.id}.epub`,
    sizeBytes: 1024,
    addedAt: 1000,
    progress: 0,
    shelfIds: [],
    tags: [],
    ...overrides,
  };
}

describe("continueReadingBookOf（继续阅读卡片选书）", () => {
  it("一本书都没读过（没有保存位置）就不显示卡片", () => {
    expect(
      continueReadingBookOf([
        bookOf({ id: "a", progress: 0.5 }),
        bookOf({ id: "b" }),
      ]),
    ).toBeNull();
    expect(continueReadingBookOf([])).toBeNull();
  });

  it("在存过位置的书里挑最近打开的那本", () => {
    const picked = continueReadingBookOf([
      bookOf({ id: "old", lastLocationCfi: "cfi-old", lastOpenedAt: 100 }),
      bookOf({ id: "new", lastLocationCfi: "cfi-new", lastOpenedAt: 200 }),
    ]);
    expect(picked?.id).toBe("new");
  });

  it("没记过打开时间就退回导入时间比新旧", () => {
    const picked = continueReadingBookOf([
      bookOf({ id: "later-added", lastLocationCfi: "cfi-b", addedAt: 500 }),
      bookOf({ id: "earlier-added", lastLocationCfi: "cfi-a", addedAt: 300 }),
    ]);
    expect(picked?.id).toBe("later-added");
  });

  it("打开时间优先于导入时间：旧导入但最近打开的书胜出", () => {
    const picked = continueReadingBookOf([
      bookOf({ id: "imported-late", lastLocationCfi: "cfi-a", addedAt: 1000 }),
      bookOf({
        id: "opened-recently",
        lastLocationCfi: "cfi-b",
        addedAt: 100,
        lastOpenedAt: 2000,
      }),
    ]);
    expect(picked?.id).toBe("opened-recently");
  });
});
