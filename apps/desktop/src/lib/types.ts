/** foliate-js 支持的电子书格式。 */
export type BookFormat = "epub" | "mobi" | "azw3" | "fb2" | "cbz" | "pdf";

export type Book = {
  id: string; // 稳定 id（文件哈希或 nanoid，落地时定）
  title: string;
  author: string;
  format: BookFormat;
  filePath: string; // 导入后复制到 appDataDir/books 的路径
  coverPath?: string; // 复制到 appDataDir/covers 的路径
  sizeBytes: number;
  addedAt: number; // epoch ms
  lastOpenedAt?: number;
  progress: number; // 0..1
  shelfIds: string[];
  tags: string[];
};

export type Shelf = { id: string; name: string; order: number };

export type BookStoreState = {
  books: Book[];
  shelves: Shelf[];
  ready: boolean; // 是否已从磁盘加载完成
  load(): Promise<void>;
  importEpub(filePath: string): Promise<Book>; // 泳道 A 实现
  removeBook(id: string): Promise<void>; // 泳道 A 实现
  updateBook(id: string, patch: Partial<Book>): Promise<void>;
  createShelf(name: string): Promise<Shelf>;
  deleteShelf(id: string): Promise<void>;
  moveBookToShelf(bookId: string, shelfId: string): Promise<void>;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type ChatThread = {
  id: string;
  bookId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};
