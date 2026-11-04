import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  TOC_MAX_WIDTH,
  TOC_MIN_WIDTH,
  TOC_WIDTH_STEP,
  useReaderLayout,
} from "@/store/readerLayout";

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
  /** dock：左栏固定宽（可拖拽调宽）；sheet：塞进小窗浮层，撑满容器。 */
  variant?: "dock" | "sheet";
};

type DragState = { startX: number; startWidth: number };

export function ReaderToc({
  chapters,
  currentIndex,
  onSelect,
  className,
  variant = "dock",
}: ReaderTocProps) {
  const dock = variant === "dock";
  const tocWidth = useReaderLayout((state) => state.tocWidth);
  const setTocWidth = useReaderLayout((state) => state.setTocWidth);
  const resetTocWidth = useReaderLayout((state) => state.resetTocWidth);
  const dragRef = useRef<DragState | null>(null);
  const [resizing, setResizing] = useState(false);

  // 拖拽期间锁住光标与选中，避免划过正文时选到文字。
  useEffect(() => {
    if (!resizing) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [resizing]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: tocWidth };
    setResizing(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setTocWidth(drag.startWidth + (event.clientX - drag.startX));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? TOC_WIDTH_STEP * 3 : TOC_WIDTH_STEP;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setTocWidth(tocWidth - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setTocWidth(tocWidth + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setTocWidth(TOC_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setTocWidth(TOC_MAX_WIDTH);
    }
  };

  return (
    <aside
      className={cn(
        "border-border bg-sidebar flex shrink-0",
        // dock 开合布局瞬时（宽度直接赋值），只有目录内容淡入（motion.md M11）。
        dock ? "border-r deer-content-fade" : "h-full w-full",
        className,
      )}
      style={dock ? { width: tocWidth } : undefined}
    >
      <div className="flex min-w-0 flex-1 flex-col">
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
      </div>
      {dock ? (
        <div
          role="separator"
          aria-label="调整目录宽度"
          aria-orientation="vertical"
          aria-valuemin={TOC_MIN_WIDTH}
          aria-valuemax={TOC_MAX_WIDTH}
          aria-valuenow={tocWidth}
          aria-valuetext={`${tocWidth} 像素`}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetTocWidth}
          onKeyDown={handleKeyDown}
          className={cn(
            // 独立的一条窄带，不压住 ScrollArea 的滚动条
            "relative w-2 shrink-0 cursor-col-resize touch-none outline-none",
            "after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:transition-colors after:duration-fast after:ease-enter",
            // 拖拽期间颜色也必须立即跟手，不给过渡（motion.md M11）。
            resizing
              ? "after:bg-primary/70 after:transition-none"
              : "after:bg-transparent hover:after:bg-primary/40 focus-visible:after:bg-primary/70",
          )}
        />
      ) : null}
    </aside>
  );
}
