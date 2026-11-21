import { useAnnotationStore, type StoredAnnotation } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { isMessageStreaming, useChatStore } from "@/store/chatStore";
import type { Book, ChatMessage, ChatThread } from "@/lib/types";
import type {
  AnnotationSyncData,
  BookSyncData,
  MessageSyncData,
  ShelfSyncData,
  SyncKind,
  SyncRecord,
  ThreadSyncData,
} from "./types";

/**
 * 适配层：把三个 store 的本地状态映射成同步记录，并把远端记录写回 store。
 *
 * 变更追踪用「全量快照 + 指纹 diff」：引擎保存上一次快照的指纹，
 * 本次快照里指纹变了的 key 就是要推送的记录。好处是三个 store 都不必
 * 逐个改动去埋点，坏处是每次同步要遍历一遍全量数据（本地 JSON 量级下可接受）。
 */

export type LocalEntry = { kind: SyncKind; key: string; data: unknown };

export type SyncAdapter = {
  name: string;
  /** 全量本地快照（只含可同步字段；书籍无 contentHash 时跳过）。 */
  snapshot(): LocalEntry[];
  /** 应用一条远端记录；删除时 record.deleted === true。 */
  apply(record: SyncRecord): void;
};

/* ------------------------------------------------------------------ */
/* 指纹：字段顺序固定，保证同一状态两次序列化结果一致                      */
/* ------------------------------------------------------------------ */

export function fingerprintOf(data: unknown): string {
  return JSON.stringify(data ?? null);
}

