import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { readFile } from "@tauri-apps/plugin-fs";
// 导入即注册 <foliate-view> 自定义元素（view.js 末尾 customElements.define）。
import "@/vendor/foliate-js/view.js";
import type {
  DrawAnnotationDetail,
  LoadDetail,
  RelocateDetail,
  View as FoliateView,
} from "@/vendor/foliate-js/view.js";
import { Overlayer } from "@/vendor/foliate-js/overlayer.js";
import { ChatPanel, type ChatPanelDraft, type ChatPanelHandle } from "@/components/ai/ChatPanel";
import { ReaderArticle } from "@/components/reader/ReaderArticle";
import { AnnotationPanel } from "@/components/reader/AnnotationPanel";
import { ConceptMapPanel } from "@/components/reader/ConceptMapPanel";
import { QuickSettingsPanel } from "@/components/reader/QuickSettingsPanel";
import { ReaderToc, type ReaderTocEntry } from "@/components/reader/ReaderToc";
import { ReaderToolbar } from "@/components/reader/ReaderToolbar";
import {
  NotePeekCard,
  NOTE_PEEK_EXIT_MS,
} from "@/components/reader/NotePeekCard";
import { SelectionPopover } from "@/components/reader/SelectionPopover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildChapterSummaryPrompt,
  extractSectionText,
} from "@/lib/ai/chapterSummary";
import { buildPrompt } from "@/lib/ai/readingContext";
import {
  formatSelectionDraft,
  popoverPlacement,
  selectionTextOf,
  type SelectionPlacement,
} from "@/lib/ai/selectionDraft";
import {
  bookToc,
  ebookFormatOf,
  makeBookFile,
  readingStyles,
} from "@/lib/foliate";
import { applyPaginatorLayout, paginatorLayoutFor } from "@/lib/pageLayout";
import { toggleOverlayPair, type OverlayPair } from "./overlayPair";
import { isTauri } from "@/lib/platform";
import {
  createNoteHoverCaches,
  resolveNote,
  wireNoteHover,
  type NoteHoverHandle,
  type NotePeekData,
} from "@/lib/noteHover";
import {
  createTurnQueue,
  drainTurnQueue,
  jumpPages,
  requestTurn,
  resetTurnQueue,
  type PageTurnViewLike,
  type TurnQueue,
} from "@/lib/pageTurnQueue";
import { useMediaQuery } from "@/lib/useMediaQuery";
import {
  prefersReducedMotion,
  useReducedMotion,
} from "@/lib/useReducedMotion";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore, type StoredAnnotation } from "@/store/annotationStore";
import {
  FONT_FAMILY_CSS,
  PAGE_MARGIN_PX,
  useReadingSettings,
  type FontFamily,
  type FontSize,
  type LineHeight,
  type PageFlow,
  type PageMargin,
  type PageTurnMode,
  type PaperColor,
} from "@/store/readingSettings";
import {
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  annotationStyleOf,
  type AnnotationStyle,
} from "@/components/reader/highlightColors";
import { getDemoBook } from "@/routes/reader/demoBook";
import { matchTocIndex, type TocItem } from "@/routes/reader/epubToc";
import {
  clampProgress,
  positionFlushPatchOf,
  positionPatchOf,
} from "@/routes/reader/readingPosition";

/** 宽窄窗断点（布局重排 v1）：目录/笔记面板 dock ↔ Sheet 切换共用。 */
const WIDE_MEDIA_QUERY = "(min-width: 768px)";

/** foliate 的 paginator 实现 setStyles，但 Renderer 接口没有声明它。 */
type StyleableRenderer = HTMLElement & {
  setStyles?: (styles: string) => void;
};


/**
 * 翻页实际档位：滚动模式与系统「减少动态效果」下一律按「关闭」走，
 * 但不改写用户存储的偏好（motion.md §4.3）。
 */
function effectivePageTurnOf(
  mode: PageTurnMode,
  pageFlow: PageFlow,
): PageTurnMode {
  if (pageFlow !== "paginated" || prefersReducedMotion()) return "off";
  return mode;
}

const VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]';

/** 浮层经 Esc / 关闭按钮收起后，焦点归还顶栏的触发按钮（验收 3）。 */
function focusToolbarButton(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/**
 * 宽窗浮层（目录/笔记）的点外 / Esc 关闭（窄窗 Sheet 自带这两条路径，不挂）。
 * 触发按钮自己管理开合，点它不在此收口，避免和 onClick 打架。
 */
function useTocPopupDismiss(
  enabled: boolean,
  popupRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  triggerId = "reader-toolbar-toc",
) {
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popupRef.current?.contains(target)) return;
      if (document.getElementById(triggerId)?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, popupRef, onClose, triggerId]);
}

type RealBookPhase =
  | { status: "loading" }
  | { status: "ready"; toc: TocItem[]; currentIndex: number }
  | { status: "error"; message: string };

type SelectionState = SelectionPlacement & { text: string; cfi: string | null };

/** 划选问 Deer（N2）：把选区矩形 + 宿主矩形折算成浮层状态。 */
function selectionStateOf(
  rect: { top: number; left: number; width: number; height: number },
  hostRect: { top: number; left: number; width: number },
  text: string,
): SelectionState {
  return { ...popoverPlacement(rect, hostRect), text, cfi: null };
}

/** 深色主题判定：显式 dark，或 system 时跟随系统外观变化。 */
function useIsDarkTheme(): boolean {
  const theme = useReadingSettings((state) => state.theme);
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return theme === "dark" || (theme === "system" && systemDark);
}

