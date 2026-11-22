import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import {
  load as loadPersistedStore,
  type Store,
} from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { releaseCover } from "@/lib/covers";
import { parseEpub } from "@/lib/epub";
import {
  ebookFormatOf,
  fileExtensionOf,
  makeBookFile,
  readImportedMetadata,
} from "@/lib/foliate";
import { isTauri } from "@/lib/platform";
import { sha256Hex } from "@/lib/sync/hash";
import type { BookSyncData, FolderSyncData } from "@/lib/sync/types";
import type {
  Book,
  BookStoreState,
  Folder,
  LegacyShelf,
  MigrationNotice,
} from "@/lib/types";
import {
  LIBRARY_VERSION,
  assertFolderName,
  migrateLibrary,
  sortFolders,
} from "./libraryMigration";

const LIBRARY_FILE = "library.json";
const LIBRARY_BACKUP_FILE = "library.json.bak-v1";
const BOOKS_DIR = "books";
const COVERS_DIR = "covers";

/** 游泳道 A 追加的界面态（不改契约字段，只追加）。 */
export type BookStoreExtras = {
  importing: boolean;
  error: string | null;
  clearError(): void;
  /** 为缺少 contentHash 的旧书补算哈希（开启同步时跑一次）。 */
  backfillContentHashes(
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
  /** 应用远端书籍记录；data 为 null 表示删除（只移出书架，不动本机文件）。 */
  applyRemoteBook(contentHash: string, data: BookSyncData | null): void;
  /** 应用远端文件夹记录（同步协议里叫 shelf）；data 为 null 表示删除，书回到「未分类」。 */
  applyRemoteFolder(folderId: string, data: FolderSyncData | null): void;
  /** 应用远端文件夹归属变更（Folder 模型一本书只属一个文件夹，后到覆盖）。 */
  applyRemoteFolderMembership(
    contentHash: string,
    folderId: string,
    present: boolean,
  ): void;
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

async function persist(
  books: Book[],
  folders: Folder[],
  migrationNotice: MigrationNotice | null,
): Promise<void> {
  const store = await getPersistedStore();
  await store.set("books", books);
  await store.set("folders", folders);
  await store.set("libraryVersion", LIBRARY_VERSION);
  await store.set("migrationNotice", migrationNotice);
  // 旧模型的键清掉，避免旧字段残留污染下次读取。
  await store.delete("shelves");
  await store.save();
}

/**
 * 迁移前把原始 library.json 拷一份（plugin-store 格式原样），只备份一次。
 * 首次安装没有旧文件、或备份失败都不阻断迁移。
 */
async function backupLibraryOnce(root: string): Promise<void> {
  const backup = await join(root, LIBRARY_BACKUP_FILE);
  try {
    await readFile(backup);
    return; // 已有备份，不覆盖
  } catch {
    // 还没有备份，继续
  }
  try {
    const bytes = await readFile(await join(root, LIBRARY_FILE));
    await writeFile(backup, bytes);
  } catch {
    // 没有旧书库文件（首次安装）：无需备份
  }
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
  return (
    fileNameOf(path)
      .replace(/\.(?:epub|mobi|azw3|fb2|cbz|pdf)$/i, "")
      .trim() || "未命名书籍"
  );
}

function requireDesktop(action: string): void {
  if (!isTauri()) throw new Error(`${action}只在桌面应用里可用`);
}

export const useBookStore = create<BookStore>((set, get) => ({
  books: [],
  folders: [],
  libraryVersion: LIBRARY_VERSION,
  migrationNotice: null,
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
      const dirs = await ensureAppDirs();
      const store = await getPersistedStore();
      const rawVersion = await store.get<number>("libraryVersion");
      const rawBooks = await store.get<Book[]>("books");
      const rawFolders = await store.get<Folder[]>("folders");
      const rawShelves = await store.get<LegacyShelf[]>("shelves");
      const rawNotice = await store.get<MigrationNotice | null>("migrationNotice");
      const version = typeof rawVersion === "number" ? rawVersion : 1;

      // 迁移是单向覆盖写：动磁盘之前先留一份原始文件。
      if (version < LIBRARY_VERSION) await backupLibraryOnce(dirs.root);

      const result = migrateLibrary({
        libraryVersion: version,
        books: Array.isArray(rawBooks) ? rawBooks : [],
        folders: Array.isArray(rawFolders) ? rawFolders : [],
        shelves: Array.isArray(rawShelves) ? rawShelves : [],
        migrationNotice: rawNotice ?? null,
      });

      set({
        books: result.books,
        folders: result.folders,
        libraryVersion: result.libraryVersion,
        migrationNotice: result.migrationNotice,
        ready: true,
        error: null,
      });

      // 首次（或旧版）读入后写回 v2，二次启动不会重复迁移。
      if (result.migrated) {
        await persist(result.books, result.folders, result.migrationNotice);
      }
    } catch (error) {
      set({ ready: true, error: `读取书库失败：${messageOf(error)}` });
    }
  },

  async importEpub(filePath: string) {
    requireDesktop("导入");
    set({ importing: true, error: null });
    try {
      const dirs = await ensureAppDirs();
      const format = ebookFormatOf(filePath);
      if (!format) {
        throw new Error(
          `不支持的文件格式：${fileExtensionOf(filePath) || "无扩展名"}`,
        );
      }
      const bytes = await readFile(filePath);
      // 内容哈希是跨设备同步的身份：同一文件在任何设备算出同一个值。
      const contentHash = await sha256Hex(bytes);

      // 元数据解析失败不阻断导入：降级为「文件名 + 未知作者 + 无封面」。
      let meta: {
        title?: string;
        author?: string;
        coverBytes?: Uint8Array;
        coverExtension?: string;
      } | null = null;
      try {
        if (format === "epub") {
          meta = parseEpub(bytes);
        } else {
          const fileName = fileNameOf(filePath);
          meta = await readImportedMetadata(
            makeBookFile(bytes, fileName, format),
          );
        }
      } catch {
        meta = null;
      }

      const id = crypto.randomUUID();
      // 保留原扩展名：foliate 的部分格式（如 PDF / CBZ）按扩展名分支。
      const fileDestination = await join(dirs.books, `${id}.${format}`);
      await writeFile(fileDestination, bytes);

      let coverPath: string | undefined;
      if (meta?.coverBytes?.byteLength) {
        const coverExtension = meta.coverExtension ?? "jpg";
        const coverDestination = await join(dirs.covers, `${id}.${coverExtension}`);
        await writeFile(coverDestination, meta.coverBytes);
        coverPath = coverDestination;
      }

      // foliate 的 comic-book.js 直接拿 file.name 当书名（带扩展名），
      // 与文件名相同的 title 视为未提供，退回 titleFromFileName 剥掉扩展名。
      const metaTitle = meta?.title?.trim();
      const fileName = fileNameOf(filePath);
      const book: Book = {
        id,
        contentHash,
        title: metaTitle && metaTitle !== fileName ? metaTitle : titleFromFileName(filePath),
        author: meta?.author?.trim() || "未知作者",
        format,
        filePath: fileDestination,
        coverPath,
        sizeBytes: bytes.byteLength,
        addedAt: Date.now(),
        progress: 0,
        tags: [],
      };

      const books = [book, ...get().books];
      set({ books, importing: false });
      await persist(books, get().folders, get().migrationNotice);
      return book;
    } catch (error) {
      set({ importing: false, error: `导入失败：${messageOf(error)}` });
      throw error;
    }
  },

  async removeBook(id: string) {
    const target = get().books.find((book) => book.id === id);
    if (!target) return;
    requireDesktop("删除书籍");

    try {
      await remove(target.filePath);
      if (target.coverPath) await remove(target.coverPath);
    } catch {
      // 文件可能已被外部删掉：仍要把记录移出书库。
    }
    releaseCover(target.coverPath);

    const books = get().books.filter((book) => book.id !== id);
    set({ books });
    await persist(books, get().folders, get().migrationNotice);
  },

  async updateBook(id: string, patch: Partial<Book>) {
    if (!isTauri()) return;
    const books = get().books.map((book) =>
      book.id === id ? { ...book, ...patch, id: book.id } : book,
    );
    set({ books });
    await persist(books, get().folders, get().migrationNotice);
  },

  async createFolder(name: string) {
    const folders = get().folders;
    const trimmed = assertFolderName(name, folders);
    requireDesktop("文件夹管理");

    const folder: Folder = {
      id: crypto.randomUUID(),
      name: trimmed,
      order: folders.reduce((max, item) => Math.max(max, item.order), 0) + 1,
    };
    const nextFolders = sortFolders([...folders, folder]);
    set({ folders: nextFolders });
    await persist(get().books, nextFolders, get().migrationNotice);
    return folder;
  },

  async renameFolder(id: string, name: string) {
    const folders = get().folders;
    const trimmed = assertFolderName(name, folders, id);
    requireDesktop("文件夹管理");

    const nextFolders = folders.map((folder) =>
      folder.id === id ? { ...folder, name: trimmed } : folder,
    );
    set({ folders: nextFolders });
    await persist(get().books, nextFolders, get().migrationNotice);
  },

  async deleteFolder(id: string) {
    requireDesktop("文件夹管理");
    const folders = get().folders.filter((folder) => folder.id !== id);
    // 书不删：只把归属清空，回到「未分类」。
    const books = get().books.map((book) =>
      book.folderId === id
        ? (() => {
            const { folderId, ...rest } = book;
            void folderId;
            return rest;
          })()
        : book,
    );
    set({ folders, books });
    await persist(books, folders, get().migrationNotice);
  },

  async moveBookToFolder(bookId: string, folderId: string | null) {
    requireDesktop("文件夹管理");
    const books = get().books.map((book) => {
      if (book.id !== bookId) return book;
      if (!folderId) {
        const { folderId: current, ...rest } = book;
        void current;
        return rest;
      }
      return { ...book, folderId };
    });
    set({ books });
    await persist(books, get().folders, get().migrationNotice);
  },

  async dismissMigrationNotice() {
    if (get().migrationNotice === null) return;
    set({ migrationNotice: null });
    if (!isTauri()) return;
    await persist(get().books, get().folders, null);
  },

  /* ---------------------------------------------------------------- */
  /* 同步：旧数据补哈希 + 远端记录落地                                  */
  /* ---------------------------------------------------------------- */

  async backfillContentHashes(onProgress) {
    if (!isTauri()) return;
    const pending = get().books.filter(
      (book) => !book.contentHash && book.filePath,
    );
    let done = 0;
    for (const target of pending) {
      try {
        const bytes = await readFile(target.filePath);
        const contentHash = await sha256Hex(bytes);
        set((s) => ({
          books: s.books.map((book) =>
            book.id === target.id ? { ...book, contentHash } : book,
          ),
        }));
      } catch {
        // 文件缺失（外部删过）：保持未就绪，不进入同步。
      }
      done += 1;
      onProgress?.(done, pending.length);
    }
    if (pending.length)
      await persist(get().books, get().folders, get().migrationNotice);
  },

  applyRemoteBook(contentHash, data) {
    const books = get().books;
    const existing = books.find((book) => book.contentHash === contentHash);

    if (!data) {
      if (!existing) return;
      const next = books.filter((book) => book.contentHash !== contentHash);
      set({ books: next });
      if (isTauri())
        void persist(next, get().folders, get().migrationNotice);
      return;
    }

    if (existing) {
      const merged: Book = {
        ...existing,
        title: data.title,
        author: data.author,
        format: data.format,
        sizeBytes: data.sizeBytes,
        tags: [...data.tags],
        addedAt: data.addedAt,
        progress: data.progress,
      };
      if (data.lastOpenedAt !== undefined) merged.lastOpenedAt = data.lastOpenedAt;
      else delete merged.lastOpenedAt;
      if (data.lastLocationCfi) merged.lastLocationCfi = data.lastLocationCfi;
      else delete merged.lastLocationCfi;
      set({ books: books.map((book) => (book.id === existing.id ? merged : book)) });
    } else {
      // 本机还没有这本书：先落一行「云端书籍」，本机文件名/封面走 P2 的按需下载。
      const cloudBook: Book = {
        id: crypto.randomUUID(),
        contentHash,
        cloudOnly: true,
        title: data.title,
        author: data.author,
        format: data.format,
        filePath: "",
        sizeBytes: data.sizeBytes,
        addedAt: data.addedAt,
        progress: data.progress,
        tags: [...data.tags],
      };
      if (data.lastOpenedAt !== undefined) cloudBook.lastOpenedAt = data.lastOpenedAt;
      if (data.lastLocationCfi) cloudBook.lastLocationCfi = data.lastLocationCfi;
      set({ books: [cloudBook, ...books] });
    }
    if (isTauri()) void persist(get().books, get().folders, get().migrationNotice);
  },

  applyRemoteFolder(folderId, data) {
    const folders = get().folders;
    const existing = folders.find((folder) => folder.id === folderId);

    if (!data) {
      if (!existing) return;
      // 删除文件夹：书不删，归属清空回到「未分类」（与 deleteFolder 一致）。
      const next = folders.filter((folder) => folder.id !== folderId);
      const books = get().books.map((book) => {
        if (book.folderId !== folderId) return book;
        const { folderId: dropped, ...rest } = book;
        void dropped;
        return rest;
      });
      set({ folders: next, books });
      if (isTauri()) void persist(books, next, get().migrationNotice);
      return;
    }

    const next = existing
      ? folders.map((folder) =>
          folder.id === folderId
            ? { ...folder, name: data.name, order: data.order }
            : folder,
        )
      : [...folders, { id: folderId, name: data.name, order: data.order }];
    set({ folders: sortFolders(next) });
    if (isTauri())
      void persist(get().books, sortFolders(next), get().migrationNotice);
  },

  applyRemoteFolderMembership(contentHash, folderId, present) {
    // 文件夹记录还没落地时先不挂归属：等下一次同步按 HLC 顺序补齐。
    if (present && !get().folders.some((folder) => folder.id === folderId))
      return;

    let changed = false;
    const books = get().books.map((book) => {
      if (book.contentHash !== contentHash) return book;
      if (present) {
        // Folder 模型单归属：远端把它挂到别的文件夹时直接覆盖（后到优先）。
        if (book.folderId === folderId) return book;
        changed = true;
        return { ...book, folderId };
      }
      if (book.folderId !== folderId) return book;
      changed = true;
      const { folderId: dropped, ...rest } = book;
      void dropped;
      return rest;
    });
    if (!changed) return;
    set({ books });
    if (isTauri()) void persist(books, get().folders, get().migrationNotice);
  },
}));
