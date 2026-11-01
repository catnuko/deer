import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { getCoverUrl } from "@/lib/covers";
import type { ChatBookRef } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 聊天里的推荐书卡：模型经书架 MCP 工具返回的书单渲染成卡片，
 * 点击复用现有开书通路（/reader?book=<id>）直接进入阅读。
 */
export function ChatBookCard({ book }: { book: ChatBookRef }) {
  const navigate = useNavigate();
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

  const progressPercent = Math.round(
    Math.min(Math.max(book.progress, 0), 1) * 100,
  );

  return (
    <button
      type="button"
      data-testid="chat-book-card"
      aria-label={`打开《${book.title}》继续阅读`}
      onClick={() => navigate(`/reader?book=${encodeURIComponent(book.id)}`)}
      className={cn(
        "border-border bg-card hover:border-ring/60 hover:bg-accent/50",
        "flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors",
      )}
    >
      <div className="relative aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md bg-secondary">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`《${book.title}》封面`}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="text-primary/70 absolute inset-0 flex items-center justify-center">
            <BookOpen className="size-5" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug font-medium">
          {book.title}
        </p>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          {book.author}
        </p>
        {progressPercent > 0 && (
          <div className="bg-secondary mt-1.5 h-1 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
        <p className="text-muted-foreground/70 mt-1 text-[11px]">
          {progressPercent > 0
            ? `已读 ${progressPercent}% · 点击继续阅读`
            : "点击开始阅读"}
        </p>
      </div>
    </button>
  );
}