export function ReaderPage() {
  const [searchParams] = useSearchParams();
  const bookId = searchParams.get("book");
  // 笔记跳转（M5b）：URL 带 cfi 时打开书直接落位，优先于上次阅读位置。
  const targetCfi = searchParams.get("cfi");

  const fontSize = useReadingSettings((state) => state.fontSize);
  const lineHeight = useReadingSettings((state) => state.lineHeight);
  const paperColor = useReadingSettings((state) => state.paperColor);
  const pageFlow = useReadingSettings((state) => state.pageFlow);
  const pageTurn = useReadingSettings((state) => state.pageTurn);
  const reducedMotion = useReducedMotion();
  const effectivePageTurn: PageTurnMode =
    reducedMotion || pageFlow !== "paginated" ? "off" : pageTurn;
  const fontFamily = useReadingSettings((state) => state.fontFamily);
  const pageMargin = useReadingSettings((state) => state.pageMargin);
  const footnotePreview = useReadingSettings((state) => state.footnotePreview);
  const setFontSize = useReadingSettings((state) => state.setFontSize);
  const setPaperColor = useReadingSettings((state) => state.setPaperColor);
  const setPageFlow = useReadingSettings((state) => state.setPageFlow);
  const isDark = useIsDarkTheme();

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
  const viewRef = useRef<FoliateView | null>(null);
  const lastSavedProgressRef = useRef(0);
  // 最近一次 relocate 的位置（M5a）：节流写盘之外，离开页面 / 关窗时兜底 flush。
  const lastPositionRef = useRef<{ progress: number; cfi: string | null }>({
    progress: 0,
    cfi: null,
  });
  const [selection, setSelection] = useState<SelectionState | null>(null);
  // 脚注/尾注悬浮预览（luxlore 移植）：卡片数据与接线句柄。句柄存 ref，
  // 供卡片侧「移进卡片取消延迟收卡」与收卡时清计时器使用。
  const [notePeek, setNotePeek] = useState<NotePeekData | null>(null);
  // 每个已加载 section 的 doc 一份接线句柄：关脚注总开关时按 doc 精确断开，
  // 重开时再用同样的 doc 重新接线（不依赖重新翻页）。
  const noteHoverHandlesByDocRef = useRef<Map<Document, NoteHoverHandle>>(
    new Map(),
  );
  const noteRuntimeRef = useRef<{
    loadedDocs: Array<{ doc: Document; index: number }>;
    wireDoc(doc: Document, index: number): void;
  } | null>(null);
  // 卡片退出做 120ms 原地淡出（motion.md M2）：先标记 closing，播完再摘节点。
  const [notePeekClosing, setNotePeekClosing] = useState(false);
  const notePeekCloseTimerRef = useRef(0);
  const notePeekClosingRef = useRef(false);
  const cancelNotePeekClose = useCallback(() => {
    window.clearTimeout(notePeekCloseTimerRef.current);
    notePeekCloseTimerRef.current = 0;
    notePeekClosingRef.current = false;
    setNotePeekClosing(false);
  }, []);
  const showNotePeek = useCallback(
    (peek: NotePeekData) => {
      cancelNotePeekClose();
      setNotePeek(peek);
    },
    [cancelNotePeekClose],
  );
  const fadeNotePeek = useCallback(() => {
    if (notePeekClosingRef.current) return;
    notePeekClosingRef.current = true;
    setNotePeekClosing(true);
    const ms = prefersReducedMotion() ? 0 : NOTE_PEEK_EXIT_MS;
    notePeekCloseTimerRef.current = window.setTimeout(() => {
      notePeekCloseTimerRef.current = 0;
      notePeekClosingRef.current = false;
      setNotePeek(null);
      setNotePeekClosing(false);
    }, ms);
  }, []);
  const closeNotePeek = useCallback(() => {
    for (const handle of noteHoverHandlesByDocRef.current.values()) {
      handle.close();
    }
    cancelNotePeekClose();
    setNotePeek(null);
  }, [cancelNotePeekClose]);
  const cancelNoteScheduledClose = useCallback(() => {
    for (const handle of noteHoverHandlesByDocRef.current.values()) {
      handle.cancelScheduledClose();
    }
    // 指针回到卡片或引用也算「取消退出」。
    cancelNotePeekClose();
  }, [cancelNotePeekClose]);
  useEffect(() => () => window.clearTimeout(notePeekCloseTimerRef.current), []);
  // 点击已有高亮（show-annotation）弹出的编辑菜单。
  const [annotationMenu, setAnnotationMenu] = useState<
    (SelectionPlacement & { annotation: StoredAnnotation }) | null
  >(null);
  const [draft, setDraft] = useState<ChatPanelDraft | null>(null);
  // 大屏默认展开面板；小屏由划选问 / 后续入口主动唤起。
  const [chatOpen, setChatOpen] = useState(
    () => window.matchMedia("(min-width: 1280px)").matches,
  );
  const panelRef = useRef<ChatPanelHandle | null>(null);
  // 章节总结用：relocate 时记录当前 spine section（TOC 的章可能跨多个 section，
  // v1 先总结当前 section，跨 section 章只总结当前一小节）。
  const currentSectionRef = useRef(0);
  // 已画到 foliate overlayer 上的 CFI：设置页「清空笔记」后按差集移除，
  // 让当前打开的书也不用刷新就消失。
  const drawnAnnotationCfisRef = useRef<Set<string>>(new Set());
  // 概念地图（R2）：入口打开时记下当时的 section 作为缓存 key，
  // 面板开着时翻章不换 key（关掉重开才跟到新章）。
  const [conceptMapOpen, setConceptMapOpen] = useState(false);
  const [conceptMapChapterKey, setConceptMapChapterKey] = useState<string | null>(
    null,
  );

  // 读当前 spine section 的可读正文；抽不出（图片书/空章节）返回 null。
  const readCurrentSectionText = async (): Promise<string | null> => {
    const view = viewRef.current;
    const section = view?.book.sections[currentSectionRef.current];
    if (!view || !section) return null;
    try {
      const doc = await section.createDocument?.();
      if (!doc) return null;
      const text = extractSectionText(doc);
      return text || null;
    } catch {
      return null;
    }
  };

  const askDeer = useCallback((text: string) => {
    const formatted = formatSelectionDraft(text);
    if (!formatted) return;
    setDraft({ text: formatted.draft, id: Date.now() });
    setSelection(null);
    viewRef.current?.deselect();
    setChatOpen(true);
  }, []);

  // 复制走系统剪贴板；Tauri webview 是安全上下文，navigator.clipboard 可用。
  const copySelection = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => undefined);
    setSelection(null);
  }, []);

  const bookKey = shelfBook?.id ?? null;

  // 笔记管理面板（M3）：列表直接订阅 annotationStore，跳转/删除复用 foliate 能力。
  const [notesOpen, setNotesOpen] = useState(false);
  // 宽窗笔记与目录同形态（浮层）：点外 / Esc 收口，焦点归还顶栏按钮。
  const notesPopupRef = useRef<HTMLDivElement>(null);
  const closeNotesPopup = useCallback(() => {
    setNotesOpen(false);
    focusToolbarButton("reader-toolbar-notes");
  }, []);
  // 阅读页快捷显示设置面板（M4）。
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  // 目录开关：默认收起（所有宽度），宽窗浮层 / 窄窗 Sheet 共用一套开合。
  const isWide = useMediaQuery(WIDE_MEDIA_QUERY);
  const [tocOpen, setTocOpen] = useState(false);
  const tocPopupRef = useRef<HTMLDivElement>(null);
  const closeTocPopup = useCallback(() => {
    setTocOpen(false);
    focusToolbarButton("reader-toolbar-toc");
  }, []);
  useTocPopupDismiss(tocOpen && isWide, tocPopupRef, closeTocPopup);
  useTocPopupDismiss(
    notesOpen && isWide,
    notesPopupRef,
    closeNotesPopup,
    "reader-toolbar-notes",
  );
  // 跨越到窄窗时把 dock 形态的面板收起，避免 Sheet 突然盖到正文上。
  // 窄窗下挂载时初值本就是收起，只需监听断点跨越事件（不在 effect 里同步 setState）。
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQueryList = window.matchMedia(WIDE_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        setTocOpen(false);
        setNotesOpen(false);
      }
    };
    mediaQueryList.addEventListener("change", onChange);
    return () => mediaQueryList.removeEventListener("change", onChange);
  }, []);

  // 浮层关闭来源（motion.md §M2）：user 走 150ms 退场，navigation（翻页/
  // 跳章）立即摘除，避免残影盖在翻页动画上。用 state 而不是 ref，关闭理由
  // 与 open 在同一次更新里落地，壳渲染时读到的就是这次关闭的理由。
  const [quickSettingsImmediate, setQuickSettingsImmediate] = useState(false);
  const [conceptMapImmediate, setConceptMapImmediate] = useState(false);

  // 浮层互斥（规范 1.3）：显示设置与概念地图同时只开一个。打开一方时另一方
  // 立即摘除，不播 150ms 退场——否则两层并存，旧面板还在拦点击（G8）。
  const applyOverlayPair = (
    slot: "quickSettings" | "conceptMap",
  ): OverlayPair => {
    const next = toggleOverlayPair(
      {
        quickSettings: { open: quickSettingsOpen, immediate: quickSettingsImmediate },
        conceptMap: { open: conceptMapOpen, immediate: conceptMapImmediate },
      },
      slot,
    );
    setQuickSettingsOpen(next.quickSettings.open);
    setQuickSettingsImmediate(next.quickSettings.immediate);
    setConceptMapOpen(next.conceptMap.open);
    setConceptMapImmediate(next.conceptMap.immediate);
    return next;
  };
  const toggleQuickSettings = () => {
    const next = applyOverlayPair("quickSettings");
    if (!next.quickSettings.open) {
      focusToolbarButton("reader-toolbar-display");
    }
  };
  const closeQuickSettings = useCallback(() => {
    setQuickSettingsImmediate(false);
    setQuickSettingsOpen(false);
    focusToolbarButton("reader-toolbar-display");
  }, []);
  const toggleConceptMap = () => {
    const willOpen = !conceptMapOpen;
    if (willOpen) {
      setConceptMapChapterKey(`sec:${currentSectionRef.current}`);
    }
    applyOverlayPair("conceptMap");
    if (!willOpen) {
      focusToolbarButton("reader-toolbar-concept-map");
    }
  };
  const closeConceptMap = useCallback(() => {
    setConceptMapImmediate(false);
    setConceptMapOpen(false);
    focusToolbarButton("reader-toolbar-concept-map");
  }, []);
  // L2（目录 / 笔记窄窗）打开时强制关闭所有 L1（motion.md §2）；目录开合会
  // 让正文重排，划选工具条与脚注卡的锚点也随之失效。
  const closeLevel1Overlays = () => {
    setQuickSettingsImmediate(false);
    setConceptMapImmediate(false);
    setQuickSettingsOpen(false);
    setConceptMapOpen(false);
    setSelection(null);
    setAnnotationMenu(null);
    closeNotePeek();
  };
  const toggleTocOverlays = () => {
    const next = !tocOpen;
    setTocOpen(next);
    if (next) closeLevel1Overlays();
  };
  const toggleNotesOverlays = () => {
  const next = !notesOpen;
  setNotesOpen(next);
  if (next) closeLevel1Overlays();
};

