import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import {
  load as loadPersistedStore,
  type Store,
} from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { releaseCover } from "@/lib/covers";
import { parseEpub } from "@/lib/epub";
import { isTauri } from "@/lib/platform";
import type { Book, BookStoreState, Shelf } from "@/lib/types";

const LIBRARY_FILE = "library.json";
const BOOKS_DIR = "books";
const COVERS_DIR = "covers";

/** 游泳道 A 追加的界面态（不改契约字段，只追加）。 */
export type BookStoreExtras = {
  importing: boolean;
  error: string | null;
  renameShelf(id: string, name: string): Promise<void>;
  clearError(): void;
};

export type BookStore = BookStoreState & BookStoreExtras;

let persistedStorePromise: Promise<Store> | null = null;

async function getPersistedStore(): Promise<Store> {
  // 用 Promise 记忆化：StrictMode 下 load() 会跑两次，避免创建两个实例互相覆盖。
  persistedStorePromise ??= loadPersistedStore(LIBRARY_FILE, {
    autoSave: false,
  });
  return persistedStorePromise;
}

type AppDirs = { root: string; books: string; covers: string };

async function appDirs(): Promise<AppDirs> {
  const root = await appDataDir();
  return {
    root,
    books: await join(root, BOOKS_DIR),
    covers: await join(root, COVERS_DIR),
  };
}

async function ensureAppDirs(): Promise<AppDirs> {
  const dirs = await appDirs();
  await mkdir(dirs.books, { recursive: true });
  await mkdir(dirs.covers, { recursive: true });
  return dirs;
}

async function persist(books: Book[], shelves: Shelf[]): Promise<void> {
  const store = await getPersistedStore();
  await store.set("books", books);
  await store.set("shelves", shelves);
  await store.save();
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function fileNameOf(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] ?? path;
}

function titleFromFileName(path: string): string {
  return fileNameOf(path).replace(/\.epub$/i, "").trim() || "未命名书籍";
}

/** 去掉已删除书架留下的悬空 shelfIds。 */
function pruneShelfIds(books: Book[], shelves: Shelf[]): Book[] {
  const known = new Set(shelves.map((shelf) => shelf.id));
  return books.map((book) => {
    const shelfIds = (book.shelfIds ?? []).filter((id) => known.has(id));
    return shelfIds.length === (book.shelfIds ?? []).length
      ? book
      : { ...book, shelfIds };
  });
}

