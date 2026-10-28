import type { Book, Shelf } from "@/lib/types";

/**
 * 浏览器预览数据（只在 `?preview=1` 且非 Tauri 环境下使用）。
 * 桌面应用里永远读 appDataDir 的真实书库，这里不会被加载。
 */
export const PREVIEW_SHELVES: Shelf[] = [
  { id: "preview-shelf-fiction", name: "小说", order: 1 },
  { id: "preview-shelf-tech", name: "技术", order: 2 },
];

export const PREVIEW_BOOKS: Book[] = [
  {
    id: "preview-book-1",
    title: "雪国",
    author: "川端康成",
    format: "epub",
    filePath: "/preview/雪国.epub",
    sizeBytes: 1_842_311,
    addedAt: Date.UTC(2026, 9, 21),
    progress: 0.34,
    shelfIds: ["preview-shelf-fiction"],
    tags: [],
  },
  {
    id: "preview-book-2",
    title: "Designing Data-Intensive Applications",
    author: "Martin Kleppmann",
    format: "epub",
    filePath: "/preview/ddia.epub",
    sizeBytes: 12_508_144,
    addedAt: Date.UTC(2026, 9, 24),
    progress: 0.08,
    shelfIds: ["preview-shelf-tech"],
    tags: [],
  },
  {
    id: "preview-book-3",
    title: "人类简史：从动物到上帝",
    author: "尤瓦尔·赫拉利",
    format: "epub",
    filePath: "/preview/人类简史.epub",
    sizeBytes: 4_210_998,
    addedAt: Date.UTC(2026, 9, 26),
    progress: 0,
    shelfIds: ["preview-shelf-fiction", "preview-shelf-tech"],
    tags: [],
  },
];