// 编辑已有高亮的「复制」（规范 1.5）：复制摘录，收口菜单。
const copyAnnotationText = useCallback((text: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text).catch(() => undefined);
    setAnnotationMenu(null);
  }, []);
  const annotationsForBook = useAnnotationStore((state) =>
    bookKey ? state.annotations[bookKey] : undefined,
  );

  // 切书时旧书的 CFI 不应再参与差集（不同书可能重用同一 CFI）。
  useEffect(() => {
    drawnAnnotationCfisRef.current.clear();
  }, [bookKey]);

  // 注解被删除或整库清空时，把已渲染的高亮/纹理从 foliate 上摘掉。
  useEffect(() => {
    const view = viewRef.current;
    const cfis = new Set((annotationsForBook ?? []).map((a) => a.cfi));
    for (const cfi of [...drawnAnnotationCfisRef.current]) {
      if (cfis.has(cfi)) continue;
      drawnAnnotationCfisRef.current.delete(cfi);
      void view?.deleteAnnotation({ value: cfi }).catch(() => undefined);
    }
  }, [annotationsForBook]);

  const deleteAnnotationById = useCallback(
    (id: string) => {
      if (!bookKey) return;
      const annotation = useAnnotationStore
        .getState()
        .annotations[bookKey]?.find((a) => a.id === id);
      if (!annotation) return;
      // AI 笔记没有 CFI，不参与 foliate 高亮。
      if (!annotation.cfi) return;
      useAnnotationStore.getState().remove(id);
      void viewRef.current
        ?.deleteAnnotation({ value: annotation.cfi })
        .catch(() => undefined);
    },
    [bookKey],
  );

  // 点击笔记列表条目跳回原文：foliate 的 goTo 对 CFI 字符串会先 resolve 再定位。
  const jumpToAnnotation = useCallback((cfi: string) => {
    void viewRef.current
      ?.goTo(cfi)
      .catch((error: unknown) =>
        console.warn("[reader] 跳转笔记位置失败:", cfi, error),
      );
  }, []);

  // 高亮/笔记：foliate 画临时层，annotationStore 落盘，回显与编辑菜单都以此为源。
  // 微信读书式：点「划线」立即用传入配置落线，菜单不关，就地切进编辑态。
  const highlightSelection = useCallback(
    (sel: SelectionState, style: AnnotationStyle, color: string) => {
      if (sel.cfi && bookKey) {
        void viewRef.current
          ?.addAnnotation({ value: sel.cfi, color, style })
          .catch(() => undefined);
        const annotation = useAnnotationStore.getState().add({
          bookId: bookKey,
          cfi: sel.cfi,
          color,
          style,
          ...(sel.text ? { excerpt: sel.text } : {}),
        });
        setAnnotationMenu({
          x: sel.x,
          y: sel.y,
          placement: sel.placement,
          selTop: sel.selTop,
          selBottom: sel.selBottom,
          annotation,
        });
      }
      setSelection(null);
      viewRef.current?.deselect();
    },
    [bookKey],
  );

  const noteSelection = useCallback(
    (note: string, cfi: string | null, text: string) => {
      if (cfi && bookKey) {
        void viewRef.current
          ?.addAnnotation({
            value: cfi,
            color: DEFAULT_HIGHLIGHT_COLOR,
            style: DEFAULT_ANNOTATION_STYLE,
            note,
          })
          .catch(() => undefined);
        useAnnotationStore.getState().add({
          bookId: bookKey,
          cfi,
          color: DEFAULT_HIGHLIGHT_COLOR,
          style: DEFAULT_ANNOTATION_STYLE,
          note,
          ...(text ? { excerpt: text } : {}),
        });
      }
      setSelection(null);
      viewRef.current?.deselect();
    },
    [bookKey],
  );

  // 点击已有高亮的三个动作：样式/颜色即时重画（foliate 同 key 先移除再画，
  // 菜单不关）、笔记只落盘、删除双删（store + overlayer）。
  const updateAnnotationMenu = useCallback(
    (style: AnnotationStyle, color: string) => {
      const annotation = annotationMenu?.annotation;
      if (!annotation || !bookKey || !annotation.cfi) return;
      useAnnotationStore.getState().setColor(annotation.id, color);
      useAnnotationStore.getState().setStyle(annotation.id, style);
      void viewRef.current
        ?.addAnnotation({
          value: annotation.cfi,
          color,
          style,
          note: annotation.note,
        })
        .catch(() => undefined);
    },
    [annotationMenu, bookKey],
  );

  const editAnnotationNote = useCallback(
    (note: string) => {
      const annotation = annotationMenu?.annotation;
      if (!annotation || !bookKey) return;
      useAnnotationStore.getState().setNote(annotation.id, note);
      setAnnotationMenu(null);
    },
    [annotationMenu, bookKey],
  );

  const deleteAnnotationMenu = useCallback(() => {
    const annotation = annotationMenu?.annotation;
    if (!annotation) return;
    deleteAnnotationById(annotation.id);
    setAnnotationMenu(null);
  }, [annotationMenu, deleteAnnotationById]);

  // 总结当前 spine section：走 N1 的上下文注入，气泡里只显示「总结本章」。
  const summarizeCurrentSection = async () => {
    const text = await readCurrentSectionText();
    if (!text) return;
    const prompt = buildPrompt(buildChapterSummaryPrompt(text).prompt, {
      bookTitle: shelfBook?.title ?? "",
      chapterTitle:
        realPhase.status === "ready"
          ? (realPhase.toc[realPhase.currentIndex]?.title ?? null)
          : null,
      progress: scrollProgress,
    });
    panelRef.current?.send(prompt, "总结本章");
    setChatOpen(true);
  };

  // 换书即重置真实渲染状态：在渲染期比较上一本书 id（React 认可的模式，
  // 避免 effect 内同步 setState 触发级联渲染）。
  const [lastBookKey, setLastBookKey] = useState<string | null>(null);
  if (bookKey !== lastBookKey) {
    setLastBookKey(bookKey);
    setRealPhase({ status: "loading" });
    setScrollProgress(0);
    // 渲染期不碰 ref（定时器回调再触发时本就只会写 null），只复位可见状态。
    setNotePeek(null);
    setNotePeekClosing(false);
    setConceptMapOpen(false);
    setConceptMapChapterKey(null);
  }

  // 翻页请求收口（M1b）：滑动档约 300ms 串行锁、关闭档 100ms 保护间隔，
  // 锁窗口内到达的请求会丢。这里按页数累加，窗口结束后一次性跳到位。
  const turnQueueRef = useRef<TurnQueue>(createTurnQueue());
  // 合并跳转期间不叠淡入（「淡入」档的 relocate 钩子会再挂一次淡入类）。
  const mergedJumpRef = useRef(false);

  const runPageTurn = useCallback(async (delta: number) => {
    const view = viewRef.current;
    if (!view) return;
    if (Math.abs(delta) === 1) {
      if (delta > 0) await view.next();
      else await view.prev();
      return;
    }
    mergedJumpRef.current = true;
    try {
      // foliate 的 ambient 类型没声明分页器的 pages/page 与 fraction 锚点，
      // 只能在这里按实际运行时形态收窄。
      await jumpPages(view as unknown as PageTurnViewLike, delta);
    } finally {
      mergedJumpRef.current = false;
    }
  }, []);

  const turnPage = useCallback(
    (direction: "next" | "prev") => {
      const view = viewRef.current;
      if (!view) return;
      // 滚动模式不排队：连续滚动本身就是跟手的，排队反而拖慢。
      if (useReadingSettings.getState().pageFlow !== "paginated") {
        void (direction === "next" ? view.next() : view.prev()).catch(
          () => undefined,
        );
        return;
      }
      const queue = turnQueueRef.current;
      requestTurn(queue, direction === "next" ? 1 : -1, (delta) =>
        drainTurnQueue(queue, delta, runPageTurn),
      );
    },
    [runPageTurn],
  );

  useEffect(() => {
    // 依赖 book id 而非 book 对象：进度写回会更新 books 数组，
    // 对象引用每次都变；依赖对象会让引擎频繁销毁重建（跳回封面）。
    if (!bookKey) return;
    const shelfBook = useBookStore
      .getState()
      .books.find((book) => book.id === bookKey);
    if (!shelfBook) return;
    let cancelled = false;
    let element: FoliateView | null = null;
    // 句柄容器对象在组件生命周期内不变（只清空内容），先取出供 cleanup 使用。
    const noteHandles = noteHoverHandlesByDocRef.current;
    const turnQueue = turnQueueRef.current;
    lastSavedProgressRef.current = 0;
    lastPositionRef.current = { progress: 0, cfi: null };

    // 分页器默认的 7% / 48px / 720px 在宽窗下会把正文压成中间一条。
    // 页边距设置直接换算成 paginator 的 gap（见 lib/pageLayout），
    // 分页态不再额外注入 body 内边距，避免两处叠加。
    const applyPaginationLayout = (renderer: HTMLElement | undefined) => {
      const settings = useReadingSettings.getState();
      applyPaginatorLayout(
        renderer,
        paginatorLayoutFor({
          viewerWidth: renderer?.getBoundingClientRect().width ?? 0,
          pageMarginPx: PAGE_MARGIN_PX[settings.pageMargin],
        }),
      );
    };

    const applyReadingStyles = () => {
      const renderer = element?.renderer as StyleableRenderer | undefined;
      const settings = useReadingSettings.getState();
      renderer?.setStyles?.(
        readingStyles({
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
          fontFamilyCss: FONT_FAMILY_CSS[settings.fontFamily],
          // 滚动模式没有分页器的 gap，页边距仍走 body 内边距。
          pageMarginPx:
            settings.pageFlow === "scrolled"
              ? PAGE_MARGIN_PX[settings.pageMargin]
              : undefined,
          footnotePreview: settings.footnotePreview,
        }),
      );
    };

    const onRelocate = (event: Event) => {
      const detail = (event as CustomEvent<RelocateDetail>).detail ?? {};
      // 打开后、首次布局前的 payload 没有有效 section 信息（0/0），
      // 写进去会把进度压回 0，跳过。
      const section = detail.section;
      if (!section || section.total === 0) return;

      // 翻页/跳章后选区与浮层都作废（布局重排 1.3：两个设置类浮层一并关闭）。
      setSelection(null);
      setAnnotationMenu(null);
      // navigation 关闭：不播 150ms 退场（会盖在翻页动画上）。
      setQuickSettingsImmediate(true);
      setConceptMapImmediate(true);
      setQuickSettingsOpen(false);
      setConceptMapOpen(false);
      closeNotePeek();
      // 翻页动效：只有「淡入」档在 relocate 时对容器做 150ms 淡入，
      // 不移动分页锚点，也不改变 foliate 自己的排版；滑动档由分页器
      // 自己的 300ms 滚动负责，两者不叠加（滑动结束时也会触发 relocate）。
      const settings = useReadingSettings.getState();
      if (
        !mergedJumpRef.current &&
        effectivePageTurnOf(settings.pageTurn, settings.pageFlow) === "fade"
      ) {
        const host = viewerRef.current;
        if (host) {
          host.classList.remove("deer-page-turn");
          void host.offsetWidth;
          host.classList.add("deer-page-turn");
        }
      }
      currentSectionRef.current = section.current;
      const fraction = clampProgress(detail.fraction as number);
      setScrollProgress(fraction);
      lastPositionRef.current = { progress: fraction, cfi: detail.cfi ?? null };
      setRealPhase((phase) =>
        phase.status === "ready"
          ? {
              ...phase,
              currentIndex:
                matchTocIndex(detail.tocItem?.href ?? undefined, phase.toc) ??
                phase.currentIndex,
            }
          : phase,
      );
      // 阅读进度节流写回书库（失败不影响阅读）。
      const patch = positionPatchOf(lastSavedProgressRef.current, {
        progress: fraction,
        cfi: detail.cfi ?? null,
      });
      if (patch) {
        lastSavedProgressRef.current = patch.progress;
        void updateBook(shelfBook.id, patch).catch(() => undefined);
      }
    };

    // 划选问 Deer（N2）：foliate 没有现成的选区事件，沿用上游 reader.js /
    // paginator.js 的做法——在 view 的 load 事件给出的章节 document 上挂
    // pointerup/keyup（paginator 自己也在同一 doc 上监听 selectionchange），
    // 再从该 doc 读 Selection，坐标经 iframe → 宿主平移折算。
    const docCleanups: Array<() => void> = [];

    // 脚注悬浮预览：缓存按书隔离（effect 每书一份，key 是 spine+fragment，
    // 不跨书复用）；接线句柄登记进组件级 ref，供卡片交互使用。
    // 仅 EPUB 接线——MOBI/FB2 的注释结构是另一套，CBZ/PDF 无此概念。
    const noteCaches = createNoteHoverCaches();
    noteHoverHandlesByDocRef.current.clear();
    const resolveHoverNote = (index: number, href: string) => {
      const book = viewRef.current?.book;
      return book
        ? resolveNote(book, index, href, noteCaches)
        : Promise.resolve(null);
    };
    // 脚注接线：总开关关闭时不盖章不接事件；同一 doc 重新加载先断开旧句柄。
    const wireDoc = (doc: Document, sectionIndex: number) => {
      if (shelfBook.format !== "epub") return;
      if (!useReadingSettings.getState().footnotePreview) return;
      noteHoverHandlesByDocRef.current.get(doc)?.dispose();
      const handle = wireNoteHover(doc, sectionIndex, {
        getContainerRect: () =>
          viewerRef.current?.getBoundingClientRect() ?? null,
        resolve: resolveHoverNote,
        onPeek: showNotePeek,
        onClose: fadeNotePeek,
        isCancelled: () => cancelled,
      });
      noteHoverHandlesByDocRef.current.set(doc, handle);
    };
    const noteRuntime: NonNullable<typeof noteRuntimeRef.current> = {
      loadedDocs: [],
      wireDoc,
    };
    noteRuntimeRef.current = noteRuntime;

    // 高亮渲染：foliate 的 addAnnotation 只发 draw-annotation 事件，
    // 颜色取注解上的 color 字段，样式按 style 选绘制策略（旧数据无 style → 马克笔）。
    const onDrawAnnotation = (event: Event) => {
      const detail = (event as CustomEvent<DrawAnnotationDetail>).detail;
      if (!detail) return;
      const color = detail.annotation.color;
      const style = annotationStyleOf(
        typeof detail.annotation.style === "string"
          ? detail.annotation.style
          : undefined,
      );
      const draw =
        style === "line"
          ? Overlayer.underline
          : style === "dash"
            ? Overlayer.squiggly
            : Overlayer.highlight;
      detail.draw(draw, {
        color: typeof color === "string" ? color : undefined,
      });
    };

    // 回显：foliate 不跨 section 保持注解，每个 section load 时把本书注解
    // 重加一遍（未加载的 section resolve 后拿不到 overlayer，自然跳过）。
    const redrawAnnotations = () => {
      const view = viewRef.current;
      if (!view) return;
      for (const a of useAnnotationStore.getState().listForBook(shelfBook.id)) {
        // AI 笔记没有 CFI，画不到 foliate 上。
        if (!a.cfi) continue;
        const cfi = a.cfi;
        void view
          .addAnnotation({
            value: cfi,
            color: a.color,
            style: a.style,
            note: a.note,
          })
          .then(() => {
            drawnAnnotationCfisRef.current.add(cfi);
          })
          .catch(() => undefined);
      }
    };

    // 点击已有高亮（overlayer hitTest 命中后 foliate 派发 show-annotation）：
    // 按 CFI 找到注解，坐标换算同选区，弹出编辑菜单。
    const onShowAnnotation = (event: Event) => {
      const detail = (
        event as CustomEvent<{ value: string; range: Range }>
      ).detail;
      const viewer = viewerRef.current;
      if (!detail || !viewer) return;
      const annotation = useAnnotationStore
        .getState()
        .listForBook(shelfBook.id)
        .find((a) => a.cfi === detail.value);
      if (!annotation) return;
      const frame = detail.range.startContainer.ownerDocument?.defaultView
        ?.frameElement as HTMLElement | null;
      if (!frame) return;
      const rect = detail.range.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const hostRect = viewer.getBoundingClientRect();
      setAnnotationMenu({
        ...popoverPlacement(
          {
            top: frameRect.top + rect.top - hostRect.top,
            left: frameRect.left + rect.left - hostRect.left,
            width: rect.width,
            height: rect.height,
          },
          { top: 0, left: 0, width: hostRect.width },
        ),
        annotation,
      });
    };

    const onLoaded = (event: Event) => {
      const detail = (event as CustomEvent<LoadDetail>).detail;
      const doc = detail?.doc;
      if (!doc) return;
      redrawAnnotations();
      const sectionIndex = detail.index;
      const sync = () => {
        if (cancelled) return;
        const viewer = viewerRef.current;
        if (!viewer) return;
        // 重新划选时收起高亮编辑菜单。
        setAnnotationMenu(null);
        const sel = selectionTextOf(doc.getSelection());
        if (!sel) {
          setSelection(null);
          return;
        }
        const range = doc.getSelection()?.getRangeAt(0);
        const frame = doc.defaultView?.frameElement as HTMLElement | null;
        if (!range || !frame) return;
        // 正文渲染在 sandbox iframe 里，选区矩形是 iframe 坐标系；
        // paginator 没有对内容做 CSS 缩放，平移即可换算到宿主坐标系。
        const rect = range.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        const hostRect = viewer.getBoundingClientRect();
        // 高亮/笔记（M1）要用 CFI 定位选区，选区存在时就地算好带上。
        const cfi = viewRef.current?.getCFI(sectionIndex, range) ?? null;
        setSelection({
          ...selectionStateOf(
            {
              top: frameRect.top + rect.top - hostRect.top,
              left: frameRect.left + rect.left - hostRect.left,
              width: rect.width,
              height: rect.height,
            },
            { top: 0, left: 0, width: hostRect.width },
            sel,
          ),
          cfi,
        });
      };
      doc.addEventListener("pointerup", sync);
      doc.addEventListener("keyup", sync);
      docCleanups.push(() => {
        doc.removeEventListener("pointerup", sync);
        doc.removeEventListener("keyup", sync);
      });
      // 脚注/尾注悬浮预览（仅 EPUB）：与划选菜单互不干扰——mousedown 收
      // 卡片在 foliate 链接跳转前发生，划选链路不经过悬浮状态。
      if (!noteRuntime.loadedDocs.some((entry) => entry.doc === doc)) {
        noteRuntime.loadedDocs.push({ doc, index: sectionIndex });
      }
      wireDoc(doc, sectionIndex);
    };

    const run = async () => {
      try {
        // 注解库先于首次 load 事件就绪，打开书即可回显。
        await useAnnotationStore.getState().load();
        const bytes = await readFile(shelfBook.filePath);
        if (cancelled) return;
        const viewer = viewerRef.current;
        if (!viewer) throw new Error("渲染容器未就绪");

        // File 直喂：foliate 的 makeBook 走 zip.js 的 BlobReader，且已关掉
        // worker，不需要 blob: 的 XHR，也不需要 tauri assetProtocol。
        const fileName =
          shelfBook.filePath.split(/[\\/]/).pop() ?? `book.${shelfBook.format}`;
        const file = makeBookFile(
          bytes,
          fileName,
          ebookFormatOf(shelfBook.filePath) ?? shelfBook.format,
        );

        const view = document.createElement("foliate-view") as FoliateView;
        view.style.cssText = "display:block;width:100%;height:100%";
        view.addEventListener("relocate", onRelocate);
        view.addEventListener("load", onLoaded);
        view.addEventListener("draw-annotation", onDrawAnnotation);
        view.addEventListener("show-annotation", onShowAnnotation);
        element = view;
        viewRef.current = view;

        await view.open(file);
        if (cancelled) return;

        // 渲染器在 open() 后才存在；挂进 DOM 再 init，否则量不到视口尺寸。
        viewer.replaceChildren(view);

        const toc = bookToc(view.book);
        setRealPhase({ status: "ready", toc, currentIndex: 0 });

        // 恢复上次位置（M5a）：init 对解析不了的 CFI 自带回落，
        // 这里再兜一层 try，保证恢复失败最多回到开头而不是报错页。
        // 笔记跳转（M5b）带 cfi 进来时优先落位到那条笔记。
        const savedCfi = targetCfi ?? shelfBook.lastLocationCfi;
        try {
          await view.init({ lastLocation: savedCfi, showTextStart: true });
        } catch {
          await view.init({ showTextStart: true }).catch(() => undefined);
        }
        if (cancelled) return;
        // init 之后下发属性：max-inline-size 会触发 render()，此时 anchor
        // 已就绪，位置不会跳。
        applyPaginationLayout(view.renderer);
        applyReadingStyles();
        void updateBook(shelfBook.id, { lastOpenedAt: Date.now() }).catch(
          () => undefined,
        );

        // 首次 relocate 可能早于 init，补一次当前位置。
        const fraction = view.lastLocation?.fraction;
        if (Number.isFinite(fraction)) {
          setScrollProgress(Math.min(1, Math.max(0, fraction as number)));
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setRealPhase({ status: "error", message });
      }
    };

    // 分页模式默认没有翻页交互：方向键 / PgUp / PgDn 驱动翻页。
    // 与边缘点击、页脚按钮走同一个收口（M1b 的连翻累加）。
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        turnPage("next");
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        turnPage("prev");
      }
    };
    window.addEventListener("keydown", onKey);

    // 离开阅读页或直接关窗时兜底保存最新位置（节流期内翻过页也不丢）。
    const flushPosition = () => {
      const patch = positionFlushPatchOf(lastPositionRef.current);
      if (!patch) return;
      lastSavedProgressRef.current = patch.progress;
      void updateBook(shelfBook.id, patch).catch(() => undefined);
    };
    window.addEventListener("beforeunload", flushPosition);

    void run();

    return () => {
      cancelled = true;
      // 换书时清掉未消化的翻页请求，避免排到下一本书上。
      resetTurnQueue(turnQueue);
      window.removeEventListener("beforeunload", flushPosition);
      window.removeEventListener("keydown", onKey);
      flushPosition();
      element?.removeEventListener("relocate", onRelocate);
      element?.removeEventListener("load", onLoaded);
      element?.removeEventListener("draw-annotation", onDrawAnnotation);
      element?.removeEventListener("show-annotation", onShowAnnotation);
      docCleanups.forEach((fn) => fn());
      noteHandles.forEach((handle) => handle.dispose());
      noteHandles.clear();
      noteRuntimeRef.current = null;
      element?.close();
      element?.remove();
      viewRef.current = null;
    };
  }, [
    bookKey,
    targetCfi,
    updateBook,
    closeNotePeek,
    showNotePeek,
    fadeNotePeek,
    turnPage,
  ]);

  // 阅读设置注入真实 EPUB 正文（demo 模式走 ReaderArticle 的 style）。
  // 纸色只在浅色主题生效；深色主题注入深底浅字，阅读区跟随应用主题变深。
  useEffect(() => {
    const renderer = viewRef.current?.renderer as StyleableRenderer | undefined;
    if (!renderer || realPhase.status !== "ready") return;
    // 页边距改动同步到分页器 gap（分页态的外侧留白就来自这里）。
    if (pageFlow === "paginated") {
      applyPaginatorLayout(
        renderer,
        paginatorLayoutFor({
          viewerWidth: renderer.getBoundingClientRect().width,
          pageMarginPx: PAGE_MARGIN_PX[pageMargin],
        }),
      );
    }
    renderer.setStyles?.(
      readingStyles({
        fontSize,
        lineHeight,
        paperColor: isDark ? undefined : paperColor,
        dark: isDark,
        fontFamilyCss: FONT_FAMILY_CSS[fontFamily],
        // 滚动模式没有分页器的 gap，页边距仍走 body 内边距。
        pageMarginPx:
          pageFlow === "scrolled" ? PAGE_MARGIN_PX[pageMargin] : undefined,
        footnotePreview,
      }),
    );
  }, [
    fontSize,
    lineHeight,
    paperColor,
    isDark,
    fontFamily,
    pageMargin,
    pageFlow,
    footnotePreview,
    realPhase.status,
  ]);

  // 脚注总开关切换：立即断开/重接当前已加载章节，不必等重新翻页。
  useEffect(() => {
    // 先 close（顺带收起当前卡片）再 dispose，避免总开关关闭后卡片残留。
    const handles = noteHoverHandlesByDocRef.current;
    for (const handle of handles.values()) {
      handle.close();
      handle.dispose();
    }
    handles.clear();
    if (!footnotePreview) return;
    const runtime = noteRuntimeRef.current;
    if (!runtime) return;
    for (const entry of runtime.loadedDocs) {
      runtime.wireDoc(entry.doc, entry.index);
    }
  }, [footnotePreview]);

  // 纸色（M4）：::part(filter) 用 --deer-paper 覆盖 paginator 背景，
  // 设在 foliate 容器上让变量继承进去；深色主题移除，回落应用背景。
  useEffect(() => {
    const host = viewerRef.current;
    if (!host) return;
    if (isDark) host.style.removeProperty("--deer-paper");
    else host.style.setProperty("--deer-paper", paperColor);
  }, [paperColor, isDark, realPhase.status]);

  // 翻页方式（M4）：flow 是 renderer 的 observed attribute，运行时
  // setAttribute 即切换，paginator 用 anchor 恢复位置；未就绪时跳过。
  // 滑动档同时挂 animated（分页器只认自身属性，且它不在 observedAttributes，
  // 运行时挂摘不会触发 render），关闭/淡入档摘掉。
  useEffect(() => {
    const renderer = viewRef.current?.renderer;
    if (!renderer || realPhase.status !== "ready") return;
    renderer.setAttribute("flow", pageFlow);
    if (effectivePageTurn === "slide") renderer.setAttribute("animated", "");
    else renderer.removeAttribute("animated");
  }, [pageFlow, effectivePageTurn, realPhase.status]);

  // 正文区左右边缘点击翻页（中间区域留给文字选择）。
  const selectRealChapter = useCallback((item: TocItem) => {
    const view = viewRef.current;
    if (!view) return;
    void view
      .goTo(item.href)
      .catch((error: unknown) =>
        console.warn("[reader] 跳章失败:", item.href, error),
      );
  }, []);

  if (isDesktop && shelfBook) {
    return (
      <RealReader
        bookId={shelfBook.id}
        title={shelfBook.title}
        author={shelfBook.author}
        phase={realPhase}
        scrollProgress={scrollProgress}
        fontSize={fontSize}
        viewerRef={viewerRef}
        onSelectChapter={selectRealChapter}
        onPageTurn={turnPage}
        selection={selection}
        notePeek={notePeek}
        notePeekClosing={notePeekClosing}
        onCloseNotePeek={closeNotePeek}
        onCancelNoteScheduledClose={cancelNoteScheduledClose}
        annotationMenu={annotationMenu}
        onChangeAnnotationStyle={updateAnnotationMenu}
        onEditAnnotationNote={editAnnotationNote}
        onDeleteAnnotation={deleteAnnotationMenu}
        notesOpen={notesOpen}
        annotations={annotationsForBook}
        onToggleNotes={toggleNotesOverlays}
        onCloseNotes={closeNotesPopup}
        onSelectAnnotation={jumpToAnnotation}
        onDeleteAnnotationById={deleteAnnotationById}
        notesPopupRef={notesPopupRef}
        quickSettingsOpen={quickSettingsOpen}
        quickSettingsImmediate={quickSettingsImmediate}
        paperColor={paperColor}
        pageFlow={pageFlow}
        isDark={isDark}
        wideViewport={isWide}
        tocOpen={tocOpen}
        tocEmpty={realPhase.status === "ready" && realPhase.toc.length === 0}
        onToggleToc={toggleTocOverlays}
        tocPopupRef={tocPopupRef}
        onCloseToc={closeTocPopup}
        onToggleQuickSettings={toggleQuickSettings}
        onCloseQuickSettings={closeQuickSettings}
        onFontSizeChange={setFontSize}
        onPaperColorChange={setPaperColor}
        onPageFlowChange={setPageFlow}
        chatOpen={chatOpen}
        draft={draft}
        panelRef={panelRef}
        onAskSelection={askDeer}
        onCopySelection={copySelection}
        onCopyAnnotation={copyAnnotationText}
        onHighlightSelection={highlightSelection}
        onNoteSelection={noteSelection}
        onOpenPanel={() => setChatOpen(true)}
        onSummarizeChapter={() => void summarizeCurrentSection()}
        conceptMapOpen={conceptMapOpen}
        conceptMapImmediate={conceptMapImmediate}
        conceptMapChapterKey={conceptMapChapterKey}
        onToggleConceptMap={toggleConceptMap}
        onCloseConceptMap={closeConceptMap}
        getChapterText={readCurrentSectionText}
        onClosePanel={() => setChatOpen(false)}
      />
    );
  }

  return (
    <DemoReader
      bookId={bookId}
      fontSize={fontSize}
      lineHeight={lineHeight}
      fontFamily={fontFamily}
      pageMargin={pageMargin}
      chatOpen={chatOpen}
      draft={draft}
      onAskSelection={askDeer}
      onCopySelection={copySelection}
      onOpenPanel={() => setChatOpen(true)}
      onClosePanel={() => setChatOpen(false)}
    />
  );
}