function sortShelves(shelves: Shelf[]): Shelf[] {
  return [...shelves].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function assertShelfName(name: string, shelves: Shelf[], exceptId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("书架名称不能为空");
  if (trimmed.length > 40) throw new Error("书架名称最多 40 个字符");
  const duplicated = shelves.some(
    (shelf) =>
      shelf.id !== exceptId && shelf.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicated) throw new Error(`已存在同名书架「${trimmed}」`);
  return trimmed;
}

export const useBookStore = create<BookStore>((set, get) => ({
  books: [],
  shelves: [],
  ready: false,
  importing: false,
  error: null,

  clearError() {
    set({ error: null });
  },

  async load() {
    // 浏览器直开时没有 Tauri 能力：只标记 ready，界面走空态。
    if (!isTauri()) {
      set({ ready: true });
      return;
    }
    try {
      await ensureAppDirs();
      const store = await getPersistedStore();
      const rawBooks = await store.get<Book[]>("books");
      const rawShelves = await store.get<Shelf[]>("shelves");
      const shelves = sortShelves(Array.isArray(rawShelves) ? rawShelves : []);
      const books = pruneShelfIds(
        Array.isArray(rawBooks) ? rawBooks : [],
        shelves,
      );
      set({ books, shelves, ready: true, error: null });
    } catch (error) {
      set({ ready: true, error: `读取书库失败：${messageOf(error)}` });
    }
  },

  async importEpub(filePath: string) {
    if (!isTauri()) throw new Error("EPUB 导入只在桌面应用里可用");
    set({ importing: true, error: null });
    try {
      const dirs = await ensureAppDirs();
      const bytes = await readFile(filePath);

      // 元数据解析失败不阻断导入：降级为「文件名 + 未知作者 + 无封面」。
      let meta: ReturnType<typeof parseEpub> | null = null;
      try {
        meta = parseEpub(bytes);
      } catch {
        meta = null;
      }

      const id = crypto.randomUUID();
      const fileDestination = await join(dirs.books, `${id}.epub`);
      await writeFile(fileDestination, bytes);

      let coverPath: string | undefined;
      if (meta?.coverBytes?.byteLength) {
        const coverExtension = meta.coverExtension ?? "jpg";
        const coverDestination = await join(dirs.covers, `${id}.${coverExtension}`);
        await writeFile(coverDestination, meta.coverBytes);
        coverPath = coverDestination;
      }

      const book: Book = {
        id,
        title: meta?.title?.trim() || titleFromFileName(filePath),
        author: meta?.author?.trim() || "未知作者",
        format: "epub",
        filePath: fileDestination,
        coverPath,
        sizeBytes: bytes.byteLength,
        addedAt: Date.now(),
        progress: 0,
        shelfIds: [],
        tags: [],
      };

      const books = [book, ...get().books];
      set({ books, importing: false });
      await persist(books, get().shelves);
      return book;
    } catch (error) {
      set({ importing: false, error: `导入失败：${messageOf(error)}` });
      throw error;
    }
  },

  async removeBook(id: string) {
    const target = get().books.find((book) => book.id === id);
    if (!target) return;
    if (!isTauri()) throw new Error("删除书籍只在桌面应用里可用");

    try {
      await remove(target.filePath);
      if (target.coverPath) await remove(target.coverPath);
    } catch {
      // 文件可能已被外部删掉：仍要把记录移出书库。
    }
    releaseCover(target.coverPath);

    const books = get().books.filter((book) => book.id !== id);
    set({ books });
    await persist(books, get().shelves);
  },

  async updateBook(id: string, patch: Partial<Book>) {
    if (!isTauri()) return;
    const books = get().books.map((book) =>
      book.id === id ? { ...book, ...patch, id: book.id } : book,
    );
    set({ books });
    await persist(books, get().shelves);
  },

  async createShelf(name: string) {
    const shelves = get().shelves;
    const trimmed = assertShelfName(name, shelves);
    if (!isTauri()) throw new Error("书架管理只在桌面应用里可用");

    const shelf: Shelf = {
      id: crypto.randomUUID(),
      name: trimmed,
      order: shelves.reduce((max, item) => Math.max(max, item.order), 0) + 1,
    };
    const nextShelves = sortShelves([...shelves, shelf]);
    set({ shelves: nextShelves });
    await persist(get().books, nextShelves);
    return shelf;
  },

  async renameShelf(id: string, name: string) {
    const shelves = get().shelves;
    const trimmed = assertShelfName(name, shelves, id);
    if (!isTauri()) throw new Error("书架管理只在桌面应用里可用");

    const nextShelves = shelves.map((shelf) =>
      shelf.id === id ? { ...shelf, name: trimmed } : shelf,
    );
    set({ shelves: nextShelves });
    await persist(get().books, nextShelves);
  },

  async deleteShelf(id: string) {
    if (!isTauri()) throw new Error("书架管理只在桌面应用里可用");
    const shelves = get().shelves.filter((shelf) => shelf.id !== id);
    const books = pruneShelfIds(get().books, shelves);
    set({ shelves, books });
    await persist(books, shelves);
  },

  async moveBookToShelf(bookId: string, shelfId: string) {
    if (!isTauri()) throw new Error("书架管理只在桌面应用里可用");
    const books = get().books.map((book) => {
      if (book.id !== bookId) return book;
      const shelfIds = book.shelfIds.includes(shelfId)
        ? book.shelfIds.filter((id) => id !== shelfId)
        : [...book.shelfIds, shelfId];
      return { ...book, shelfIds };
    });
    set({ books });
    await persist(books, get().shelves);
  },
}));
