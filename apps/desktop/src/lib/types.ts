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
  /** 所属文件夹；缺省 = 未分类。一本书只属于一个文件夹。 */
  folderId?: string;
  tags: string[];
};

/** 书库唯一书架下的一层分类。 */
export type Folder = { id: string; name: string; order: number };

/** 旧版多书架模型的残留字段，只在迁移时读入。 */
export type LegacyShelf = { id: string; name: string; order: number };

export type LibraryVersion = 2;

/** 迁移后的一次性提示标记，书架页首次进入显示横幅。 */
export type MigrationNotice = "shelf-to-folder";

export type BookStoreState = {
  books: Book[];
  folders: Folder[];
  libraryVersion: number;
  migrationNotice: MigrationNotice | null;
  ready: boolean; // 是否已从磁盘加载完成
  load(): Promise<void>;
  importEpub(filePath: string): Promise<Book>; // 泳道 A 实现
  removeBook(id: string): Promise<void>; // 泳道 A 实现
  updateBook(id: string, patch: Partial<Book>): Promise<void>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  /** folderId 为 null 表示移回「未分类」。 */
  moveBookToFolder(bookId: string, folderId: string | null): Promise<void>;
  dismissMigrationNotice(): Promise<void>;
};

/** 聊天书卡：MCP 书架工具结果里抽出的书籍引用，点击打开阅读。 */
export type ChatBookRef = {
  id: string;
  title: string;
  author: string;
  format: string;
  progress: number; // 0..1
  coverPath?: string;
  /** get_library 结果里附带的文件夹名，未分类时缺省。 */
  folderName?: string;
};

/** 词典卡单条释义（lookup_dictionary 从 dictionaryapi.dev 解析出的结果）。 */
export type DictionarySense = {
  /** 词性原文（noun/verb/... 英文原样，不本地化）。 */
  partOfSpeech?: string;
  definition: string;
  example?: string;
};

/** 聊天词典卡：found:false（查无词条/网络失败）不走卡片链路，模型正文自答。 */
export type ChatDictionaryEntry = {
  word: string;
  /** IPA 音标，如 /ɪˈfem.ər.əl/，缺省不渲染。 */
  phonetic?: string;
  found: true;
  /** 工具侧截断 ≤6 条，控制上下文体积与卡片高度。 */
  senses: DictionarySense[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 深度思考的过程文本（开启深度思考的回复才有），折叠展示。 */
  thinking?: string;
  /** 本条回复里模型经书架 MCP 工具返回的书单，渲染成可点击书卡。 */
  books?: ChatBookRef[];
  /** 本条回复里模型经词典工具返回的词条（每条回复最多一词一卡，后到覆盖先到）。 */
  dictionary?: ChatDictionaryEntry;
  createdAt: number;
};

export type ChatThread = {
  id: string;
  bookId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};