type RealReaderProps = {
  bookId: string;
  title: string;
  author: string;
  phase: RealBookPhase;
  scrollProgress: number;
  fontSize: FontSize;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  onSelectChapter: (item: TocItem) => void;
  onPageTurn: (direction: "next" | "prev") => void;
  selection: SelectionState | null;
  /** 悬浮脚注/尾注卡片的数据；null 即无卡片。 */
  notePeek: NotePeekData | null;
  /** 卡片正在 120ms 淡出，播完由父级摘除。 */
  notePeekClosing: boolean;
  onCloseNotePeek: () => void;
  /** 指针移进卡片时取消延迟收卡（卡片可滚动，接受指针）。 */
  onCancelNoteScheduledClose: () => void;
  annotationMenu:
    | (SelectionPlacement & { annotation: StoredAnnotation })
    | null;
  onChangeAnnotationStyle: (style: AnnotationStyle, color: string) => void;
  onEditAnnotationNote: (note: string) => void;
  onDeleteAnnotation: () => void;
  notesOpen: boolean;
  annotations: StoredAnnotation[] | undefined;
  onToggleNotes: () => void;
  onCloseNotes: () => void;
  onSelectAnnotation: (cfi: string) => void;
  onDeleteAnnotationById: (id: string) => void;
  /** 宽窗笔记浮层的宿主 ref（点外/Esc 收口用）。 */
  notesPopupRef: React.RefObject<HTMLDivElement | null>;
  quickSettingsOpen: boolean;
  /** 关闭来源为 navigation：浮层立即摘除，不播退场。 */
  quickSettingsImmediate: boolean;
  paperColor: PaperColor;
  pageFlow: PageFlow;
  isDark: boolean;
  /** 宽窗（≥md）为 true：目录/笔记用浮层，窄窗用 Sheet 浮层（布局重排 v1）。 */
  wideViewport: boolean;
  tocOpen: boolean;
  /** 无目录的书（图片书等）：目录面板显示空态、按钮置灰。 */
  tocEmpty: boolean;
  onToggleToc: () => void;
  /** 宽窗目录浮层的宿主 ref（点外/Esc 收口用）与「选中章节后关目录」。 */
  tocPopupRef: React.RefObject<HTMLDivElement | null>;
  onCloseToc: () => void;
  onToggleQuickSettings: () => void;
  onCloseQuickSettings: () => void;
  onFontSizeChange: (fontSize: FontSize) => void;
  onPaperColorChange: (paperColor: PaperColor) => void;
  onPageFlowChange: (pageFlow: PageFlow) => void;
  chatOpen: boolean;
  draft: ChatPanelDraft | null;
  panelRef: React.RefObject<ChatPanelHandle | null>;
  onAskSelection: (text: string) => void;
  onCopySelection: (text: string) => void;
  /** 编辑已有高亮菜单里的「复制」：复制摘录并收口菜单。 */
  onCopyAnnotation: (text: string) => void;
  onHighlightSelection: (
    sel: SelectionState,
    style: AnnotationStyle,
    color: string,
  ) => void;
  onNoteSelection: (note: string, cfi: string | null, text: string) => void;
  onSummarizeChapter: () => void;
  /** 只打开 AI 面板，不发送任何消息（顶栏「AI 伴读」按钮）。 */
  onOpenPanel: () => void;
  conceptMapOpen: boolean;
  conceptMapImmediate: boolean;
  conceptMapChapterKey: string | null;
  onToggleConceptMap: () => void;
  onCloseConceptMap: () => void;
  getChapterText: () => Promise<string | null>;
  onClosePanel: () => void;
};

