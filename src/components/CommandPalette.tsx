'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Command as CommandPrimitive } from 'cmdk';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/src/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { listSessions, type StoredSession } from '@/src/lib/chat-storage';
import { listNotes, type StoredNote } from '@/src/lib/notes';
import { formatSessionTime, sessionSummary } from '@/src/lib/session-display';
import { dispatchCommand } from '@/src/lib/command-events';
import { commandTextFilter } from '@/src/lib/command-filter';
import { hasReadingContent, READING_TITLE_KEY, READING_TYPE_KEY } from '@/src/lib/reading';
import {
  getStoredThemePreference,
  applyThemePreference,
} from '@/src/lib/theme';
import {
  BookOpenIcon,
  FileUpIcon,
  MessageSquarePlusIcon,
  MessageSquareTextIcon,
  NotebookPenIcon,
  SearchIcon,
  Settings2Icon,
} from 'lucide-react';

/**
 * The global ⌘K palette.
 *
 * It lists what Deer actually holds — the stored chat sessions
 * (`deer-chat-sessions`), the stored concept notes (`deer-notes`) and the
 * pages of the app — and runs the picked entry against the real data. The
 * lists are read from storage every time the palette opens, so a session
 * written in another tab is already there.
 *
 * A stored session and a stored note are both shown next to the text they
 * belong to, and the text itself lives only in the tab that opened it. When
 * this tab has no text open, the reading page has nothing to show, so those
 * entries are marked and disabled: the palette never pretends that a pick
 * worked when it could not.
 */

interface StoredItems {
  sessions: StoredSession[];
  notes: StoredNote[];
  hasContent: boolean;
  readingTitle: string;
  readingType: string;
}

const EMPTY_STORED: StoredItems = {
  sessions: [],
  notes: [],
  hasContent: false,
  readingTitle: '',
  readingType: '',
};

/** The label that tells the reader why a stored entry cannot be opened. */
const NEEDS_TEXT = '需先打开一篇文本';

function readStoredItems(): StoredItems {
  const hasContent = hasReadingContent();
  return {
    sessions: listSessions(),
    notes: listNotes(),
    hasContent,
    readingTitle: hasContent
      ? (window.sessionStorage.getItem(READING_TITLE_KEY) ?? '').trim()
      : '',
    readingType: hasContent
      ? (window.sessionStorage.getItem(READING_TYPE_KEY) ?? '').trim()
      : '',
  };
}

/**
 * The selected row of the palette: a 3px primary bar on the left and the
 * approved warm highlight (spec §6 v1.2, #F4F1EA). The transparent border
 * keeps every row the same width so the highlight never shifts the text.
 */
const ITEM_CLASS =
  'rounded-sm! border-l-[3px] border-l-transparent data-selected:border-l-[var(--primary)] data-selected:bg-[#F4F1EA]! dark:data-selected:bg-[var(--primary-light)]!';

