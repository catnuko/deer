'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  coverInitial,
  formatProgress,
  type Book,
  isUnread,
} from '@/src/lib/bookshelf';

export type BookMenuAction = 'continue' | 'finish' | 'remove';

interface BookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  onMenuAction: (book: Book, action: BookMenuAction) => void;
}

/**
 * 全部书籍网格卡（设计板 02：271×280 语言、圆角 12、封面占位 pLight、
 * 底部进度条；hover 上浮 -2px + 阴影 + 右上角 ⋯ 下拉，破坏性红字）。
 */
export default function BookCard({ book, onOpen, onMenuAction }: BookCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      ref={rootRef}
      className="group relative flex h-[280px] w-[271px] cursor-pointer flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] transition-[transform,box-shadow] duration-[var(--dur-micro)] hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
      onClick={() => onOpen(book)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(book);
        }
      }}
      aria-label={`《${book.title}》${book.author}，进度 ${formatProgress(book.progress)}`}
    >
      <button
        type="button"
        aria-label={`《${book.title}》更多操作`}
        className={`absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] bg-[var(--surface)]/90 text-[var(--text-2)] opacity-0 transition-opacity duration-[var(--dur-micro)] hover:bg-[var(--hover-bg)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100 ${menuOpen ? 'opacity-100' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-2 top-11 z-20 w-[168px] overflow-hidden rounded-[var(--radius-menu)] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--hover-bg)]"
            onClick={() => {
              setMenuOpen(false);
              onMenuAction(book, 'continue');
            }}
          >
            继续阅读
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--hover-bg)]"
            onClick={() => {
              setMenuOpen(false);
              onMenuAction(book, 'finish');
            }}
          >
            标记完成
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-bg)]"
            onClick={() => {
              setMenuOpen(false);
              onMenuAction(book, 'remove');
            }}
          >
            从书架移除
          </button>
        </div>
      )}

      {isUnread(book) && (
        <span className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-[var(--surface)]/90 px-2 py-0.5 text-xs text-[var(--primary-deep)]">
          未读
          <span className="h-2 w-2 rounded-full bg-[var(--primary)]" aria-hidden="true" />
        </span>
      )}

      <div className="flex flex-1 items-center justify-center bg-[var(--primary-light)]">
        <span className="text-6xl font-medium text-[var(--primary-deep)]" aria-hidden="true">
          {coverInitial(book.title)}
        </span>
      </div>
      <div className="border-t border-[var(--border)] px-4 py-3">
        <p className="truncate text-sm font-medium text-[var(--text)]">{book.title}</p>
        <p className="truncate text-xs text-[var(--text-2)]">{book.author}</p>
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--border)]"
            role="progressbar"
            aria-valuenow={book.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`《${book.title}》阅读进度`}
          >
            <div
              className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-[var(--dur-overlay)]"
              style={{ width: `${Math.min(Math.max(book.progress, 0), 100)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[var(--text-2)]">
            {formatProgress(book.progress)}
          </span>
        </div>
      </div>
    </div>
  );
}
