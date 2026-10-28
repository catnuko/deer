'use client';

import { AntlerIcon } from '@/src/components/AntlerIcon';

/** 骨架屏卡（shimmer 1.5s 循环，导入中的占位）。 */
export function SkeletonBookCard() {
  return (
    <div
      className="flex h-[280px] w-[271px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]"
      aria-hidden="true"
    >
      <div className="deer-shimmer flex-1 bg-[var(--hover-bg)]" />
      <div className="space-y-2 border-t border-[var(--border)] px-4 py-3">
        <div className="deer-shimmer h-4 w-3/4 rounded bg-[var(--hover-bg)]" />
        <div className="deer-shimmer h-3 w-1/2 rounded bg-[var(--hover-bg)]" />
        <div className="deer-shimmer h-1 w-full rounded bg-[var(--hover-bg)]" />
      </div>
    </div>
  );
}

interface ImportFailedCardProps {
  fileName: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}

/** 导入失败卡（红描边 + 失败原因 + 重试）。 */
export function ImportFailedCard({ fileName, onRetry, onDismiss }: ImportFailedCardProps) {
  return (
    <div
      role="alert"
      className="flex h-[280px] w-[271px] flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-[var(--danger)] bg-[var(--surface)] p-4 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-control)] bg-[var(--danger-bg)]">
        <span className="text-2xl text-[var(--danger)]" aria-hidden="true">
          ⚠
        </span>
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--danger)]">导入失败</p>
        <p className="mt-1 break-all text-xs text-[var(--text-2)]">
          {fileName ? `《${fileName}》读取失败，请重试` : '文件读取失败，请重试'}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="h-9 rounded-[var(--radius-control)] bg-[var(--primary)] px-4 text-sm text-white transition-colors duration-[var(--dur-micro)] hover:bg-[var(--primary-hover)]"
        >
          重试
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="h-9 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] transition-colors duration-[var(--dur-micro)] hover:bg-[var(--hover-bg)]"
        >
          忽略
        </button>
      </div>
    </div>
  );
}

interface ShelfEmptyStateProps {
  onImport: () => void;
}

/** 书架空态：插画位 + 主按钮 + 说明。 */
export function ShelfEmptyState({ onImport }: ShelfEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] py-20 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-deep)]">
        <AntlerIcon className="h-10 w-10" />
      </div>
      <p className="text-lg font-medium text-[var(--text)]">书架还是空的</p>
      <p className="text-sm text-[var(--text-2)]">支持 epub / txt（当前版本支持 txt / md）</p>
      <button
        type="button"
        onClick={onImport}
        className="h-10 rounded-[var(--radius-control)] bg-[var(--primary)] px-6 text-sm font-medium text-white transition-colors duration-[var(--dur-micro)] hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]"
      >
        导入第一本书
      </button>
    </div>
  );
}

interface SearchEmptyStateProps {
  query: string;
  onClear: () => void;
}

/** 搜索无结果空态。 */
export function SearchEmptyState({ query, onClear }: SearchEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] py-16 text-center">
      <p className="text-sm text-[var(--text)]">没有找到与「{query}」匹配的书籍</p>
      <button
        type="button"
        onClick={onClear}
        className="h-9 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] transition-colors duration-[var(--dur-micro)] hover:bg-[var(--hover-bg)]"
      >
        清除搜索
      </button>
    </div>
  );
}
