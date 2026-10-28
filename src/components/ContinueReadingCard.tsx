'use client';

import { coverInitial, formatProgress, type Book } from '@/src/lib/bookshelf';

interface ContinueReadingCardProps {
  book: Book;
  lastReadLabel: string;
  onOpen: (book: Book) => void;
}

/**
 * 继续阅读卡（设计板 02：364×104、白底圆角 12、56×56 封面占位、
 * 底部进度条、meta 次级色 #78716C）。
 */
export default function ContinueReadingCard({ book, lastReadLabel, onOpen }: ContinueReadingCardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(book)}
      className="flex h-[104px] w-[364px] items-stretch gap-3 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-[transform,box-shadow] duration-[var(--dur-micro)] hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
      aria-label={`继续阅读《${book.title}》，进度 ${formatProgress(book.progress)}，${lastReadLabel}`}
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--primary-light)]">
        <span className="text-2xl font-medium text-[var(--primary-deep)]" aria-hidden="true">
          {coverInitial(book.title)}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="truncate text-sm font-medium text-[var(--text)]">{book.title}</p>
        <p className="truncate text-xs text-[var(--text-2)]">{book.author}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--border)]"
            role="progressbar"
            aria-valuenow={book.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`《${book.title}》阅读进度`}
          >
            <div
              className="h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${Math.min(Math.max(book.progress, 0), 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-[var(--text-2)]">{formatProgress(book.progress)}</span>
        </div>
        <p className="mt-1 text-xs text-[var(--text-2)]">{lastReadLabel}</p>
      </div>
    </button>
  );
}
