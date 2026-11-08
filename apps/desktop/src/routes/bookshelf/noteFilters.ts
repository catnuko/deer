import type { StoredAnnotation } from "@/store/annotationStore";

/** 笔记筛选（详情页设计稿 v2）：全部 / 划线与笔记 / AI 笔记。 */
export type NoteFilter = "all" | "hl" | "ai";

export function filterNotes(
  notes: StoredAnnotation[],
  filter: NoteFilter,
): StoredAnnotation[] {
  if (filter === "ai") return notes.filter((note) => note.source === "ai");
  if (filter === "hl") return notes.filter((note) => note.source !== "ai");
  return notes;
}

export const NOTE_FILTER_LABELS: Record<NoteFilter, string> = {
  all: "全部",
  hl: "划线与笔记",
  ai: "AI 笔记",
};
