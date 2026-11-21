/**
 * library.json 的书架 → 文件夹迁移（纯函数，方便单测）。
 *
 * v1：books 带 shelfIds（多对多）+ shelves 列表。
 * v2：books 带 folderId（一书一夹）+ folders 列表 + libraryVersion 2。
 * 迁移规则：每个旧书架原样变成同名文件夹（沿用旧 id）；同时属于多个书架的书
 * 按旧书架 order 归入最靠前的一个；没归类的书留在「未分类」。书 id、阅读进度、
 * 上次位置等其余字段一个不动。
 */
import type { Book, Folder, LegacyShelf, MigrationNotice } from "@/lib/types";

export const LIBRARY_VERSION = 2 as const;
export const SHELF_TO_FOLDER_NOTICE: MigrationNotice = "shelf-to-folder";
export const FOLDER_NAME_MAX_LENGTH = 40;

export type LibrarySnapshot = {
  libraryVersion?: number;
  books: Book[];
  folders?: Folder[];
  /** 旧版遗留的书架列表，只在迁移时读入。 */
  shelves?: LegacyShelf[];
  migrationNotice?: MigrationNotice | null;
};

export type LibraryMigrationResult = {
  books: Book[];
  folders: Folder[];
  libraryVersion: number;
  migrationNotice: MigrationNotice | null;
  /** 是否真的从旧模型迁移过（调用方据此写回磁盘）。 */
  migrated: boolean;
};

export function sortFolders(folders: Folder[]): Folder[] {
  return [...folders].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name),
  );
}

function withoutFolder(book: Book): Book {
  const { folderId, ...rest } = book;
  void folderId;
  return rest;
}

export function migrateLibrary(snapshot: LibrarySnapshot): LibraryMigrationResult {
  const version =
    typeof snapshot.libraryVersion === "number" ? snapshot.libraryVersion : 1;
  const migrated = version < LIBRARY_VERSION;
  const legacyShelves = migrated
    ? sortFolders(Array.isArray(snapshot.shelves) ? snapshot.shelves : [])
    : [];

  let folders: Folder[];
  let books: Book[];

  if (migrated) {
    folders = legacyShelves.map(({ id, name, order }) => ({ id, name, order }));
    const folderOrder = folders.map((folder) => folder.id);
    books = snapshot.books.map((entry) => {
      const book = entry as Book & { shelfIds?: string[] };
      const legacyIds = Array.isArray(book.shelfIds) ? book.shelfIds : [];
      const folderId = folderOrder.find((id) => legacyIds.includes(id));
      const { shelfIds, ...rest } = book;
      void shelfIds;
      return folderId ? { ...rest, folderId } : rest;
    });
  } else {
    folders = sortFolders(Array.isArray(snapshot.folders) ? snapshot.folders : []);
    books = snapshot.books.map((book) => ({ ...book }));
  }

  // 悬空 folderId 归一为未分类（等价于旧版的 pruneShelfIds）。
  const known = new Set(folders.map((folder) => folder.id));
  books = books.map((book) =>
    book.folderId && !known.has(book.folderId) ? withoutFolder(book) : book,
  );

  const migrationNotice: MigrationNotice | null = migrated
    ? legacyShelves.length > 0
      ? SHELF_TO_FOLDER_NOTICE
      : null
    : (snapshot.migrationNotice ?? null);

  return {
    books,
    folders,
    libraryVersion: LIBRARY_VERSION,
    migrationNotice,
    migrated,
  };
}

/** 新建/重命名共用的名称校验，返回 trim 后的名字。 */
export function assertFolderName(
  name: string,
  folders: Folder[],
  exceptId?: string,
): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("文件夹名称不能为空");
  if (trimmed.length > FOLDER_NAME_MAX_LENGTH) {
    throw new Error(`文件夹名称最多 ${FOLDER_NAME_MAX_LENGTH} 个字符`);
  }
  const duplicated = folders.some(
    (folder) =>
      folder.id !== exceptId &&
      folder.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicated) throw new Error(`已存在同名文件夹「${trimmed}」`);
  return trimmed;
}