import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/types";
import { sortBooks } from "./sortBooks";

function book(id: string, patch: Partial<Book> = {}): Book {
  return {
    id,
    title: id,
    author: "",
    format: "epub",
    filePath: `/books/${id}.epub`,
    sizeBytes: 1,
    addedAt: 0,
    progress: 0,
    shelfIds: [],
    tags: [],
    ...patch,
  };
}

describe("sortBooks", () => {
  it("recent：最近打开优先，没打开过的按导入时间，然后按书名", () => {
    const books = [
      book("a", { lastOpenedAt: 100, addedAt: 1 }),
      book("b", { addedAt: 500 }),
      book("c", { lastOpenedAt: 300, addedAt: 2 }),
      book("d", { addedAt: 400 }),
    ];
    expect(sortBooks(books, "recent").map((b) => b.id)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("title / author 用中文排序，空值置后", () => {
    const books = [
      book("1", { title: "雪国", author: "川端康成" }),
      book("2", { title: "三体", author: "" }),
      book("3", { title: "", author: "刘慈欣" }),
      book("4", { title: "人类简史", author: "尤瓦尔·赫拉利" }),
    ];
    expect(sortBooks(books, "title").map((b) => b.id)).toEqual([
      "4",
      "2",
      "1",
      "3",
    ]);
    expect(sortBooks(books, "author").map((b) => b.id)).toEqual([
      "1",
      "3",
      "4",
      "2",
    ]);
  });

  it("added：导入时间降序，最新在前", () => {
    const books = [
      book("old", { addedAt: 1 }),
      book("new", { addedAt: 3 }),
      book("mid", { addedAt: 2 }),
    ];
    expect(sortBooks(books, "added").map((b) => b.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("返回新数组，不改变传入顺序", () => {
    const books = [book("a", { addedAt: 1 }), book("b", { addedAt: 2 })];
    sortBooks(books, "added");
    expect(books.map((b) => b.id)).toEqual(["a", "b"]);
  });
});