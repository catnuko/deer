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
  lastLocationCfi?: string; // 上次读到的位置，打开书时恢复
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

/** 聊天书卡：MCP 书架工具结果里抽出的书籍引用，点击打开阅读。 */
export type ChatBookRef = {
  id: string;
  title: string;
  author: string;
  format: string;
  progress: number; // 0..1
  coverPath?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 深度思考的过程文本（开启深度思考的回复才有），折叠展示。 */
  thinking?: string;
  /** 本条回复里模型经书架 MCP 工具返回的书单，渲染成可点击书卡。 */
  books?: ChatBookRef[];
  createdAt: number;
};

export type ChatThread = {
  id: string;
  bookId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};
