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

type CaptureState = 'idle' | 'saved' | 'cap' | 'quota';

export default function FloatingToolbar({
  onAskDeer,
  containerRef,
  contentId,
  sourceLabel,
}: FloatingToolbarProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [captureState, setCaptureState] = useState<CaptureState>('idle');
  // The hint outlives the render that set it, so the reset timer is kept in a ref.
  const captureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function handleMouseUp() {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (!text || text.length < 2) {
        setPosition(null);
        setSelectedText('');
        return;
      }

      // Check if selection is within the reading container
      if (containerRef.current && selection?.anchorNode) {
        if (!containerRef.current.contains(selection.anchorNode)) {
          setPosition(null);
          setSelectedText('');
          return;
        }
      }

      const range = selection?.getRangeAt(0);
      if (!range) return;

      const rect = range.getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
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

  // A capture hint (saved / cap / quota) clears itself after a beat.
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

  function handleAskDeer() {
    if (selectedText) {
      onAskDeer(selectedText);
      setPosition(null);
      setSelectedText('');
      window.getSelection()?.removeAllRanges();
    }
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

  if (!position) return null;

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
      <div className="floating-toolbar-actions">
        <button
          className="ask-deer-btn"
          onClick={handleAskDeer}
          type="button"
          aria-label="问 Deer"
        >
          🦌 问 Deer
        </button>
        <button
          className="capture-btn"
          onClick={handleCapture}
          type="button"
          aria-label="收藏笔记"
        >
          🔖 收藏笔记
        </button>
      </div>
      {captureState !== 'idle' && (
        <p className="floating-toolbar-hint" role="status" aria-live="polite">
          {captureState === 'saved'
            ? '✓ 已收藏'
            : captureState === 'cap'
              ? `已达上限，删除一些笔记后才能继续收藏`
              : '收藏失败，笔记未保存'}
        </p>
      )}
    </div>
  );
}