function bookIdToHash(books: Book[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const book of books) {
    if (book.contentHash) map.set(book.id, book.contentHash);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* 书库：书籍、书架、书架归属                                             */
/* ------------------------------------------------------------------ */

function bookPayload(book: Book): BookSyncData {
  const payload: BookSyncData = {
    contentHash: book.contentHash ?? "",
    title: book.title,
    author: book.author,
    format: book.format,
    sizeBytes: book.sizeBytes,
    tags: [...book.tags],
    addedAt: book.addedAt,
    progress: book.progress,
  };
  if (book.lastOpenedAt !== undefined) payload.lastOpenedAt = book.lastOpenedAt;
  if (book.lastLocationCfi) payload.lastLocationCfi = book.lastLocationCfi;
  return payload;
}

export const bookAdapter: SyncAdapter = {
  name: "library",

  snapshot() {
    const { books, shelves } = useBookStore.getState();
    const entries: LocalEntry[] = [];

    for (const book of books) {
      if (!book.contentHash) continue;
      entries.push({
        kind: "book",
        key: `bk:${book.contentHash}`,
        data: bookPayload(book),
      });
      for (const shelfId of book.shelfIds ?? []) {
        entries.push({
          kind: "bookShelf",
          key: `bs:${book.contentHash}:${shelfId}`,
          data: { bookHash: book.contentHash, shelfId },
        });
      }
    }

    for (const shelf of shelves) {
      entries.push({
        kind: "shelf",
        key: `sh:${shelf.id}`,
        data: { name: shelf.name, order: shelf.order } satisfies ShelfSyncData,
      });
    }

    return entries;
  },

  apply(record) {
    const store = useBookStore.getState();
    switch (record.kind) {
      case "book":
        store.applyRemoteBook(
          record.key.slice(3),
          record.deleted ? null : (record.data as BookSyncData),
        );
        return;
      case "shelf":
        store.applyRemoteShelf(
          record.key.slice(3),
          record.deleted ? null : (record.data as ShelfSyncData),
        );
        return;
      case "bookShelf": {
        const [, bookHash, shelfId] = record.key.split(":");
        if (bookHash && shelfId) {
          store.applyRemoteShelfMembership(bookHash, shelfId, !record.deleted);
        }
        return;
      }
      default:
        return;
    }
  },
};

/* ------------------------------------------------------------------ */
/* 高亮与笔记                                                           */
/* ------------------------------------------------------------------ */

function annotationPayload(
  annotation: StoredAnnotation,
  bookHash: string,
): AnnotationSyncData {
  const payload: AnnotationSyncData = {
    bookHash,
    color: annotation.color,
    createdAt: annotation.createdAt,
  };
  if (annotation.cfi) payload.cfi = annotation.cfi;
  if (annotation.style) payload.style = annotation.style;
  if (annotation.excerpt) payload.excerpt = annotation.excerpt;
  if (annotation.note) payload.note = annotation.note;
  if (annotation.source) payload.source = annotation.source;
  return payload;
}

export const annotationAdapter: SyncAdapter = {
  name: "annotations",

  snapshot() {
    const hashes = bookIdToHash(useBookStore.getState().books);
    const entries: LocalEntry[] = [];
    for (const [bookId, list] of Object.entries(
      useAnnotationStore.getState().annotations,
    )) {
      const bookHash = hashes.get(bookId);
      if (!bookHash) continue;
      for (const annotation of list) {
        entries.push({
          kind: "annotation",
          key: `an:${annotation.id}`,
          data: annotationPayload(annotation, bookHash),
        });
      }
    }
    return entries;
  },

  apply(record) {
    const store = useAnnotationStore.getState();
    const annotationId = record.key.slice(3);

    if (record.deleted) {
      const bookId = findBookIdByAnnotation(annotationId);
      if (bookId) store.applyRemoteAnnotation(bookId, annotationId, null);
      return;
    }

    const data = record.data as AnnotationSyncData;
    const bookId = useBookStore
      .getState()
      .books.find((book) => book.contentHash === data.bookHash)?.id;
    if (!bookId) return; // 书还没到位：等下一次同步（书籍记录先于笔记应用）。

    const annotation: StoredAnnotation = {
      id: annotationId,
      color: data.color,
      createdAt: data.createdAt,
    };
    if (data.cfi) annotation.cfi = data.cfi;
    if (data.style) annotation.style = data.style as StoredAnnotation["style"];
    if (data.excerpt) annotation.excerpt = data.excerpt;
    if (data.note) annotation.note = data.note;
    if (data.source) annotation.source = data.source;

    store.applyRemoteAnnotation(bookId, annotationId, annotation);
  },
};

function findBookIdByAnnotation(annotationId: string): string | undefined {
  const { annotations } = useAnnotationStore.getState();
  for (const [bookId, list] of Object.entries(annotations)) {
    if (list.some((annotation) => annotation.id === annotationId)) return bookId;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* 聊天：会话与消息（只同步最终态消息）                                    */
/* ------------------------------------------------------------------ */

function threadPayload(thread: ChatThread, bookHash: string): ThreadSyncData {
  return {
    bookHash,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function messagePayload(
  message: ChatMessage,
  threadId: string,
): MessageSyncData {
  const payload: MessageSyncData = {
    threadKey: `th:${threadId}`,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
  if (message.thinking) payload.thinking = message.thinking;
  if (message.books?.length) payload.books = message.books;
  return payload;
}

export const chatAdapter: SyncAdapter = {
  name: "chat",

  snapshot() {
    const hashes = bookIdToHash(useBookStore.getState().books);
    const { threads, messages } = useChatStore.getState();
    const entries: LocalEntry[] = [];

    for (const [bookId, list] of Object.entries(threads)) {
      const bookHash = hashes.get(bookId);
      if (!bookHash) continue;
      for (const thread of list) {
        entries.push({
          kind: "chatThread",
          key: `th:${thread.id}`,
          data: threadPayload(thread, bookHash),
        });
      }
    }

    for (const [threadId, list] of Object.entries(messages)) {
      for (const message of list) {
        // 流式过程中不入同步：对方不该看到半截回复。
        if (isMessageStreaming(message.id)) continue;
        if (!message.content.trim()) continue;
        entries.push({
          kind: "chatMessage",
          key: `ms:${message.id}`,
          data: messagePayload(message, threadId),
        });
      }
    }

    return entries;
  },

  apply(record) {
    const store = useChatStore.getState();
    const id = record.key.slice(3);

    if (record.kind === "chatThread") {
      if (record.deleted) {
        // 删除要按 id 找到它挂在哪个书下。
        const owner = Object.entries(useChatStore.getState().threads).find(
          ([, list]) => list.some((thread) => thread.id === id),
        )?.[0];
        if (owner) store.applyRemoteThread(owner, id, null);
        return;
      }
      const data = record.data as ThreadSyncData;
      const bookId = useBookStore
        .getState()
        .books.find((book) => book.contentHash === data.bookHash)?.id;
      if (!bookId) return;
      store.applyRemoteThread(bookId, id, {
        id,
        bookId,
        title: data.title,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
      return;
    }

    if (record.kind === "chatMessage") {
      if (record.deleted) {
        store.applyRemoteMessage(id, undefined, null);
        return;
      }
      const data = record.data as MessageSyncData;
      const threadId = data.threadKey.slice(3);
      const message: ChatMessage = {
        id,
        role: data.role,
        content: data.content,
        createdAt: data.createdAt,
      };
      if (data.thinking) message.thinking = data.thinking;
      if (data.books?.length) message.books = data.books;
      store.applyRemoteMessage(id, threadId, message);
    }
  },
};

export const syncAdapters: SyncAdapter[] = [
  bookAdapter,
  annotationAdapter,
  chatAdapter,
];