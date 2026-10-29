import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { readFile } from "@tauri-apps/plugin-fs";
import ePub, { type Book as EpubBook, type Rendition } from "epubjs";
import { AiPanelSlot } from "@/components/reader/AiPanelSlot";
import { ReaderArticle } from "@/components/reader/ReaderArticle";
import { ReaderToc, type ReaderTocEntry } from "@/components/reader/ReaderToc";
import { ReaderToolbar } from "@/components/reader/ReaderToolbar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isTauri } from "@/lib/platform";
import { useBookStore } from "@/store/bookStore";
import { useReadingSettings } from "@/store/readingSettings";
import { getDemoBook } from "@/routes/reader/demoBook";
import {
  flattenToc,
  matchTocIndex,
  type RawTocNode,
  type TocItem,
} from "@/routes/reader/epubToc";

const VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]';

// 底部进度条持久化节流：位置变化超过该阈值才写回书库。
const PROGRESS_SAVE_STEP = 0.05;

type RealBookPhase =
  | { status: "loading" }
  | { status: "ready"; toc: TocItem[]; currentIndex: number }
  | { status: "error"; message: string };

export function ReaderPage() {
  const [searchParams] = useSearchParams();
  const bookId = searchParams.get("book");

  const fontSize = useReadingSettings((state) => state.fontSize);
  const lineHeight = useReadingSettings((state) => state.lineHeight);

  // —— 桌面端真实 EPUB：从书库找到书并渲染；浏览器预览退回演示书。——
  const isDesktop = isTauri();
  const books = useBookStore((state) => state.books);
  const bookStoreReady = useBookStore((state) => state.ready);
  const loadBookStore = useBookStore((state) => state.load);
  const updateBook = useBookStore((state) => state.updateBook);

  // 直接从链接进入阅读页时书库可能尚未加载（书架页才调用 load）。
  useEffect(() => {
    if (isDesktop && !bookStoreReady) void loadBookStore();
  }, [isDesktop, bookStoreReady, loadBookStore]);

  const shelfBook =
    isDesktop && bookId ? books.find((book) => book.id === bookId) : undefined;

  const [realPhase, setRealPhase] = useState<RealBookPhase>({ status: "loading" });
  const [scrollProgress, setScrollProgress] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const lastSavedProgressRef = useRef(0);

  // 换书即重置真实渲染状态：在渲染期比较上一本书 id（React 认可的模式，
  // 避免 effect 内同步 setState 触发级联渲染）。
  const bookKey = shelfBook?.id ?? null;
  const [lastBookKey, setLastBookKey] = useState<string | null>(null);
  if (bookKey !== lastBookKey) {
    setLastBookKey(bookKey);
    setRealPhase({ status: "loading" });
    setScrollProgress(0);
  }

  useEffect(() => {
    // 依赖 book id 而非 book 对象：进度写回会更新 books 数组，
    // 对象引用每次都变；依赖对象会让 rendition 频繁销毁重建（跳回封面）。
    if (!bookKey) return;
    const shelfBook = useBookStore
      .getState()
      .books.find((book) => book.id === bookKey);
    if (!shelfBook) return;
    let cancelled = false;
    let epubBook: EpubBook | null = null;
    lastSavedProgressRef.current = 0;

    const run = async () => {
      try {
        const bytes = await readFile(shelfBook.filePath);
        if (cancelled) return;

        // 直接喂字节（epub.js BINARY 路径，JSZip 本地解包）：WKWebView
        // 对 blob: URL 的 XHR 会被拦，不能走 blob URL。
        epubBook = ePub(bytes.buffer);
        const nav = await epubBook.loaded.navigation;
        if (cancelled || !epubBook) return;

        const toc = flattenToc(nav.toc as unknown as RawTocNode[]);
        const viewer = viewerRef.current;
        if (!viewer) throw new Error("渲染容器未就绪");

        const rendition = epubBook.renderTo(viewer, {
          width: "100%",
          height: "100%",
          spread: "none",
        });
        renditionRef.current = rendition;

        rendition.on("relocated", (location: {
          start?: { href?: string; percentage?: number };
        }) => {
          const percentage = location.start?.percentage ?? 0;
          setScrollProgress(Math.min(1, Math.max(0, percentage)));
          setRealPhase((phase) =>
            phase.status === "ready"
              ? {
                  ...phase,
                  currentIndex:
                    matchTocIndex(location.start?.href, phase.toc) ??
                    phase.currentIndex,
                }
              : phase,
          );
          // 阅读进度节流写回书库（失败不影响阅读）。
          const last = lastSavedProgressRef.current;
          if (Math.abs(percentage - last) >= PROGRESS_SAVE_STEP) {
            lastSavedProgressRef.current = percentage;
            void updateBook(shelfBook.id, { progress: percentage }).catch(
              () => undefined,
            );
          }
        });

        setRealPhase({ status: "ready", toc, currentIndex: 0 });
        await rendition.display();

        // 底部进度条的百分比依赖分页定位表（不生成时 relocated 的
        // percentage 恒为 0）。后台异步生成，完成后用当前位置刷新一次，
        // 不阻塞首屏渲染；此后翻页/跳章的 relocated 自带准确百分比。
        const locatedBook = epubBook;
        void locatedBook.ready
          .then(() => locatedBook.locations.generate(1024))
          .then(() => renditionRef.current?.currentLocation())
          .then((location) => {
            const start = (
              location as
                | { start?: { percentage?: number } }
                | undefined
            )?.start;
            if (cancelled || !start) return;
            const percentage = start.percentage ?? 0;
            setScrollProgress(Math.min(1, Math.max(0, percentage)));
          })
          .catch(() => undefined);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setRealPhase({ status: "error", message });
      }
    };

    // 分页模式默认没有翻页交互：方向键 / PgUp / PgDn 驱动 next/prev。
    const onKey = (event: KeyboardEvent) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        void rendition.next().catch(() => undefined);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        void rendition.prev().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKey);

    void run();

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      renditionRef.current?.destroy();
      renditionRef.current = null;
      epubBook?.destroy();
    };
  }, [bookKey, updateBook]);

  // 阅读设置注入真实 EPUB 正文（demo 模式走 ReaderArticle 的 style）。
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || realPhase.status !== "ready") return;
    rendition.themes.fontSize(`${fontSize}px`);
    rendition.themes.default({
      "html, body, p, div": { "line-height": String(lineHeight) },
    });
  }, [fontSize, lineHeight, realPhase]);

  // 正文区左右边缘点击翻页（中间区域留给文字选择）。
  const turnPage = useCallback(
    (direction: "next" | "prev") => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      void (direction === "next"
        ? rendition.next()
        : rendition.prev()
      ).catch(() => undefined);
    },
    [],
  );

  const selectRealChapter = useCallback(
    (item: TocItem) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      void rendition
        .display(item.href)
        .catch((error: unknown) =>
          console.warn("[reader] 跳章失败:", item.href, error),
        );
    },
    [],
  );

  if (isDesktop && shelfBook) {
    return (
      <RealReader
        bookId={shelfBook.id}
        title={shelfBook.title}
        author={shelfBook.author}
        phase={realPhase}
        scrollProgress={scrollProgress}
        fontSize={fontSize}
        lineHeight={lineHeight}
        viewerRef={viewerRef}
        onSelectChapter={selectRealChapter}
        onPageTurn={turnPage}
      />
    );
  }

  return <DemoReader bookId={bookId} fontSize={fontSize} lineHeight={lineHeight} />;
}

