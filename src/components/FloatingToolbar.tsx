'use client';

import { useEffect, useState } from 'react';

interface FloatingToolbarProps {
  onAskDeer: (selectedText: string) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

export default function FloatingToolbar({ onAskDeer, containerRef }: FloatingToolbarProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');

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

  function handleAskDeer() {
    if (selectedText) {
      onAskDeer(selectedText);
      setPosition(null);
      setSelectedText('');
      window.getSelection()?.removeAllRanges();
    }
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
      <button
        className="ask-deer-btn"
        onClick={handleAskDeer}
        type="button"
        aria-label="问 Deer"
      >
        🦌 问 Deer
      </button>
    </div>
  );
}
