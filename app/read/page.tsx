'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { ChevronLeft, List, Settings as SettingsIcon, Sparkles, Type } from 'lucide-react';
import ThemeToggle from '@/src/components/ThemeToggle';
import SettingsPanel from '@/src/components/SettingsPanel';
import AIPanelSlot from '@/src/components/AIPanelSlot';
import FloatingToolbar from '@/src/components/FloatingToolbar';
import TocDrawer from '@/src/components/TocDrawer';
import TypographyPopover, {
  DEFAULT_TYPOGRAPHY,
  type TypographyState,
} from '@/src/components/TypographyPopover';
import { getStoredConfig } from '@/src/lib/ai-config';
import { getReadingContentId } from '@/src/lib/chat-storage';
import { scrollProgress } from '@/src/lib/reading';
import { currentSectionIndex, deriveToc } from '@/src/lib/toc';
import {
  READING_CONTENT_KEY,
  READING_TITLE_KEY,
  READING_TYPE_KEY,
} from '@/src/lib/reading';
import {
  COMMAND_EVENT,
  clearPendingCommand,
  emitCommand,
  readPendingCommand,
  type CommandTarget,
} from '@/src/lib/command-events';

type ReadState = {
  content: string;
  title: string;
  contentType: 'text' | 'markdown';
} | null;

function readFromSession(): ReadState {
  if (typeof window === 'undefined') return null;
  const stored = sessionStorage.getItem(READING_CONTENT_KEY);
  if (!stored) return null;
  const storedTitle = sessionStorage.getItem(READING_TITLE_KEY);
  const storedType = sessionStorage.getItem(READING_TYPE_KEY);
  return {
    content: stored,
    title: storedTitle || '未命名文本',
    contentType: storedType === 'markdown' ? 'markdown' : 'text',
  };
}

/**
 * Hydration gate (React #418 fix): the reading state and config presence live
 * in sessionStorage/localStorage, so the server renders the empty shell and
 * the first client render must match it exactly. Only after mount do we read
 * storage and render the real page — no SSR/client mismatch, and the shell is
 * visually the same container so nothing flickers wrong content.
 */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const idle = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(idle);
  }, []);
  return mounted;
}

/**
 * 阅读页外壳（设计板 03 外壳部分）：沉浸顶栏（下滑淡出、上滑/鼠标移近顶部
 * 重现）、目录抽屉、排版弹层、划选工具条（FloatingToolbar）、底部章节 +
 * 进度细条。AI 面板通过 AIPanelSlot 挂载（泳道 B 领地）。
 */
