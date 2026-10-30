import { ArrowLeft, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LineHeight } from "@/store/readingSettings";

type ReaderToolbarProps = {
  bookTitle: string;
  author: string;
  chapterIndex: number;
  chapterCount: number;
  fontSize: number;
  lineHeight: LineHeight;
  /** 提供时显示「总结本章」入口（章节总结 N3）。 */
  onSummarizeChapter?: () => void;
  /** 提供时显示「笔记」入口（笔记管理面板 M3）。 */
  onOpenNotes?: () => void;
  /** 提供时显示「显示设置」入口（阅读页快捷设置面板 M4）。 */
  onOpenQuickSettings?: () => void;
};

export function ReaderToolbar({
  bookTitle,
  author,
  chapterIndex,
  chapterCount,
  fontSize,
  lineHeight,
  onSummarizeChapter,
  onOpenNotes,
  onOpenQuickSettings,
}: ReaderToolbarProps) {
  return (
    <header className="border-border bg-background/95 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Button variant="ghost" size="sm" render={<Link to="/bookshelf" />}>
        <ArrowLeft className="size-4" />
        书架
      </Button>

      <div className="bg-border h-5 w-px" />

      <div className="flex min-w-0 items-center gap-2">
        <BookOpen className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate text-sm font-medium">{bookTitle}</span>
        <span className="text-muted-foreground hidden truncate text-xs sm:inline">
          {author}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Badge variant="secondary">
          第 {chapterIndex + 1} / {chapterCount} 章
        </Badge>
        <Badge variant="outline">
          字号 {fontSize} · 行距 {lineHeight.toFixed(1)}
        </Badge>
        {onOpenNotes ? (
          <Button variant="ghost" size="sm" onClick={onOpenNotes}>
            笔记
          </Button>
        ) : null}
        {onOpenQuickSettings ? (
          <Button variant="ghost" size="sm" onClick={onOpenQuickSettings}>
            显示设置
          </Button>
        ) : null}
        {onSummarizeChapter ? (
          <Button variant="ghost" size="sm" onClick={onSummarizeChapter}>
            总结本章
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" render={<Link to="/settings" />}>
          阅读设置
        </Button>
      </div>
    </header>
  );
}
