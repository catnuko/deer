import type { Book } from "@/lib/types";
import type { StoredAnnotation } from "@/store/annotationStore";

/** 跨书笔记列表（M5b）的聚合逻辑：纯函数，方便表驱动测试。 */

export type NoteEntry = StoredAnnotation & { bookId: string };

export type NotesGroup = {
  bookId: string;
  bookTitle: string;
  /** 该书的注解，保持 store 的新在前。 */
  notes: NoteEntry[];
};

/**
 * 按书聚合全部注解：只收书库里还存在的书（删掉的书不出现孤儿条目），
 * 组按最新一条笔记的时间倒排，最近在读的书排前面。
 */
export function aggregateNotesOf(
  annotations: Record<string, StoredAnnotation[]>,
  books: Book[],
): NotesGroup[] {
  const groups: NotesGroup[] = [];
  for (const book of books) {
    // 注解库整体缺失/损坏时按空库处理，页面还能渲染空态。
    const notes = (annotations?.[book.id] ?? []).map((note) => ({
      ...note,
      bookId: book.id,
    }));
    if (notes.length > 0) {
      groups.push({ bookId: book.id, bookTitle: book.title, notes });
    }
  }
  return groups.sort(
    (a, b) => (b.notes[0]?.createdAt ?? 0) - (a.notes[0]?.createdAt ?? 0),
  );
}
