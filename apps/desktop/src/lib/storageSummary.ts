import type { Book, ChatMessage } from "@/lib/types";
import type { StoredAnnotation } from "@/store/annotationStore";

export type StorageSummary = {
  bookCount: number;
  annotationCount: number;
  /** 含笔记内容的标注条数。 */
  noteCount: number;
  chatMessageCount: number;
  /** 有消息的会话数（空会话不算）。 */
  chatThreadCount: number;
};

type SummaryInput = {
  books: Pick<Book, "id">[];
  annotations: Record<string, StoredAnnotation[]>;
  messages: Record<string, ChatMessage[]>;
};

/** 数据组「存储概况」的只读统计：纯函数，随 store 变化即时重算。 */
export function summarizeStorage({
  books,
  annotations,
  messages,
}: SummaryInput): StorageSummary {
  let annotationCount = 0;
  let noteCount = 0;
  for (const list of Object.values(annotations)) {
    annotationCount += list.length;
    noteCount += list.filter((a) => Boolean(a.note?.trim())).length;
  }

  let chatMessageCount = 0;
  let chatThreadCount = 0;
  for (const list of Object.values(messages)) {
    if (list.length === 0) continue;
    chatThreadCount += 1;
    chatMessageCount += list.length;
  }

  return {
    bookCount: books.length,
    annotationCount,
    noteCount,
    chatMessageCount,
    chatThreadCount,
  };
}