export default function ReadPage() {
  const router = useRouter();
  const mounted = useMounted();
  const [state, setState] = useState<ReadState>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [selectedText, setSelectedText] = useState<string | undefined>();
  const [tocOpen, setTocOpen] = useState(false);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [typography, setTypography] = useState<TypographyState>(DEFAULT_TYPOGRAPHY);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [percent, setPercent] = useState(0);
  const [sectionIndex, setSectionIndex] = useState(0);
  const readingAreaRef = useRef<HTMLElement>(null);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const idle = window.requestAnimationFrame(() => {
      setState(readFromSession());
      setHasConfig(getStoredConfig() !== null);
    });
    return () => window.cancelAnimationFrame(idle);
  }, []);

  // A command raised while this page is open arrives as a window event.
  useEffect(() => {
    function onCommand(event: Event) {
      const target = (event as CustomEvent<CommandTarget>).detail;
      if (!target) return;
      if (target.kind === 'settings') {
        setSettingsOpen(true);
        return;
      }
      // The stored copy is dropped here as well: the target was handed over,
      // so it must not fire again on a later visit.
      clearPendingCommand();
      setAiPanelOpen(true);
    }
    window.addEventListener(COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(COMMAND_EVENT, onCommand);
  }, []);

  // A command raised on another page arrives as a stored copy, because the
  // reading page was not mounted yet when it was raised. It is handed over
  // once the AI panel has mounted and can listen for it.
  useEffect(() => {
    if (!state) return;
    const pending = readPendingCommand();
    if (!pending) return;
    clearPendingCommand();
    emitCommand(pending);
  }, [state]);

  useEffect(() => {
    if (mounted && !state) {
      router.push('/');
    }
  }, [mounted, state, router]);

  const sections = useMemo(
    () => (state ? deriveToc(state.content, state.contentType) : []),
    [state],
  );

  // The immersive top bar: fade out on scroll down, return on scroll up.
  const handleScroll = useCallback(() => {
    const area = readingAreaRef.current;
    if (!area) return;
    const y = area.scrollTop;
    setHeaderHidden(y > 80 && y > lastScrollTopRef.current);
    lastScrollTopRef.current = y;

    setPercent(scrollProgress(y, area.scrollHeight, area.clientHeight));
    const offsets = Array.from(area.querySelectorAll('[data-toc-section]')).map(
      (el) => (el as HTMLElement).offsetTop,
    );
    setSectionIndex(currentSectionIndex(offsets, y));
  }, []);

  // 鼠标移近页面顶部时顶栏重现（spec §3.1）。
  function handleMouseMove(event: React.MouseEvent) {
    if (event.clientY <= 64) setHeaderHidden(false);
  }

  function jumpToSection(index: number) {
    const area = readingAreaRef.current;
    const target = area?.querySelectorAll<HTMLElement>('[data-toc-section]')[index];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (!mounted || !state) {
    return null;
  }

  const { content, title, contentType } = state;

  function handleAskDeer(text: string) {
    setSelectedText(text);
    setAiPanelOpen(true);
  }

  function renderSection(section: (typeof sections)[number], i: number) {
    const isSingleFullText = sections.length === 1;
    return (
      <section key={`${i}-${section.title}`} data-toc-section={i} className="mb-10 scroll-mt-6">
        {!isSingleFullText && (
          <h2 className="mb-6 text-center text-xl font-semibold text-[var(--text)]">
            {section.title}
          </h2>
        )}
        {contentType === 'markdown' ? (
          <div className="markdown-content">
            <ReactMarkdown>{section.body}</ReactMarkdown>
          </div>
        ) : (
          <div className="text-content">
            {section.body
              .split(/\n\s*\n/)
              .map((p, j) => (
                <p key={j}>{p.trim()}</p>
              ))}
          </div>
        )}
      </section>
    );
  }

  const headerButtonClass =
    'flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-2)] transition-colors duration-[var(--dur-micro)] hover:bg-[var(--hover-bg)] hover:text-[var(--text)]';

  return (
    <div
      className="flex h-screen flex-col bg-[var(--bg)] text-[var(--text)]"
      onMouseMove={handleMouseMove}
    >
      <header
        className={`sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/95 px-4 backdrop-blur transition-[transform,opacity] duration-[var(--dur-overlay)] ease-[var(--ease-out)] ${
          headerHidden ? 'pointer-events-none -translate-y-full opacity-0' : 'translate-y-0 opacity-100'
        }`}
        aria-hidden={headerHidden}
      >
        <button
          type="button"
          onClick={() => router.push('/')}
          aria-label="返回书架"
          className={headerButtonClass}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-4 text-center text-base font-medium">{title}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTocOpen(true)}
            aria-label="目录"
            className={headerButtonClass}
          >
            <List className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setTypographyOpen((v) => !v)}
              aria-label="排版设置"
              aria-expanded={typographyOpen}
              className={headerButtonClass}
            >
              <Type className="h-5 w-5" aria-hidden="true" />
            </button>
            <TypographyPopover
              open={typographyOpen}
              value={typography}
              onChange={setTypography}
              onClose={() => setTypographyOpen(false)}
            />
          </div>
          <button
            type="button"
            onClick={() => setAiPanelOpen(!aiPanelOpen)}
            aria-label={aiPanelOpen ? '收起 AI 面板' : '展开 AI 面板'}
            className={`${headerButtonClass} ${aiPanelOpen ? 'text-[var(--primary-deep)]' : ''}`}
          >
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="打开 AI 模型设置"
            className={headerButtonClass}
          >
            <SettingsIcon className="h-5 w-5" aria-hidden="true" />
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main
          className="relative min-w-0 flex-1 overflow-y-auto"
          role="main"
          aria-label="阅读区域"
          ref={readingAreaRef}
          onScroll={handleScroll}
        >
          <div
            className="mx-auto px-6 py-12"
            style={{
              maxWidth: `${typography.pageWidth}em`,
              fontSize: `${typography.fontSize}px`,
              lineHeight: typography.lineHeight,
            }}
          >
            {sections.map((section, i) => renderSection(section, i))}
          </div>
          {hasConfig && (
            <FloatingToolbar
              onAskDeer={handleAskDeer}
              containerRef={readingAreaRef}
              contentId={getReadingContentId(content)}
              sourceLabel={title}
            />
          )}
        </main>

        <AIPanelSlot
          isOpen={aiPanelOpen}
          onClose={() => setAiPanelOpen(false)}
          readingContent={content}
          selectedText={selectedText}
          onClearSelection={() => setSelectedText(undefined)}
        />
      </div>

      <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)] px-6 py-2">
        <div
          className="mb-1.5 h-0.5 w-full overflow-hidden rounded-full bg-[var(--border)]"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="阅读进度"
        >
          <div
            className="h-full bg-[var(--primary)] transition-[width] duration-[var(--dur-micro)]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--text-2)]">
          <span className="truncate">
            {sections[sectionIndex]?.title ?? sections[0]?.title ?? ''}
          </span>
          <span className="tabular-nums">{percent}%</span>
        </div>
      </footer>

      <TocDrawer
        open={tocOpen}
        bookTitle={title}
        sections={sections}
        currentIndex={sectionIndex}
        onJump={jumpToSection}
        onClose={() => setTocOpen(false)}
      />

      <SettingsPanel isOpen={settingsOpen} onClose={() => {
        setSettingsOpen(false);
        setHasConfig(getStoredConfig() !== null);
      }} />
    </div>
  );
}
