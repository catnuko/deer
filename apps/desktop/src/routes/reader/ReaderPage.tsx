import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AiPanelSlot } from "@/components/reader/AiPanelSlot";
import { ReaderArticle } from "@/components/reader/ReaderArticle";
import { ReaderToc } from "@/components/reader/ReaderToc";
import { ReaderToolbar } from "@/components/reader/ReaderToolbar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useReadingSettings } from "@/store/readingSettings";
import { getDemoBook } from "@/routes/reader/demoBook";

const VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]';

export function ReaderPage() {
  const [searchParams] = useSearchParams();
  const book = getDemoBook(searchParams.get("book"));

  const fontSize = useReadingSettings((state) => state.fontSize);
  const lineHeight = useReadingSettings((state) => state.lineHeight);

  const [chapterIndex, setChapterIndex] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const scrollHostRef = useRef<HTMLDivElement>(null);

  const chapter = book.chapters[chapterIndex] ?? book.chapters[0];
  const chapterCount = book.chapters.length;

  // 换章回到开头：新正文从头读，进度条归零（状态在切换时同步重置，避免 effect 里 setState）。
  const selectChapter = (index: number) => {
    setChapterIndex(index);
    setScrollProgress(0);
  };

  useEffect(() => {
    const viewport = scrollHostRef.current?.querySelector<HTMLElement>(
      VIEWPORT_SELECTOR,
    );
    if (viewport) viewport.scrollTop = 0;
  }, [chapterIndex]);

  // 滚动进度：scrollTop / (scrollHeight - clientHeight)。
  useEffect(() => {
    const viewport = scrollHostRef.current?.querySelector<HTMLElement>(
      VIEWPORT_SELECTOR,
    );
    if (!viewport) return;

    const onScroll = () => {
      const scrollable = viewport.scrollHeight - viewport.clientHeight;
      const next = scrollable > 0 ? viewport.scrollTop / scrollable : 0;
      setScrollProgress(Math.min(1, Math.max(0, next)));
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, []);

  const percent = Math.round(scrollProgress * 100);

  return (
    <div className="flex h-full flex-col">
      <ReaderToolbar
        bookTitle={book.title}
        author={book.author}
        chapterIndex={chapterIndex}
        chapterCount={chapterCount}
        fontSize={fontSize}
        lineHeight={lineHeight}
      />

      <div className="flex min-h-0 flex-1">
        <ReaderToc
          chapters={book.chapters}
          currentIndex={chapterIndex}
          onSelect={selectChapter}
          className="hidden md:flex"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollHostRef} className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <ReaderArticle
                chapter={chapter}
                fontSize={fontSize}
                lineHeight={lineHeight}
              />
            </ScrollArea>
          </div>

          <footer className="border-border bg-background flex h-9 shrink-0 items-center gap-3 border-t px-4">
            <div
              className="bg-muted h-1 flex-1 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="本章阅读进度"
            >
              <div
                className="bg-primary h-full rounded-full transition-[width] duration-150 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
              {percent}%
            </span>
          </footer>
        </div>

        <AiPanelSlot className="hidden xl:flex" />
      </div>
    </div>
  );
}
