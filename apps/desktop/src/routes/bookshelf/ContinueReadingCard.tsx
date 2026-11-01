import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { MinimalCard } from "@/components/ui/minimal-card";
import { getCoverUrl } from "@/lib/covers";
import type { Book } from "@/lib/types";

/** 书架顶部的「继续阅读」卡片（M5a）：一键回到上次读到的位置。 */
export function ContinueReadingCard({
  book,
  onContinue,
}: {
  book: Book;
  onContinue(book: Book): void;
}) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCoverUrl(book).then((url) => {
      if (active) setCoverUrl(url);
    });
    return () => {
      active = false;
    };
  }, [book]);

  const percent = Math.round(
    Math.min(Math.max(book.progress, 0), 1) * 100,
  );

  return (
    <MinimalCard className="flex items-center gap-4 p-4">
      <div className="border-border relative aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-md border">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`《${book.title}》封面`}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="from-secondary to-muted absolute inset-0 flex items-center justify-center">
            <span className="text-primary/80 text-lg font-semibold">
              {book.title.slice(0, 1)}
            </span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <BookOpen className="size-3.5" />
          继续阅读
        </p>
        <h3 className="mt-0.5 truncate text-sm font-semibold">{book.title}</h3>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          {book.author}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div
            className="bg-muted h-1 w-40 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`《${book.title}》阅读进度`}
          >
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {percent}%
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onContinue(book)}
        aria-label={`继续阅读《${book.title}》`}
        className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        继续阅读
      </button>
    </MinimalCard>
  );
}