export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [stored, setStored] = React.useState<StoredItems>(EMPTY_STORED);
  // The palette state is mirrored in a ref so the key handler knows whether it
  // opens or closes the palette without re-subscribing on every render.
  const openRef = React.useRef(false);

  const openPalette = React.useCallback(() => {
    // The stores are read here, in the handler that opens the palette: the
    // entries are never stale and the page itself never pays for the read.
    setStored(readStoredItems());
    openRef.current = true;
    setOpen(true);
  }, []);

  const closePalette = React.useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  const togglePalette = React.useCallback(() => {
    if (openRef.current) {
      closePalette();
      return;
    }
    openPalette();
  }, [closePalette, openPalette]);

  // ⌘K / Ctrl+K opens and closes the palette from anywhere in the app.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      togglePalette();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePalette]);

  // The settings page can hand the theme to the system preference; this
  // component is mounted for the whole app, so it is the place where a
  // 'system' preference keeps following the OS while Deer is open.
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function syncSystemTheme() {
      if (getStoredThemePreference() !== 'system') return;
      applyThemePreference('system');
    }
    syncSystemTheme();
    media.addEventListener('change', syncSystemTheme);
    window.addEventListener('storage', syncSystemTheme);
    return () => {
      media.removeEventListener('change', syncSystemTheme);
      window.removeEventListener('storage', syncSystemTheme);
    };
  }, []);

  function handleOpenChange(next: boolean) {
    if (next) {
      openPalette();
      return;
    }
    closePalette();
  }

  function go(path: string) {
    closePalette();
    router.push(path);
  }

  function openSettings() {
    closePalette();
    // The settings panel belongs to the page that is open, so the panel is
    // raised through the window event instead of a navigation.
    dispatchCommand('settings');
  }

  function openReading() {
    closePalette();
    if (pathname !== '/read') router.push('/read');
  }

  function newSession() {
    closePalette();
    // Without an id this opens the AI panel on the reading page: a fresh
    // conversation in the current book's space.
    dispatchCommand('session');
    if (pathname !== '/read') router.push('/read');
  }

  function focusSession(contentId: string) {
    closePalette();
    dispatchCommand('session', contentId);
    if (pathname !== '/read') router.push('/read');
  }

  function focusNote(noteId: string) {
    closePalette();
    dispatchCommand('note', noteId);
    if (pathname !== '/read') router.push('/read');
  }

  const { sessions, notes, hasContent, readingTitle, readingType } = stored;
  // Without a text open in this tab the reading page has nothing to show, so
  // a stored session or note cannot be opened: the entries say so instead of
  // bouncing the reader back to the start page.
  const needsText = !hasContent;
  const storedItems = sessions.length + notes.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogOverlay className="bg-[#292524]/50 supports-backdrop-filter:backdrop-blur-[2px]" />
      <DialogContent
        showCloseButton={false}
        className="w-[560px]! max-w-[calc(100vw-2rem)]! translate-y-[-50%]! gap-0! overflow-hidden! rounded-[var(--radius-overlay)]! p-0! shadow-[0_8px_24px_rgba(0,0,0,0.2)]!"
      >
        <DialogHeaderFallback />
        <Command filter={commandTextFilter} className="rounded-[var(--radius-overlay)]! p-0!">
          {/* 搜索行：放大镜 + 输入 + ⌘K 角标 */}
          <div className="flex items-center gap-3 border-b border-[var(--sand)] px-4">
            <SearchIcon className="size-4 shrink-0 text-[var(--text-2)]" />
            <CommandPrimitive.Input
              placeholder="搜索书名、笔记或操作…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-2)]"
            />
            <kbd className="shrink-0 rounded-md border border-[var(--sand)] bg-[var(--hover-bg)] px-1.5 py-0.5 text-xs text-[var(--text-2)]">
              ⌘K
            </kbd>
          </div>

          <CommandList className="max-h-[320px] p-1">
            <CommandEmpty className="py-10 text-center">
              <p className="text-sm text-[var(--text)]">没有匹配的结果</p>
              <p className="mt-1 text-xs text-[var(--text-2)]">试试搜索书名或笔记内容</p>
            </CommandEmpty>

            <CommandGroup heading="最近阅读">
              {readingTitle ? (
                <CommandItem
                  value={`${readingTitle} 最近阅读`}
                  keywords={[readingTitle, readingType, '最近阅读', '阅读页']}
                  onSelect={openReading}
                  className={ITEM_CLASS}
                >
                  <BookOpenIcon />
                  <span>{readingTitle}</span>
                  <CommandShortcut>{readingType || '文本'}</CommandShortcut>
                </CommandItem>
              ) : (
                <CommandItem
                  value="阅读页"
                  keywords={['阅读页', '最近阅读']}
                  disabled={needsText}
                  onSelect={openReading}
                  className={ITEM_CLASS}
                >
                  <BookOpenIcon />
                  <span>阅读页</span>
                  <CommandShortcut>{needsText ? NEEDS_TEXT : 'Read'}</CommandShortcut>
                </CommandItem>
              )}
            </CommandGroup>

            {notes.length > 0 && (
              <>
                <CommandSeparator className="-mx-1 bg-[var(--sand)]" />
                <CommandGroup heading="最近笔记">
                  {notes.map((note) => (
                    <CommandItem
                      key={note.id}
                      value={`${note.title} ${note.id}`}
                      keywords={[note.title, note.sourceLabel, '笔记']}
                      disabled={needsText}
                      onSelect={() => focusNote(note.id)}
                      className={ITEM_CLASS}
                    >
                      <NotebookPenIcon />
                      <span>{note.title}</span>
                      <CommandShortcut>
                        {needsText ? NEEDS_TEXT : note.sourceLabel || '未命名来源'}
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {sessions.length > 0 && (
              <>
                <CommandSeparator className="-mx-1 bg-[var(--sand)]" />
                <CommandGroup heading="最近会话">
                  {sessions.map((session) => {
                    const summary = sessionSummary(session.messages);
                    return (
                      <CommandItem
                        key={session.contentId}
                        value={`${summary} ${session.contentId}`}
                        keywords={[summary, '会话', 'AI']}
                        disabled={needsText}
                        onSelect={() => focusSession(session.contentId)}
                        className={ITEM_CLASS}
                      >
                        <MessageSquareTextIcon />
                        <span>{summary}</span>
                        <CommandShortcut>
                          {needsText ? NEEDS_TEXT : formatSessionTime(session.updatedAt)}
                        </CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}

            <CommandSeparator className="-mx-1 bg-[var(--sand)]" />
            <CommandGroup heading="快捷操作">
              <CommandItem
                value="新建会话"
                keywords={['新建会话', '新会话', 'AI 伴读']}
                disabled={needsText}
                onSelect={newSession}
                className={ITEM_CLASS}
              >
                <MessageSquarePlusIcon />
                <span>新建会话</span>
                <CommandShortcut>{needsText ? NEEDS_TEXT : '当前书稿空间'}</CommandShortcut>
              </CommandItem>
              <CommandItem
                value="导入书籍"
                keywords={['导入书籍', '导入', '书架', 'epub', 'txt']}
                onSelect={() => go('/')}
                className={ITEM_CLASS}
              >
                <FileUpIcon />
                <span>导入书籍</span>
                <CommandShortcut>epub / txt</CommandShortcut>
              </CommandItem>
              <CommandItem
                value="打开设置"
                keywords={['打开设置', '设置', 'AI 模型']}
                onSelect={openSettings}
                className={ITEM_CLASS}
              >
                <Settings2Icon />
                <span>打开设置</span>
                <CommandShortcut>AI 模型</CommandShortcut>
              </CommandItem>
            </CommandGroup>

            {needsText && storedItems > 0 && (
              <p className="px-3 py-2 text-xs text-[var(--text-2)]">
                这个标签页还没有打开的文本。先在首页打开一篇，才能查看已存的
                {storedItems} 条会话与笔记。
              </p>
            )}
          </CommandList>

          {/* 底部提示条 */}
          <div className="flex items-center gap-3 border-t border-[var(--sand)] px-4 py-2.5 text-xs text-[var(--text-2)]">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--sand)] px-1">↑</kbd>
              <kbd className="rounded border border-[var(--sand)] px-1">↓</kbd>
              选择
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--sand)] px-1">↵</kbd>
              打开
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--sand)] px-1">esc</kbd>
              关闭
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The accessible name of the dialog. DialogContent from the shared ui/dialog
 * renders its own close button header only when asked; the palette keeps its
 * title in the screen-reader header, like the previous CommandDialog did.
 */
function DialogHeaderFallback() {
  return (
    <div className="sr-only">
      <DialogTitle>命令面板</DialogTitle>
      <DialogDescription>搜索会话、笔记或跳转页面</DialogDescription>
    </div>
  );
}