function RealReader({
  bookId,
  title,
  author,
  phase,
  scrollProgress,
  fontSize,
  viewerRef,
  onSelectChapter,
  onPageTurn,
  selection,
  notePeek,
  notePeekClosing,
  onCloseNotePeek,
  onCancelNoteScheduledClose,
  annotationMenu,
  onChangeAnnotationStyle,
  onEditAnnotationNote,
  onDeleteAnnotation,
  notesOpen,
  annotations,
  onToggleNotes,
  onCloseNotes,
  onSelectAnnotation,
  onDeleteAnnotationById,
  notesPopupRef,
  quickSettingsOpen,
  quickSettingsImmediate,
  paperColor,
  pageFlow,
  isDark,
  wideViewport,
  tocOpen,
  tocEmpty,
  onToggleToc,
  tocPopupRef,
  onCloseToc,
  onToggleQuickSettings,
  onCloseQuickSettings,
  onFontSizeChange,
  onPaperColorChange,
  onPageFlowChange,
  chatOpen,
  draft,
  panelRef,
  onAskSelection,
  onCopySelection,
  onCopyAnnotation,
  onHighlightSelection,
  onNoteSelection,
  onSummarizeChapter,
  onOpenPanel,
  conceptMapOpen,
  conceptMapImmediate,
  conceptMapChapterKey,
  onToggleConceptMap,
  onCloseConceptMap,
  getChapterText,
  onClosePanel,
}: RealReaderProps) {
  const tocEntries: ReaderTocEntry[] =
    phase.status === "ready" ? phase.toc : [];
  const currentIndex = phase.status === "ready" ? phase.currentIndex : 0;
  const percent = Math.round(scrollProgress * 100);

  const renderToc = () => (
    <ReaderToc
      chapters={tocEntries}
      currentIndex={currentIndex}
      onSelect={(index) => {
        if (phase.status === "ready") {
          const item = phase.toc[index];
          if (item) onSelectChapter(item);
        }
        // 选中即关（目录改弹层后单入口，不再常驻）。
        onCloseToc();
      }}
    />
  );

  return (
    <div className="relative flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <ReaderToolbar
          bookTitle={title}
          author={author}
          tocOpen={tocOpen && !tocEmpty}
          tocDisabled={tocEmpty}
          onToggleToc={onToggleToc}
          notesOpen={notesOpen}
          onToggleNotes={onToggleNotes}
          quickSettingsOpen={quickSettingsOpen}
          onToggleQuickSettings={onToggleQuickSettings}
          conceptMapOpen={conceptMapOpen}
          onToggleConceptMap={onToggleConceptMap}
          onOpenPanel={onOpenPanel}
          panelOpen={chatOpen}
        />

        <div className="flex min-h-0 flex-1">
          {wideViewport ? null : (
            <Sheet
              open={tocOpen && !tocEmpty}
              onOpenChange={(open) => {
                if (!open) onToggleToc();
              }}
            >
              <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 p-0">
                {renderToc()}
              </SheetContent>
            </Sheet>
          )}

          {wideViewport ? null : (
            <Sheet
              open={notesOpen}
              onOpenChange={(open) => {
                if (!open) onCloseNotes();
              }}
            >
              <SheetContent side="left" showCloseButton={false} className="w-80 gap-0 p-0">
                <AnnotationPanel
                  variant="sheet"
                  annotations={annotations ?? []}
                  onSelect={onSelectAnnotation}
                  onDelete={onDeleteAnnotationById}
                  onClose={onCloseNotes}
                />
              </SheetContent>
            </Sheet>
          )}

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
              {/* 宽窗目录浮层：盖在正文上，不占左栏；点外/Esc 由 useTocPopupDismiss 收口。 */}
              {wideViewport && tocOpen && !tocEmpty ? (
                <div
                  ref={tocPopupRef}
                  // 别让点击冒泡进边缘翻页捕获层。
                  onClick={(event) => event.stopPropagation()}
                  className="border-border bg-popover absolute inset-y-2 left-2 z-20 w-72 overflow-hidden rounded-lg border shadow-md"
                >
                  {renderToc()}
                </div>
              ) : null}
              {/* 宽窗笔记浮层：与目录同一形态，盖在正文上不占左栏；点外/Esc 由
                  useTocPopupDismiss 收口，选中跳原文后关闭。 */}
              {wideViewport && notesOpen ? (
                <div
                  ref={notesPopupRef}
                  // 别让点击冒泡进边缘翻页捕获层。
                  onClick={(event) => event.stopPropagation()}
                  className="border-border bg-popover absolute inset-y-2 left-2 z-20 w-80 overflow-hidden rounded-lg border shadow-md"
                >
                  <AnnotationPanel
                    variant="sheet"
                    annotations={annotations ?? []}
                    onSelect={(cfi) => {
                      onSelectAnnotation(cfi);
                      onCloseNotes();
                    }}
                    onDelete={onDeleteAnnotationById}
                    onClose={onCloseNotes}
                  />
                </div>
              ) : null}
              {/* 正文渲染在 foliate 的 iframe 里，点击不会冒泡到父文档，
                  所以边缘翻页靠这两个透明捕获层接住。 */}
              <div className="absolute inset-y-0 left-0 w-[15%]" aria-hidden="true" />
              <div className="absolute inset-y-0 right-0 w-[15%]" aria-hidden="true" />
              <QuickSettingsPanel
                open={quickSettingsOpen}
                immediate={quickSettingsImmediate}
                fontSize={fontSize}
                paperColor={paperColor}
                pageFlow={pageFlow}
                paperColorDisabled={isDark}
                onFontSizeChange={onFontSizeChange}
                onPaperColorChange={onPaperColorChange}
                onPageFlowChange={onPageFlowChange}
                onClose={onCloseQuickSettings}
              />
              {phase.status === "loading" ? (
                <div
                  className="absolute inset-0 flex items-center justify-center px-12"
                  role="status"
                >
                  {/* 开书骨架（M6）：版心位置一条标题 + 六条正文，与正文同样
                      只有透明度脉冲，不做扫光位移。 */}
                  <div className="w-full max-w-xl space-y-5">
                    <Skeleton className="h-4 w-1/2" />
                    <div className="space-y-3">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton
                          key={index}
                          className="h-3.5"
                          style={{ width: index === 5 ? "62%" : "100%" }}
                        />
                      ))}
                    </div>
                    <span className="sr-only">正在加载书籍…</span>
                  </div>
                </div>
              ) : null}
              {phase.status === "error" ? (
                <div className="text-destructive absolute inset-0 flex items-center justify-center px-8 text-center text-sm">
                  打开本书失败：{phase.message}
                </div>
              ) : null}
              {conceptMapChapterKey ? (
                <ConceptMapPanel
                  open={conceptMapOpen}
                  immediate={conceptMapImmediate}
                  bookId={bookId}
                  bookTitle={title}
                  chapterKey={conceptMapChapterKey}
                  chapterTitle={
                    phase.status === "ready"
                      ? (phase.toc[phase.currentIndex]?.title ?? null)
                      : null
                  }
                  getChapterText={getChapterText}
                  onClose={onCloseConceptMap}
                />
              ) : null}
              {notePeek ? (
                <NotePeekCard
                  key={`${notePeek.href}:${notePeek.anchor.top}`}
                  anchor={notePeek.anchor}
                  text={notePeek.text}
                  type={notePeek.type}
                  containerRef={viewerRef}
                  closing={notePeekClosing}
                  onPointerEnter={onCancelNoteScheduledClose}
                  onPointerLeave={onCloseNotePeek}
                />
              ) : null}
              {annotationMenu ? (
                <SelectionPopover
                  // 与划选菜单同处一个三元分支：key 分开，切换时不复用旧
                  // 组件的 mode/note 内态（motion.md §M2）。
                  key="annotation"
                  x={annotationMenu.x}
                  y={annotationMenu.y}
                  placement={annotationMenu.placement}
                  selTop={annotationMenu.selTop}
                  selBottom={annotationMenu.selBottom}
                  text={annotationMenu.annotation.excerpt ?? ""}
                  existing={{
                    color: annotationMenu.annotation.color,
                    style: annotationMenu.annotation.style ?? "marker",
                    note: annotationMenu.annotation.note,
                  }}
                  onCopy={
                    annotationMenu.annotation.excerpt
                      ? onCopyAnnotation
                      : undefined
                  }
                  // 行 1 四个按钮齐：编辑态也把选区/摘录交给 AI 面板（问 Deer）。
                  onAsk={
                    annotationMenu.annotation.excerpt
                      ? () => onAskSelection(annotationMenu.annotation.excerpt ?? "")
                      : undefined
                  }
                  onHighlight={onChangeAnnotationStyle}
                  onNote={onEditAnnotationNote}
                  onDelete={onDeleteAnnotation}
                />
              ) : selection ? (
                <SelectionPopover
                  key="selection"
                  x={selection.x}
                  y={selection.y}
                  placement={selection.placement}
                  selTop={selection.selTop}
                  selBottom={selection.selBottom}
                  text={selection.text}
                  onCopy={onCopySelection}
                  onHighlight={(style, color) =>
                    onHighlightSelection(selection, style, color)
                  }
                  onNote={(note) =>
                    onNoteSelection(note, selection.cfi, selection.text)
                  }
                  onAsk={() => onAskSelection(selection.text)}
                />
              ) : null}
            </div>

            <footer className="border-border bg-background flex h-9 shrink-0 items-center gap-3 border-t px-4">
              <span className="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs tabular-nums">
                第 {currentIndex + 1} / {Math.max(tocEntries.length, 1)} 章
                {phase.status === "ready" && phase.toc[currentIndex]
                  ? ` · ${phase.toc[currentIndex].title}`
                  : ""}
              </span>
              <div
                className="bg-muted h-1 flex-1 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label="全书阅读进度"
              >
                <div
                  className="bg-primary h-full rounded-full transition-[width] duration-base ease-enter"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                {percent}%
              </span>
              {pageFlow === "paginated" ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="上一页"
                    onClick={() => onPageTurn("prev")}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="下一页"
                    onClick={() => onPageTurn("next")}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              ) : null}
            </footer>
          </div>
        </div>
      </div>

      <ChatPanel
        ref={panelRef}
        book={{ id: bookId, title }}
        readingContext={{
          bookTitle: title,
          chapterTitle:
            phase.status === "ready"
              ? (phase.toc[phase.currentIndex]?.title ?? null)
              : null,
          progress: scrollProgress,
        }}
        draft={draft}
        onClose={onClosePanel}
        open={chatOpen}
        onSummarizeChapter={onSummarizeChapter}
        // 与书架页统一为嵌入式停靠：占主区右侧宽度推挤正文，常驻不因点外收起。
      />
    </div>
  );
}

