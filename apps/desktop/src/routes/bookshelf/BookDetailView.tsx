import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Highlighter,
  MessageSquare,
  NotebookText,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatBytes } from "@/lib/format";
import { getCoverUrl } from "@/lib/covers";
import type { Book } from "@/lib/types";
import {
  useAnnotationStore,
  type StoredAnnotation,
} from "@/store/annotationStore";
import { NOTE_FILTER_LABELS, filterNotes, type NoteFilter } from "./noteFilters";
import { cn } from "@/lib/utils";

const EMPTY_NOTES: StoredAnnotation[] = [];

type BookDetailViewProps = {
  book: Book;
  /** page：整页覆盖层（Esc 返回、进入即聚焦返回键）；sheet：小屏底部浮层。 */
  variant: "page" | "sheet";
  onBack(): void;
  onContinueRead(): void;
  /** 「在书中查看」：带 CFI 跳回阅读页原文位置。 */
  onLocate(cfi: string): void;
  /** 从书架移除；二次确认弹窗由书架页负责。 */
  onRemove(): void;
};

export function BookDetailView({
  book,
  variant,
  onBack,
  onContinueRead,
  onLocate,
  onRemove,
}: BookDetailViewProps) {
  const annotations = useAnnotationStore(
    (state) => state.annotations[book.id] ?? EMPTY_NOTES,
  );
  const notesReady = useAnnotationStore((state) => state.ready);
  const loadAnnotations = useAnnotationStore((state) => state.load);
  const backRef = useRef<HTMLButtonElement>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<NoteFilter>("all");

  useEffect(() => {
    void loadAnnotations();
  }, [loadAnnotations]);

  useEffect(() => {
    let active = true;
    void getCoverUrl(book).then((url) => {
      if (active) setCoverUrl(url);
    });
    return () => {
      active = false;
    };
  }, [book]);

  // 整页形态：进入即把焦点交给「返回书架」，Esc 等效返回（焦点归还由书架页负责）。
  useEffect(() => {
    if (variant !== "page") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    const raf = requestAnimationFrame(() => backRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(raf);
    };
  }, [onBack, variant]);

  const counts: Record<NoteFilter, number> = {
    all: annotations.length,
    hl: filterNotes(annotations, "hl").length,
    ai: filterNotes(annotations, "ai").length,
  };
  const visibleNotes = filterNotes(annotations, filter);
  const progressPercent = Math.round(
    Math.min(Math.max(book.progress, 0), 1) * 100,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="书籍详情页">
      <div className="border-border bg-background flex shrink-0 items-center gap-3.5 border-b px-7 py-3.5">
        <Button
          ref={backRef}
          variant="ghost"
          size="sm"
          className="w-auto"
          onClick={onBack}
        >
          <ArrowLeft />
          返回书架
        </Button>
        <div className="bg-border h-[22px] w-px" />
        <BookOpen className="text-muted-foreground size-[18px] shrink-0" />
        <div className="min-w-0 flex-1 truncate text-base font-bold">
          {book.title}
        </div>
        <span className="text-muted-foreground/60 hidden shrink-0 text-[13px] sm:block">
          {book.author}
        </span>
        <Button
          variant="default"
          className="w-auto rounded-full px-5"
          onClick={onContinueRead}
        >
          继续阅读
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto grid w-full max-w-[1000px] items-start gap-10 px-6 py-10",
            variant === "page" && "grid-cols-[264px_1fr] gap-14 px-14",
          )}
        >
          <aside className={variant === "page" ? "sticky top-0" : undefined}>
            <div className="bg-muted relative mx-auto aspect-[232/326] w-[232px] max-w-full overflow-hidden rounded-xl shadow-[0_6px_24px_rgba(23,23,23,0.14)]">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={`《${book.title}》封面`}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <span className="text-4xl font-semibold">
                    {book.title.slice(0, 1)}
                  </span>
                  <span className="line-clamp-3 text-xs leading-relaxed">
                    {book.title}
                  </span>
                </div>
              )}
            </div>

            <Button
              variant="default"
              className="mt-5 w-full rounded-full"
              onClick={onContinueRead}
            >
              <BookOpen className="size-4" />
              继续阅读
            </Button>
            <Button
              variant="outline"
              className="mt-2.5 w-full rounded-full"
              onClick={onRemove}
            >
              <Trash2 className="size-4" />
              从书架移除
            </Button>

            <div className="mt-5">
              <div className="bg-border h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                已读 {progressPercent}%
                {book.lastOpenedAt ? ` · 上次阅读 ${formatDate(book.lastOpenedAt)}` : ""}
              </p>
            </div>

            <dl className="border-border mt-6 border-t text-[13px]">
              <div className="border-border flex items-center justify-between border-b py-2.5">
                <dt className="text-muted-foreground">格式</dt>
                <dd className="font-medium">{book.format.toUpperCase()}</dd>
              </div>
              <div className="border-border flex items-center justify-between border-b py-2.5">
                <dt className="text-muted-foreground">文件大小</dt>
                <dd className="font-medium">{formatBytes(book.sizeBytes)}</dd>
              </div>
              <div className="border-border flex items-center justify-between border-b py-2.5">
                <dt className="text-muted-foreground">加入书架</dt>
                <dd className="font-medium">{formatDate(book.addedAt)}</dd>
              </div>
            </dl>
          </aside>

          <div className="min-w-0">
            <h1 className="line-clamp-2 text-2xl leading-[1.4] font-bold">
              {book.title}
            </h1>
            <p className="text-muted-foreground mt-1.5 text-sm">{book.author}</p>

            <div className="mt-10 mb-4 flex items-center justify-between gap-3">
              <h2 className="shrink-0 text-[13px] font-bold">
                笔记与摘录（{annotations.length}）
              </h2>
              <div
                className="bg-muted flex gap-0.5 rounded-[10px] p-0.75"
                role="tablist"
                aria-label="笔记筛选"
              >
                {(Object.keys(NOTE_FILTER_LABELS) as NoteFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      "rounded-[7px] px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors duration-fast ease-enter",
                      filter === key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {NOTE_FILTER_LABELS[key]} {counts[key]}
                  </button>
                ))}
              </div>
            </div>

            {!notesReady ? (
              <div role="status" aria-label="笔记加载中" className="flex flex-col gap-2.5">
                <Skeleton className="h-3.5 w-[38%]" />
                <Skeleton className="h-3.5" />
                <Skeleton className="h-3.5 w-[86%]" />
                <Skeleton className="h-3.5 w-[64%]" />
              </div>
            ) : visibleNotes.length === 0 ? (
              annotations.length === 0 ? (
                <div className="border-border-strong text-muted-foreground flex flex-col items-center gap-2 rounded-2xl border border-dashed px-5 py-8 text-center">
                  <NotebookText className="text-muted-foreground/60 size-7" />
                  <p className="text-foreground text-sm">还没有笔记</p>
                  <p className="text-xs leading-relaxed">
                    去阅读页划选一段文字，或问 AI 一个问题试试
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground py-10 text-center text-sm">
                  这个分类下还没有笔记。
                </p>
              )
            ) : (
              <ul className="flex flex-col gap-3.5">
                {visibleNotes.map((note) =>
                  note.source === "ai" ? (
                    <AiNoteCard key={note.id} note={note} />
                  ) : (
                    <HighlightNoteCard
                      key={note.id}
                      note={note}
                      onLocate={onLocate}
                    />
                  ),
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A · 划线笔记：摘录块 + 我的笔记，有 CFI 才渲染「在书中查看」。 */
function HighlightNoteCard({
  note,
  onLocate,
}: {
  note: StoredAnnotation;
  onLocate(cfi: string): void;
}) {
  return (
    <li className="group border-border bg-background hover:border-muted-foreground/30 rounded-2xl border px-5 py-[18px] transition-colors duration-fast ease-enter">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <Highlighter className="size-3" />
          {note.note ? "划线 · 笔记" : "划线"}
        </span>
        <span className="text-muted-foreground/60 ml-auto text-xs">
          {formatDate(note.createdAt)}
        </span>
      </div>
      {note.excerpt ? (
        <figure className="bg-muted rounded-[10px] border-l-[3px] border-l-primary py-[13px] pr-4 pl-4">
          <blockquote className="font-serif text-[14.5px] leading-[1.85]">
            {note.excerpt}
          </blockquote>
          {note.cfi ? (
            <figcaption className="mt-2 flex justify-end text-xs">
              <button
                type="button"
                className="text-[#2563EB] underline underline-offset-2 opacity-0 transition-opacity duration-fast ease-enter group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => onLocate(note.cfi!)}
              >
                在书中查看 ↗
              </button>
            </figcaption>
          ) : null}
        </figure>
      ) : null}
      {note.note ? (
        <p className="mt-3 text-sm leading-[1.75]">
          <span className="text-muted-foreground mb-0.5 block text-xs">
            我的笔记
          </span>
          {note.note}
        </p>
      ) : null}
    </li>
  );
}

/** B · AI 笔记：提问片段 + AI 总结，无 CFI，不渲染原文跳转。 */
function AiNoteCard({ note }: { note: StoredAnnotation }) {
  return (
    <li className="group border-border bg-background hover:border-muted-foreground/30 rounded-2xl border px-5 py-[18px] transition-colors duration-fast ease-enter">
      <div className="mb-3 flex items-center gap-2">
        <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold">
          <Sparkles className="size-2.5" />
          AI 总结
        </span>
        <span className="text-muted-foreground/60 ml-auto text-xs">
          {formatDate(note.createdAt)}
        </span>
      </div>
      {note.excerpt ? (
        <div className="bg-muted/50 border-border rounded-[10px] border p-3">
          <div className="text-muted-foreground mb-1 text-[11.5px] font-semibold">
            我问过 AI
          </div>
          <p className="text-muted-foreground text-[13.5px] leading-[1.7]">
            {note.excerpt}
          </p>
        </div>
      ) : null}
      {note.note ? (
        <p className="mt-3 text-sm leading-[1.75]">
          <span className="text-muted-foreground mb-0.5 block text-xs">
            AI 总结的笔记
          </span>
          {note.note}
        </p>
      ) : null}
      <div className="border-border text-muted-foreground mt-3 flex items-center gap-1.5 border-t border-dashed pt-2.5 text-xs">
        <MessageSquare className="size-3" />
        来自 AI 伴读对话
      </div>
    </li>
  );
}
