import { useEffect, useState } from "react";
import { Check, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MinimalCard } from "@/components/ui/minimal-card";
import { getCoverUrl } from "@/lib/covers";
import { formatBytes, formatDate } from "@/lib/format";
import type { Book, Shelf } from "@/lib/types";

type BookCardProps = {
  book: Book;
  shelves: Shelf[];
  onOpen(book: Book): void;
  onToggleShelf(book: Book, shelf: Shelf): void;
  onDelete(book: Book): void;
  actionsDisabled?: boolean;
};

export function BookCard({
  book,
  shelves,
  onOpen,
  onToggleShelf,
  onDelete,
  actionsDisabled = false,
}: BookCardProps) {
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

  const progressPercent = Math.round(Math.min(Math.max(book.progress, 0), 1) * 100);

  return (
    <MinimalCard className="group/card flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={() => onOpen(book)}
        className="focus-visible:ring-ring relative block aspect-[2/3] w-full overflow-hidden rounded-[16px] focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`阅读《${book.title}》`}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`《${book.title}》封面`}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="from-secondary to-muted absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br p-4 text-center">
            <span className="text-primary/80 text-3xl font-semibold">
              {book.title.slice(0, 1)}
            </span>
            <span className="text-muted-foreground line-clamp-3 text-xs leading-relaxed">
              {book.title}
            </span>
          </div>
        )}
        {progressPercent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10">
            <div
              className="bg-primary h-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </button>

      <div className="flex min-w-0 items-start gap-1 px-1">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold">
            {book.title}
          </h3>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {book.author}
          </p>
          <p className="text-muted-foreground/80 mt-1 text-[11px]">
            {formatBytes(book.sizeBytes)} · {formatDate(book.addedAt)}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`《${book.title}》更多操作`}
                disabled={actionsDisabled}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onOpen(book)}>
              阅读
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>书架</DropdownMenuLabel>
              {shelves.length === 0 && (
                <DropdownMenuItem disabled>还没有书架</DropdownMenuItem>
              )}
              {shelves.map((shelf) => {
                const inShelf = book.shelfIds.includes(shelf.id);
                return (
                  <DropdownMenuItem
                    key={shelf.id}
                    onClick={() => onToggleShelf(book, shelf)}
                  >
                    <span className="flex-1 truncate">{shelf.name}</span>
                    {inShelf && <Check className="text-primary" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(book)}
            >
              <Trash2 />
              删除书籍
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </MinimalCard>
  );
}
