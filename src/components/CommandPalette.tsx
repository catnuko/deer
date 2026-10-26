'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/src/components/ui/command';
import { listSessions, type StoredSession } from '@/src/lib/chat-storage';
import { listNotes, type StoredNote } from '@/src/lib/notes';
import { formatSessionTime, sessionSummary } from '@/src/lib/session-display';
import { dispatchCommand } from '@/src/lib/command-events';
import { hasReadingContent } from '@/src/lib/reading';
import {
  BookOpenIcon,
  HomeIcon,
  MessageSquareTextIcon,
  NotebookPenIcon,
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
  /** Whether this tab has a text open. */
  hasContent: boolean;
}

const EMPTY_STORED: StoredItems = { sessions: [], notes: [], hasContent: false };

/** The label that tells the reader why a stored entry cannot be opened. */
const NEEDS_TEXT = '需先打开一篇文本';

function readStoredItems(): StoredItems {
  return {
    sessions: listSessions(),
    notes: listNotes(),
    hasContent: hasReadingContent(),
  };
}

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

  const { sessions, notes, hasContent } = stored;
  // Without a text open in this tab the reading page has nothing to show, so
  // a stored session or note cannot be opened: the entries say so instead of
  // bouncing the reader back to the start page.
  const needsText = !hasContent;
  const storedItems = sessions.length + notes.length;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="命令面板"
      description="搜索会话、笔记或跳转页面"
      className="top-1/4 translate-y-0 sm:max-w-lg"
    >
      <Command>
        <CommandInput placeholder="搜索会话、笔记或跳转…" />
        <CommandList>
          <CommandEmpty>没有匹配的结果。</CommandEmpty>

          <CommandGroup heading="跳转">
            <CommandItem value="首页" onSelect={() => go('/')}>
              <HomeIcon />
              <span>首页</span>
              <CommandShortcut>Home</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="阅读页"
              disabled={needsText}
              onSelect={() => go('/read')}
            >
              <BookOpenIcon />
              <span>阅读页</span>
              <CommandShortcut>{needsText ? NEEDS_TEXT : 'Read'}</CommandShortcut>
            </CommandItem>
            <CommandItem value="设置" onSelect={openSettings}>
              <Settings2Icon />
              <span>设置</span>
              <CommandShortcut>AI 模型</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          {sessions.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`AI 会话 (${sessions.length})`}>
                {sessions.map((session) => {
                  const summary = sessionSummary(session.messages);
                  return (
                    <CommandItem
                      key={session.contentId}
                      value={`${summary} ${session.contentId}`}
                      disabled={needsText}
                      onSelect={() => focusSession(session.contentId)}
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

          {notes.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`概念笔记 (${notes.length})`}>
                {notes.map((note) => (
                  <CommandItem
                    key={note.id}
                    value={`${note.title} ${note.id}`}
                    disabled={needsText}
                    onSelect={() => focusNote(note.id)}
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

          {needsText && storedItems > 0 && (
            <>
              <CommandSeparator />
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                这个标签页还没有打开的文本。先在首页打开一篇，才能查看已存的
                {storedItems} 条会话与笔记。
              </p>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
