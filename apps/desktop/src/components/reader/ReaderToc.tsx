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

export function ReaderToc({
  chapters,
  currentIndex,
  onSelect,
  className,
}: ReaderTocProps) {
  return (
    <aside
      className={cn(
        "border-border bg-sidebar flex w-56 shrink-0 flex-col border-r",
        className,
      )}
    >
      <div className="text-muted-foreground flex h-10 items-center gap-2 px-4 text-xs font-medium">
        <List className="size-3.5" />
        目录
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-0.5 px-2 pb-4">
          {chapters.map((chapter) => {
            const active = chapter.index === currentIndex;
            return (
              <Button
                key={chapter.index}
                variant="ghost"
                size="sm"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(chapter.index)}
                className={cn(
                  "h-auto justify-start px-2.5 py-2 text-left text-[13px] leading-snug font-normal",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {chapter.title}
              </Button>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
