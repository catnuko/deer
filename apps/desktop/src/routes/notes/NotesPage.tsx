import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { StickyNote, Trash2 } from "lucide-react";
import { formatTime } from "@/components/reader/AnnotationPanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AI_NOTE_LABEL, useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { aggregateNotesOf, type NoteEntry } from "./notesList";

/**
 * 跨书笔记列表（M5b）：聚合所有书的划线/笔记，点击跳到原文，
 * 列表内删除直接走 annotationStore，与阅读页的高亮回显天然联动。
 */
export function NotesPage() {
  const navigate = useNavigate();

  const books = useBookStore((state) => state.books);
  const booksReady = useBookStore((state) => state.ready);
  const loadBooks = useBookStore((state) => state.load);
  const annotations = useAnnotationStore((state) => state.annotations);
  const annotationsReady = useAnnotationStore((state) => state.ready);
  const loadAnnotations = useAnnotationStore((state) => state.load);
  const removeAnnotation = useAnnotationStore((state) => state.remove);

  useEffect(() => {
    void loadBooks();
    void loadAnnotations();
  }, [loadBooks, loadAnnotations]);

  const groups = useMemo(
    () =>
      booksReady && annotationsReady
        ? aggregateNotesOf(annotations, books)
        : [],
    [annotations, books, booksReady, annotationsReady],
  );

  function openNote(note: NoteEntry) {
    // AI 笔记没有 CFI，点击不跳原文。
    if (!note.cfi) return;
    navigate(
      `/reader?book=${encodeURIComponent(note.bookId)}&cfi=${encodeURIComponent(note.cfi)}`,
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="笔记"
        description="所有书里的划线、摘录与笔记都在这里。"
        onBack={() => navigate("/bookshelf")}
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {groups.length === 0 ? (
          <EmptyState />
        ) : (
          groups.map((group) => (
            <section key={group.bookId} className="mb-6 max-w-2xl">
              <h2 className="text-muted-foreground mb-2 text-sm font-medium">
                《{group.bookTitle}》
              </h2>
              <ul className="flex flex-col gap-1">
                {group.notes.map((note) => (
                  <li
                    key={note.id}
                    className="bg-background hover:bg-sidebar-accent group relative rounded-md"
                  >
                    {note.cfi ? (
                      <button
                        type="button"
                        aria-label={`跳到《${group.bookTitle}》中的这条笔记`}
                        onClick={() => openNote(note)}
                        className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left"
                      >
                        <NoteBody note={note} />
                      </button>
                    ) : (
                      // AI 笔记没有 CFI，点击不跳原文，整条不可点。
                      <div className="flex w-full items-start gap-2 px-2.5 py-2 text-left">
                        <NoteBody note={note} />
                      </div>
                    )}
                    {note.source === "ai" ? (
                      <Badge
                        variant="secondary"
                        className="absolute top-2 right-8 px-1.5 text-[10px] max-[819px]:right-12"
                      >
                        {AI_NOTE_LABEL}
                      </Badge>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`删除《${group.bookTitle}》中的这条笔记`}
                      className="absolute top-1.5 right-1 size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-[819px]:top-0 max-[819px]:right-0 max-[819px]:size-10 max-[819px]:opacity-100"
                      onClick={() => removeAnnotation(note.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** 笔记条目的内容区：色条 + 摘录/笔记 + 时间，跳转与否由外层的按钮/裸 div 决定。 */
function NoteBody({ note }: { note: NoteEntry }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="mt-0.5 h-4 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: note.color }}
      />
      <span className="min-w-0 flex-1">
        <span className="text-foreground line-clamp-2 block text-[13px] leading-snug">
          {note.excerpt || note.note || "（无文本摘录）"}
        </span>
        {note.note && note.excerpt ? (
          <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-snug">
            {note.note}
          </span>
        ) : null}
        <span className="text-muted-foreground mt-1 block text-[11px] tabular-nums">
          {formatTime(note.createdAt)}
        </span>
      </span>
    </>
  );
}

function EmptyState() {
  return (
    <div className="border-border text-muted-foreground flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
      <StickyNote className="text-muted-foreground/60 size-8" />
      <p className="text-sm">还没有任何笔记。</p>
      <p className="max-w-xs text-xs leading-relaxed">
        打开一本书，在正文里划一段就能创建高亮或笔记，它们会集中出现在这里。
      </p>
    </div>
  );
}