type DemoReaderProps = {
  bookId: string | null;
  fontSize: number;
  lineHeight: LineHeight;
  fontFamily: FontFamily;
  pageMargin: PageMargin;
  chatOpen: boolean;
  draft: ChatPanelDraft | null;
  onAskSelection: (text: string) => void;
  onCopySelection: (text: string) => void;
  onOpenPanel: () => void;
  onClosePanel: () => void;
};

/** 浏览器预览（非 Tauri）时的演示书渲染，行为与泳道 B 占位版一致。 */
function DemoReader({
  bookId,
  fontSize,
  lineHeight,
  fontFamily,
  pageMargin,
  chatOpen,
  draft,
  onAskSelection,
  onCopySelection,
  onOpenPanel,
  onClosePanel,
}: DemoReaderProps) {
  const book = getDemoBook(bookId);

  const [chapterIndex, setChapterIndex] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const scrollHostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<ChatPanelHandle | null>(null);
  // 目录开关：默认收起（所有宽度），宽窗浮层 / 窄窗 Sheet 共用一套开合。
  const isWide = useMediaQuery(WIDE_MEDIA_QUERY);
  const [tocOpen, setTocOpen] = useState(false);
  const tocPopupRef = useRef<HTMLDivElement>(null);
  const closeTocPopup = useCallback(() => setTocOpen(false), []);
  useTocPopupDismiss(tocOpen && isWide, tocPopupRef, closeTocPopup);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQueryList = window.matchMedia(WIDE_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setTocOpen(false);
    };
    mediaQueryList.addEventListener("change", onChange);
    return () => mediaQueryList.removeEventListener("change", onChange);
  }, []);

  const chapter = book.chapters[chapterIndex] ?? book.chapters[0];
  const chapterCount = book.chapters.length;

  // 概念地图（R2）：演示书按章节序号做缓存 key，正文就是段落列表。
  const [conceptMapOpen, setConceptMapOpen] = useState(false);

  // 总结本章（N3）：演示书章节就是段落列表，走 N1 上下文注入发送。
  const summarizeChapter = () => {
    const prompt = buildPrompt(
      buildChapterSummaryPrompt(chapter.paragraphs.join("\n\n")).prompt,
      { bookTitle: book.title, chapterTitle: chapter.title, progress: null },
    );
    panelRef.current?.send(prompt, "总结本章");
    onOpenPanel();
  };

  // 换章回到开头：新正文从头读，进度条归零（状态在切换时同步重置，避免 effect 里 setState）。
  // 跳章时概念地图一并关闭（布局重排 1.3）。
  const selectChapter = (index: number) => {
    setChapterIndex(index);
    setScrollProgress(0);
    setSelection(null);
    setConceptMapOpen(false);
  };

  // 划选问 Deer（N2）：演示书正文就在宿主文档里，直接读 window selection。
  const onMouseUp = () => {
    const host = scrollHostRef.current;
    const sel = window.getSelection();
    const text = selectionTextOf(sel);
    if (!host || !sel || sel.rangeCount === 0 || !text) {
      setSelection(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    setSelection(
      selectionStateOf(
        {
          top: rect.top - hostRect.top,
          left: rect.left - hostRect.left,
          width: rect.width,
          height: rect.height,
        },
        { top: 0, left: 0, width: hostRect.width },
        text,
      ),
    );
  };

  const askDeer = (text: string) => {
    onAskSelection(text);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  // 演示书没有 foliate view，高亮/笔记没有 CFI 可存，菜单收口即关闭。
  const closeSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
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
    <div className="relative flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <ReaderToolbar
          bookTitle={book.title}
          author={book.author}
          tocOpen={tocOpen}
          onToggleToc={() => setTocOpen((open) => !open)}
          conceptMapOpen={conceptMapOpen}
          onToggleConceptMap={() => setConceptMapOpen((open) => !open)}
          onOpenPanel={onOpenPanel}
          panelOpen={chatOpen}
        />

        <div className="flex min-h-0 flex-1">
          {isWide ? null : (
            <Sheet
              open={tocOpen}
              onOpenChange={(open) => {
                if (!open) setTocOpen(false);
              }}
            >
              <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 p-0">
                <ReaderToc
                  chapters={book.chapters}
                  currentIndex={chapterIndex}
                  onSelect={(index) => {
                    selectChapter(index);
                    setTocOpen(false);
                  }}
                />
              </SheetContent>
            </Sheet>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <div
              ref={scrollHostRef}
              className="relative min-h-0 flex-1"
              onMouseUp={onMouseUp}
            >
              <ScrollArea className="h-full">
                <ReaderArticle
                  chapter={chapter}
                  fontSize={fontSize}
                  lineHeight={lineHeight}
                  fontFamily={fontFamily}
                  pageMargin={pageMargin}
                />
              </ScrollArea>
              {/* 宽窗目录浮层：与 RealReader 同一套点外/Esc 收口。 */}
              {isWide && tocOpen ? (
                <div
                  ref={tocPopupRef}
                  className="border-border bg-popover absolute inset-y-2 left-2 z-20 w-72 overflow-hidden rounded-lg border shadow-md"
                >
                  <ReaderToc
                    chapters={book.chapters}
                    currentIndex={chapterIndex}
                    onSelect={(index) => {
                      selectChapter(index);
                      setTocOpen(false);
                    }}
                  />
                </div>
              ) : null}
              {selection ? (
                <SelectionPopover
                  x={selection.x}
                  y={selection.y}
                  placement={selection.placement}
                  selTop={selection.selTop}
                  selBottom={selection.selBottom}
                  text={selection.text}
                  onCopy={onCopySelection}
                  onHighlight={() => closeSelection()}
                  onNote={() => closeSelection()}
                  onAsk={() => askDeer(selection.text)}
                />
              ) : null}
              <ConceptMapPanel
                open={conceptMapOpen}
                bookId={bookId ?? book.id}
                bookTitle={book.title}
                chapterKey={`chapter:${chapterIndex}`}
                chapterTitle={chapter.title}
                getChapterText={async () => chapter.paragraphs.join("\n\n")}
                onClose={() => {
                  setConceptMapOpen(false);
                  focusToolbarButton("reader-toolbar-concept-map");
                }}
              />
            </div>

            <footer className="border-border bg-background flex h-9 shrink-0 items-center gap-3 border-t px-4">
              <span className="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs tabular-nums">
                第 {chapterIndex + 1} / {chapterCount} 章 · {chapter.title}
              </span>
              <div
                className="bg-muted h-1 flex-1 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label="本章阅读进度"
              >
                <div
                  className="bg-primary h-full rounded-full transition-[width] duration-base ease-enter"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                {percent}%
              </span>
            </footer>
          </div>
        </div>
      </div>

      <ChatPanel
        ref={panelRef}
        book={{ id: bookId ?? book.id, title: book.title }}
        // 演示书没有全书概念，scrollProgress 是本章内的进度，不冒充全书进度。
        readingContext={{
          bookTitle: book.title,
          chapterTitle: chapter.title,
          progress: null,
        }}
        draft={draft}
        onClose={onClosePanel}
        open={chatOpen}
        onSummarizeChapter={summarizeChapter}
        // 与书架页统一为嵌入式停靠：占主区右侧宽度推挤正文，常驻不因点外收起。
      />
    </div>
  );
}
