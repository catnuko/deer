'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Search } from 'lucide-react';
import ThemeToggle from '@/src/components/ThemeToggle';
import SettingsPanel from '@/src/components/SettingsPanel';
import AppSidebar from '@/src/components/AppSidebar';
import BookCard, { type BookMenuAction } from '@/src/components/BookCard';
import ContinueReadingCard from '@/src/components/ContinueReadingCard';
import ImportDialog from '@/src/components/ImportDialog';
import {
  ImportFailedCard,
  SearchEmptyState,
  ShelfEmptyState,
  SkeletonBookCard,
} from '@/src/components/ShelfStateCards';
import {
  demoContentFor,
  filterBooks,
  formatRelativeTime,
  pickContinueReading,
  SEED_BOOKS,
  sortBooks,
  type Book,
  type ShelfSort,
} from '@/src/lib/bookshelf';
import {
  READING_CONTENT_KEY,
  READING_TITLE_KEY,
  READING_TYPE_KEY,
} from '@/src/lib/reading';
import { COMMAND_EVENT, type CommandTarget } from '@/src/lib/command-events';

type ImportPhase = 'idle' | 'importing' | 'failed';

let importSeq = 0;

/**
 * 首页书架（设计板 02）：220px 侧栏 + 搜索/排序 + 继续阅读 + 全部书籍网格。
 * 书目为可演示种子（见 bookshelf.ts）；导入的文本仍写入既有 sessionStorage
 * 阅读契约后进入阅读页。
 */
