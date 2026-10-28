'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { TocSection } from '@/src/lib/toc';

interface TocDrawerProps {
  open: boolean;
  bookTitle: string;
  sections: TocSection[];
  currentIndex: number;
  onJump: (index: number) => void;
  onClose: () => void;
}

/**
 * 目录抽屉（spec §3.2：左侧滑出 300px，当前章节主色左竖条 3px 高亮，
 * 点击跳转并关闭）。
 */
export default function TocDrawer({
  open,
  bookTitle,
  sections,
  currentIndex,
  onJump,
  onClose,
}: TocDrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[900]" role="presentation" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="目录"
        className="absolute left-0 top-0 flex h-full w-[300px] flex-col border-r border-[var(--border)] bg-[var(--surface)] shadow-[8px_0_24px_rgba(0,0,0,0.1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--text)]">{bookTitle}</p>
            <p className="text-xs text-[var(--text-2)]">目录 · 共 {sections.length} 章</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭目录"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-2)] hover:bg-[var(--hover-bg)] hover:text-[var(--text)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2" aria-label="章节列表">
          {sections.map((section, i) => (
            <button
              key={`${i}-${section.title}`}
              type="button"
              onClick={() => {
                onJump(i);
                onClose();
              }}
              aria-current={i === currentIndex ? 'true' : undefined}
              className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors duration-[var(--dur-micro)] ${
                i === currentIndex
                  ? 'border-l-[3px] border-[var(--primary)] bg-[var(--hover-bg)] font-medium text-[var(--primary-deep)]'
                  : 'border-l-[3px] border-transparent text-[var(--text)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{section.title}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
