import { describe, expect, it } from "vitest";
import type { Book } from "@/lib/types";
import {
  SHELF_TO_FOLDER_NOTICE,
  assertFolderName,
  migrateLibrary,
} from "./libraryMigration";

type LegacyBook = Book & { shelfIds?: string[] };

function legacyBook(overrides: Partial<LegacyBook> = {}): LegacyBook {
  return {
    id: "book-1",
    title: "三体",
    author: "刘慈欣",
    format: "epub",
    filePath: "/books/santi.epub",
    sizeBytes: 1_500_000,
    addedAt: 1000,
    progress: 0.42,
    lastLocationCfi: "epubcfi(/6/4)",
    tags: [],
    ...overrides,
  };
}

const SHELVES = [
  { id: "shelf-tech", name: "技术", order: 2 },
  { id: "shelf-fiction", name: "小说", order: 1 },
];

describe("migrateLibrary 迁移规则", () => {
  it("旧书架按 order 变成同名文件夹，书按最靠前的书架归类", () => {
    const result = migrateLibrary({
      books: [
        legacyBook({ id: "b1", shelfIds: ["shelf-tech", "shelf-fiction"] }),
        legacyBook({ id: "b2", shelfIds: ["shelf-tech"] }),
        legacyBook({ id: "b3", shelfIds: [] }),
      ],
      shelves: SHELVES,
    });

    expect(result.migrated).toBe(true);
    expect(result.libraryVersion).toBe(2);
    expect(result.folders).toEqual([
      { id: "shelf-fiction", name: "小说", order: 1 },
      { id: "shelf-tech", name: "技术", order: 2 },
    ]);
    // b1 同时在两个书架：按 order 落「小说」
    expect(result.books.map((book) => book.folderId)).toEqual([
      "shelf-fiction",
      "shelf-tech",
      undefined,
    ]);
    expect(result.books.every((book) => !("shelfIds" in book))).toBe(true);
  });

  it("书 id、阅读进度、上次位置、加入时间一个不动", () => {
    const original = legacyBook({ shelfIds: ["shelf-fiction"] });
    const result = migrateLibrary({ books: [original], shelves: SHELVES });

    expect(result.books[0]).toEqual({
      id: original.id,
      title: original.title,
      author: original.author,
      format: original.format,
      filePath: original.filePath,
      sizeBytes: original.sizeBytes,
      addedAt: original.addedAt,
      progress: original.progress,
      lastLocationCfi: original.lastLocationCfi,
      tags: [],
      folderId: "shelf-fiction",
    });
  });

  it("迁移后写一次性横幅标记；没有旧书架不打扰用户", () => {
    expect(
      migrateLibrary({ books: [], shelves: SHELVES }).migrationNotice,
    ).toBe(SHELF_TO_FOLDER_NOTICE);
    expect(
      migrateLibrary({ books: [legacyBook({ shelfIds: [] })], shelves: [] })
        .migrationNotice,
    ).toBeNull();
  });

  it("libraryVersion 2 的库不再迁移，保留现有 folderId 与横幅状态", () => {
    const result = migrateLibrary({
      libraryVersion: 2,
      books: [
        legacyBook({ id: "b1", shelfIds: ["shelf-fiction"] }),
        {
          ...legacyBook({ id: "b2" }),
          folderId: "folder-x",
        } as Book,
      ],
      folders: [
        { id: "folder-x", name: "技术", order: 2 },
        { id: "folder-y", name: "小说", order: 1 },
      ],
      shelves: SHELVES,
      migrationNotice: null,
    });

    expect(result.migrated).toBe(false);
    expect(result.folders.map((folder) => folder.id)).toEqual([
      "folder-y",
      "folder-x",
    ]);
    // v2 的 book 上残留的 shelfIds 只是噪声，不参与判断
    expect(result.books[0]?.folderId).toBeUndefined();
    expect(result.books[1]?.folderId).toBe("folder-x");
    expect(result.migrationNotice).toBeNull();
  });

  it("folderId 指向已删除的文件夹时归一为未分类", () => {
    const result = migrateLibrary({
      libraryVersion: 2,
      books: [{ ...legacyBook({ id: "b1" }), folderId: "gone" } as Book],
      folders: [],
      migrationNotice: SHELF_TO_FOLDER_NOTICE,
    });

    expect(result.books[0]).not.toHaveProperty("folderId");
    expect(result.migrationNotice).toBe(SHELF_TO_FOLDER_NOTICE);
  });
});

describe("assertFolderName", () => {
  const folders = [{ id: "f1", name: "小说", order: 1 }];

  it("去空格后返回；空名与超长报错", () => {
    expect(assertFolderName("  技术 ", folders)).toBe("技术");
    expect(() => assertFolderName("   ", folders)).toThrow("文件夹名称不能为空");
    expect(() => assertFolderName("字".repeat(41), folders)).toThrow(
      "文件夹名称最多 40 个字符",
    );
  });

  it("同名（不区分大小写）报错，重命名可排除自身", () => {
    expect(() => assertFolderName("小说", folders)).toThrow(/已存在同名文件夹/);
    expect(assertFolderName("小说", folders, "f1")).toBe("小说");
  });
});