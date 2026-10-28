'use client';

import { useEffect, useRef, useState } from 'react';
import { createNote } from '@/src/lib/notes';

interface FloatingToolbarProps {
  onAskDeer: (selectedText: string) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  /** The id Deer derives from the reading text; the captured note is tagged with it. */
  contentId: string;
  /** The reading title, used as the note's source label. */
  sourceLabel: string;
}

type CaptureState = 'idle' | 'saved' | 'cap' | 'quota' | 'copied' | 'copy-failed';

/** 高亮 5 色（spec §1.1：黄绿蓝粉紫，内容标注色，与主色无关）。 */
export const HIGHLIGHT_COLORS = ['#FDE68A', '#A7F3D0', '#BFDBFE', '#FBCFE8', '#DDD6FE'];

/** 在选区范围外套一层高亮 span；跨节点选区失败时静默放弃（外壳演示能力）。 */
function wrapRangeWithHighlight(range: Range, color: string): boolean {
  try {
    const span = document.createElement('span');
    span.className = 'deer-highlight';
    span.style.backgroundColor = color;
    range.surroundContents(span);
    return true;
  } catch {
    return false;
  }
}

/** 清除容器内全部演示高亮（拆掉 span 保留文本）。 */
function clearHighlights(container: HTMLElement | null): number {
  if (!container) return 0;
  const marks = container.querySelectorAll('span.deer-highlight');
  let removed = 0;
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    removed += 1;
  });
  return removed;
}

/**
 * 划选工具条（设计板 03 特写：深墨底 #111827、高 44、圆角 8、阴影
 * 0 8px 24px rgba(0,0,0,.2)；「问 AI」主色块；高亮点开 5 色板 + 清除，
 * 20px 圆形 swatch；笔记走既有收藏流程；复制 + toast）。
 */
export default function FloatingToolbar({
  onAskDeer,
  containerRef,
  contentId,
  sourceLabel,
}: FloatingToolbarProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureState>('idle');
  // The hint outlives the render that set it, so the reset timer is kept in a ref.
  const captureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rangeRef = useRef<Range | null>(null);

  useEffect(() => {
    function handleMouseUp() {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (!text || text.length < 2) {
        setPosition(null);
        setSelectedText('');
        setPaletteOpen(false);
        rangeRef.current = null;
        return;
      }

      // Check if selection is within the reading container
      if (containerRef.current && selection?.anchorNode) {
        if (!containerRef.current.contains(selection.anchorNode)) {
          setPosition(null);
          setSelectedText('');
          setPaletteOpen(false);
          rangeRef.current = null;
          return;
        }
      }

      const range = selection?.getRangeAt(0);
      if (!range) return;

      rangeRef.current = range.cloneRange();
      const rect = range.getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      });
      setSelectedText(text);
    }

    function handleMouseDown() {
      // Don't clear immediately to allow the selection to complete
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection?.toString().trim()) {
          setPosition(null);
          setSelectedText('');
          setPaletteOpen(false);
          rangeRef.current = null;
        }
      }, 10);
    }

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [containerRef]);

  // A capture hint (saved / cap / quota / copied) clears itself after a beat.
  function flashCapture(next: CaptureState) {
    setCaptureState(next);
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(() => setCaptureState('idle'), 1500);
  }

  useEffect(() => {
    return () => {
      if (captureTimer.current) clearTimeout(captureTimer.current);
    };
  }, []);

  function dismiss() {
    setPosition(null);
    setSelectedText('');
    setPaletteOpen(false);
    rangeRef.current = null;
    window.getSelection()?.removeAllRanges();
  }

  function handleAskDeer() {
    if (selectedText) {
      onAskDeer(selectedText);
      dismiss();
    }
  }

  function handleHighlight(color: string) {
    const range = rangeRef.current;
    if (range) {
      wrapRangeWithHighlight(range, color);
    }
    dismiss();
  }

  function handleClearHighlight() {
    clearHighlights(containerRef.current);
    dismiss();
  }

  function handleCapture() {
    if (!selectedText.trim()) return;
    const result = createNote({
      selection: selectedText,
      sourceContentId: contentId,
      sourceLabel,
    });
    if (!result.ok) {
      // The library reports why: the 200-note cap, or a quota write failure.
      flashCapture(result.reason === 'cap' ? 'cap' : 'quota');
      return;
    }
    flashCapture('saved');
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(selectedText);
      flashCapture('copied');
    } catch {
      flashCapture('copy-failed');
    }
  }

  if (!position) return null;

  const buttonClass =
    'flex h-11 items-center rounded-[6px] px-3 text-sm text-white transition-colors duration-[var(--dur-micro)] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#F5C57A]';

  return (
    <div
      className="floating-toolbar"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div
        role="toolbar"
        aria-label="划选操作"
        className="flex h-11 items-center gap-0.5 rounded-[var(--radius-control)] bg-[#111827] px-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
      >
        <button
          type="button"
          onClick={handleAskDeer}
          className={`${buttonClass} bg-[var(--primary)] hover:bg-[var(--primary-hover)]`}
          aria-label="问 AI"
        >
          问 AI
        </button>
        <button
          type="button"
          onClick={() => setPaletteOpen((v) => !v)}
          aria-expanded={paletteOpen}
          aria-label="高亮"
          className={buttonClass}
        >
          高亮
        </button>
        <button type="button" onClick={handleCapture} aria-label="笔记" className={buttonClass}>
          笔记
        </button>
        <button type="button" onClick={handleCopy} aria-label="复制" className={buttonClass}>
          复制
        </button>
      </div>

      {paletteOpen && (
        <div
          className="mt-1.5 flex h-11 w-max items-center gap-2 rounded-[var(--radius-control)] bg-[#111827] px-3 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
          role="group"
          aria-label="高亮颜色"
        >
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => handleHighlight(color)}
              aria-label={`高亮颜色 ${color}`}
              className="h-5 w-5 rounded-full border border-white/30 transition-transform duration-[var(--dur-micro)] hover:scale-110"
              style={{ backgroundColor: color }}
            />
          ))}
          <button
            type="button"
            onClick={handleClearHighlight}
            className="ml-1 text-sm text-white/80 transition-colors duration-[var(--dur-micro)] hover:text-white"
            aria-label="清除高亮"
          >
            清除
          </button>
        </div>
      )}

      {captureState !== 'idle' && (
        <p className="floating-toolbar-hint" role="status" aria-live="polite">
          {captureState === 'saved'
            ? '✓ 已收藏'
            : captureState === 'copied'
              ? '✓ 已复制'
              : captureState === 'copy-failed'
                ? '复制失败'
                : captureState === 'cap'
                  ? '已达上限，删除一些笔记后才能继续收藏'
                  : '收藏失败，笔记未保存'}
        </p>
      )}
    </div>
  );
}
