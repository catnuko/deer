import { List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** 目录条目最小形状：演示书章节与真实 EPUB 目录都能满足。 */
export type ReaderTocEntry = {
  index: number;
  title: string;
};

type ReaderTocProps = {
  chapters: ReaderTocEntry[];
  currentIndex: number;
  onSelect: (index: number) => void;
  className?: string;
};

/**
 * 目录列表：目录不再常驻左栏，本组件只负责「容器填满、列表滚动」的
 * 内容形态，落位（宽窗浮层 / 窄窗 Sheet）由使用方包壳。
 */
export function ReaderToc({
  chapters,
  currentIndex,
  onSelect,
  className,
}: ReaderTocProps) {
  return (
    <aside className={cn("bg-sidebar flex h-full w-full shrink-0 flex-col", className)}>
      <div className="text-muted-foreground flex h-10 items-center gap-2 px-4 text-xs font-medium">
        <List className="size-3.5" />
        目录
      </div>
      {chapters.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-6 text-center text-xs">
          本书没有目录
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex min-w-0 flex-col gap-0.5 pr-4 pb-4 pl-2">
            {chapters.map((chapter) => {
              const active = chapter.index === currentIndex;
              return (
                <Button
                  key={chapter.index}
                  variant="ghost"
                  size="sm"
                  aria-current={active ? "page" : undefined}
                  title={chapter.title}
                  onClick={() => onSelect(chapter.index)}
                  className={cn(
                    // 基础按钮类带 whitespace-nowrap，且在 CSS 里排在 whitespace-normal 之后，
                    // 必须用 important 后缀才能真正允许折行。
                    "h-auto w-full min-w-0 justify-start px-2.5 py-2 text-left text-[13px] leading-snug font-normal whitespace-normal!",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  <span className="line-clamp-2 w-full min-w-0 break-words">
                    {chapter.title}
                  </span>
                </Button>
              );
            })}
          </nav>
        </ScrollArea>
      )}
    </aside>
  );
}
