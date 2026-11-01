import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/types";
import type { StoredAnnotation } from "@/store/annotationStore";
import { aggregateNotesOf } from "./notesList";

const book = (overrides: Partial<Book>): Book => ({
  id: "book-1",
  title: "三体",
  author: "刘慈欣",
  format: "epub",
  filePath: "/books/book-1.epub",
  sizeBytes: 2048,
  addedAt: 1000,
  shelfIds: [],
  tags: [],
  progress: 0,
  ...overrides,
});

const note = (overrides: Partial<StoredAnnotation> = {}): StoredAnnotation => ({
  id: "anno-1",
  cfi: "epubcfi(/6/4)",
  color: "#fbbf24",
  createdAt: 1000,
  ...overrides,
});

describe("aggregateNotesOf", () => {
  it("按书分组并带上书名，组内保持新在前", () => {
    const annotations = {
      "book-1": [
        note({ id: "a2", createdAt: 2000 }),
        note({ id: "a1", createdAt: 1000 }),
      ],
    };
    const groups = aggregateNotesOf(annotations, [book({ id: "book-1" })]);

    expect(groups).toEqual([
      {
        bookId: "book-1",
        bookTitle: "三体",
        notes: [
          expect.objectContaining({ id: "a2", bookId: "book-1" }),
          expect.objectContaining({ id: "a1", bookId: "book-1" }),
        ],
      },
    ]);
  });

  it("没有注解的书不出现，注解指向已删除的书也不出现", () => {
    const annotations = {
      "book-1": [note()],
      "book-gone": [note({ id: "a-gone" })],
    };
    const groups = aggregateNotesOf(annotations, [
      book({ id: "book-1" }),
      book({ id: "book-empty", title: "空书" }),
    ]);

    expect(groups.map((group) => group.bookId)).toEqual(["book-1"]);
  });

  it("组按最新一条笔记时间倒排，最近有动静的书排前面", () => {
    const annotations = {
      old: [note({ id: "old-1", createdAt: 100 })],
      new: [note({ id: "new-1", createdAt: 9000 })],
    };
    const groups = aggregateNotesOf(annotations, [
      book({ id: "old", title: "旧书" }),
      book({ id: "new", title: "新书" }),
    ]);

    expect(groups.map((group) => group.bookId)).toEqual(["new", "old"]);
  });

  it("books 为空或注解库为空时返回空数组，不抛错", () => {
    expect(aggregateNotesOf({}, [])).toEqual([]);
    expect(aggregateNotesOf({}, [book({ id: "book-1" })])).toEqual([]);

    const weirdInputs: unknown[] = [undefined, null, 42, "x"];
    const books = [book({ id: "book-1" })];
    // 注解库整体异常时按空库处理，页面还能渲染空态。
    for (const weird of weirdInputs) {
      expect(
        aggregateNotesOf(weird as Record<string, StoredAnnotation[]>, books),
      ).toEqual([]);
    }
  });
});
