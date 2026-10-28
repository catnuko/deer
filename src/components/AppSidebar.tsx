'use client';

import { BookOpen, Import, Settings, StickyNote } from 'lucide-react';
import { AntlerIcon } from '@/src/components/AntlerIcon';

interface AppSidebarProps {
  active: 'shelf' | 'notes';
  onOpenSettings: () => void;
  onImport: () => void;
}

/**
 * 左侧固定导航（设计板 02：宽 220px，暖纸底 + 右描边；底部「导入书籍」
 * 主按钮）。笔记页尚未实现，导航项先占位。
 */
export default function AppSidebar({ active, onOpenSettings, onImport }: AppSidebarProps) {
  const itemClass = (isActive: boolean) =>
    `flex h-10 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors duration-[var(--dur-micro)] ${
      isActive
        ? 'border-l-[3px] border-[var(--primary)] bg-[var(--hover-bg)] font-medium text-[var(--primary-deep)]'
        : 'border-l-[3px] border-transparent text-[var(--text)] hover:bg-[var(--hover-bg)]'
    }`;

  return (
    <aside
      className="flex h-screen w-[220px] shrink-0 flex-col justify-between border-r border-[var(--border)] bg-[var(--bg)] px-3 py-4"
      aria-label="站点导航"
    >
      <div>
        <div className="mb-8 flex items-center gap-3 px-1">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-control)] bg-[var(--primary)] text-white">
            <AntlerIcon className="h-7 w-7" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight text-[var(--text)]">Deer</p>
            <p className="text-xs text-[var(--text-2)]">有 AI 伴读的阅读器</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          <button type="button" className={itemClass(active === 'shelf')} aria-current={active === 'shelf' ? 'page' : undefined}>
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            书架
          </button>
          <button type="button" className={itemClass(active === 'notes')} aria-disabled="true">
            <StickyNote className="h-4 w-4" aria-hidden="true" />
            笔记
          </button>
          <button type="button" className={itemClass(false)} onClick={onOpenSettings}>
            <Settings className="h-4 w-4" aria-hidden="true" />
            设置
          </button>
        </nav>
      </div>
      <button
        type="button"
        onClick={onImport}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--primary)] text-sm font-medium text-white transition-colors duration-[var(--dur-micro)] hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]"
      >
        <Import className="h-4 w-4" aria-hidden="true" />
        导入书籍
      </button>
    </aside>
  );
}