export default function Home() {
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>(SEED_BOOKS);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ShelfSort>('recent');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPhase, setImportPhase] = useState<ImportPhase>('idle');
  const [failedFileName, setFailedFileName] = useState<string | null>(null);
  const pendingFileRef = useRef<File | null>(null);

  // The ⌘K palette can raise the settings panel of the page that is open.
  useEffect(() => {
    function onCommand(event: Event) {
      const target = (event as CustomEvent<CommandTarget>).detail;
      if (target?.kind !== 'settings') return;
      setSettingsOpen(true);
    }
    window.addEventListener(COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(COMMAND_EVENT, onCommand);
  }, []);

  const continueReading = useMemo(() => pickContinueReading(books), [books]);
  const visibleBooks = useMemo(
    () => sortBooks(filterBooks(books, query), sort),
    [books, query, sort],
  );
  const showShelfEmpty = books.length === 0;
  const showSearchEmpty = !showShelfEmpty && query.trim() !== '' && visibleBooks.length === 0;

  function openBook(book: Book) {
    // 既有阅读契约：正文写入 sessionStorage 后由 /read 读取。
    sessionStorage.setItem(READING_CONTENT_KEY, demoContentFor(book));
    sessionStorage.setItem(READING_TITLE_KEY, book.title);
    sessionStorage.setItem(READING_TYPE_KEY, 'text');
    router.push('/read');
  }

  function handleMenuAction(book: Book, action: BookMenuAction) {
    if (action === 'continue') {
      openBook(book);
      return;
    }
    if (action === 'finish') {
      setBooks((prev) => prev.map((b) => (b.id === book.id ? { ...b, progress: 100 } : b)));
      return;
    }
    if (action === 'remove') {
      // 移除需二次确认（spec §2.2）。
      if (window.confirm(`确定从书架移除《${book.title}》吗？`)) {
        setBooks((prev) => prev.filter((b) => b.id !== book.id));
      }
    }
  }

  function startFromText(text: string, fileName: string | null) {
    // The keys come from the shared contract, so the writing side and the
    // reading side can never drift apart on the storage key.
    sessionStorage.setItem(READING_CONTENT_KEY, text);
    sessionStorage.setItem(READING_TITLE_KEY, fileName || '未命名文本');
    sessionStorage.setItem(READING_TYPE_KEY, fileName?.endsWith('.md') ? 'markdown' : 'text');
    setImportOpen(false);
    router.push('/read');
  }

  function readFile(file: File) {
    pendingFileRef.current = file;
    setImportOpen(false);
    setFailedFileName(null);
    setImportPhase('importing');
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      importSeq += 1;
      const imported: Book = {
        id: `imported-${Date.now()}-${importSeq}`,
        title: file.name.replace(/\.(txt|md)$/i, ''),
        author: '导入的书籍',
        progress: 0,
        lastReadHoursAgo: null,
      };
      sessionStorage.setItem(READING_CONTENT_KEY, content);
      sessionStorage.setItem(READING_TITLE_KEY, imported.title);
      sessionStorage.setItem(READING_TYPE_KEY, file.name.endsWith('.md') ? 'markdown' : 'text');
      setBooks((prev) => [imported, ...prev]);
      setImportPhase('idle');
    };
    reader.onerror = () => {
      setImportPhase('failed');
      setFailedFileName(file.name);
    };
    reader.readAsText(file);
  }

  function retryImport() {
    const file = pendingFileRef.current;
    if (file) {
      readFile(file);
      return;
    }
    setImportPhase('idle');
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <AppSidebar
        active="shelf"
        onOpenSettings={() => setSettingsOpen(true)}
        onImport={() => setImportOpen(true)}
      />

      <main className="min-w-0 flex-1 px-8 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="relative w-[420px] max-w-full">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-2)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书名或作者"
              aria-label="搜索书名或作者"
              className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] pl-9 pr-12 text-sm text-[var(--text)] placeholder:text-[var(--text-2)] focus:border-[var(--primary)] focus:outline-none"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-2)]">
              ⌘K
            </kbd>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
              排序
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as ShelfSort)}
                aria-label="书籍排序方式"
                className="h-9 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--text)] focus:outline-none"
              >
                <option value="recent">最近阅读</option>
                <option value="added">添加时间</option>
                <option value="title">书名</option>
              </select>
            </label>
            <span
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--primary-deep)] text-[var(--primary-deep)]"
              aria-label="网格视图"
              title="网格视图"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </span>
            <ThemeToggle />
          </div>
        </div>

        {importPhase === 'importing' && (
          <section aria-label="导入中" className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">正在导入…</h2>
            <div className="flex flex-wrap gap-6">
              <SkeletonBookCard />
              <SkeletonBookCard />
            </div>
          </section>
        )}

        {importPhase === 'failed' && (
          <section aria-label="导入失败" className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">导入书籍</h2>
            <div className="flex flex-wrap gap-6">
              <ImportFailedCard
                fileName={failedFileName}
                onRetry={retryImport}
                onDismiss={() => setImportPhase('idle')}
              />
            </div>
          </section>
        )}

        {continueReading.length > 0 && !showShelfEmpty && (
          <section aria-label="继续阅读" className="mb-8">
            <h2 className="mb-3 text-xl font-semibold">继续阅读</h2>
            <div className="flex flex-wrap gap-6">
              {continueReading.map((book) => (
                <ContinueReadingCard
                  key={book.id}
                  book={book}
                  lastReadLabel={formatRelativeTime(book.lastReadHoursAgo)}
                  onOpen={openBook}
                />
              ))}
            </div>
          </section>
        )}

        <section aria-label="全部书籍">
          <h2 className="mb-3 text-xl font-semibold">全部书籍</h2>
          {showShelfEmpty ? (
            <ShelfEmptyState onImport={() => setImportOpen(true)} />
          ) : showSearchEmpty ? (
            <SearchEmptyState query={query} onClear={() => setQuery('')} />
          ) : (
            <div className="flex flex-wrap gap-6">
              {visibleBooks.map((book) => (
                <BookCard key={book.id} book={book} onOpen={openBook} onMenuAction={handleMenuAction} />
              ))}
            </div>
          )}
        </section>
      </main>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onStartFromText={startFromText}
        onFileSelected={readFile}
      />
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