type RealReaderProps = {
  bookId: string;
  title: string;
  author: string;
  phase: RealBookPhase;
  scrollProgress: number;
  fontSize: number;
  lineHeight: number;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  onSelectChapter: (item: TocItem) => void;
  onPageTurn: (direction: "next" | "prev") => void;
};

function RealReader({
  title,
  author,
  phase,
  scrollProgress,
  fontSize,
  lineHeight,
  viewerRef,
  onSelectChapter,
  onPageTurn,
}: RealReaderProps) {
  const tocEntries: ReaderTocEntry[] =
    phase.status === "ready" ? phase.toc : [];
  const currentIndex = phase.status === "ready" ? phase.currentIndex : 0;
  const percent = Math.round(scrollProgress * 100);

  return (
    <div className="flex h-full flex-col">
      <ReaderToolbar
        bookTitle={title}
        author={author}
        chapterIndex={currentIndex}
        chapterCount={Math.max(tocEntries.length, 1)}
        fontSize={fontSize}
        lineHeight={lineHeight as 1.6 | 1.8 | 2}
      />

      <div className="flex min-h-0 flex-1">
        <ReaderToc
          chapters={tocEntries}
          currentIndex={currentIndex}
          onSelect={(index) => {
            if (phase.status === "ready") {
              const item = phase.toc[index];
              if (item) onSelectChapter(item);
            }
          }}
          className="hidden md:flex"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = (event.clientX - rect.left) / rect.width;
              // 左右 15% 边缘翻页，中间区域留给文字选择。
              if (x < 0.15) onPageTurn("prev");
              else if (x > 0.85) onPageTurn("next");
            }}
          >
            <div ref={viewerRef} className="h-full w-full" />
            {/* epub.js iframe 内的点击不会冒泡到父文档，边缘翻页靠这两个透明捕获层。 */}
            <div className="absolute inset-y-0 left-0 w-[15%]" aria-hidden="true" />
            <div className="absolute inset-y-0 right-0 w-[15%]" aria-hidden="true" />
            {phase.status === "loading" ? (
              <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
                正在加载书籍…
              </div>
            ) : null}
            {phase.status === "error" ? (
              <div className="text-destructive absolute inset-0 flex items-center justify-center px-8 text-center text-sm">
                打开本书失败：{phase.message}
              </div>
            ) : null}
          </div>

          <footer className="border-border bg-background flex h-9 shrink-0 items-center gap-3 border-t px-4">
            <div
              className="bg-muted h-1 flex-1 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="全书阅读进度"
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

type DemoReaderProps = {
  bookId: string | null;
  fontSize: number;
  lineHeight: number;
};

/** 浏览器预览（非 Tauri）时的演示书渲染，行为与泳道 B 占位版一致。 */
function DemoReader({ bookId, fontSize, lineHeight }: DemoReaderProps) {
  const book = getDemoBook(bookId);

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
        lineHeight={lineHeight as 1.6 | 1.8 | 2}
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
                lineHeight={lineHeight as 1.6 | 1.8 | 2}
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
