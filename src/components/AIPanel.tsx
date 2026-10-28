'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useAui, useAuiState, AssistantRuntimeProvider, type AssistantRuntime } from '@assistant-ui/react';
import { GlobeIcon } from 'lucide-react';
import { type AIModelConfig, getStoredConfig } from '@/src/lib/ai-config';
import {
  clearSessionToUndo,
  getReadingContentId,
  LEGACY_BOOK_ID,
  listSessions,
  loadChatHistory,
  peekUndo,
  restoreUndo,
  saveChatHistory,
  touchSession,
  type StoredSession,
} from '@/src/lib/chat-storage';
import { pickLatestSpaceSession } from '@/src/lib/book-space';
import {
  formatSessionTime,
  fullSessionSummary,
  fullSessionTime,
  isoSessionTime,
  sessionSummary,
} from '@/src/lib/session-display';
import {
  MAX_NOTES,
  connectNotes,
  deleteNote,
  disconnectNotes,
  listNotes,
  updateNote,
  wasLastParseCorrupt,
  type StoredNote,
} from '@/src/lib/notes';
import { createDraftController } from '@/src/lib/note-drafts';
import { COMMAND_EVENT, type CommandTarget } from '@/src/lib/command-events';
import { commandTextFilter } from '@/src/lib/command-filter';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/src/components/ui/command';
import { Thread, DeerBookProvider } from '@/src/components/assistant-ui/elements/thread.aui';
import {
  SUMMARIZE_CHAPTER_PROMPT,
  useDeerRuntime,
  type StoredChatMessage,
} from '@/src/lib/deer-runtime';

interface AIPanelProps {
  isOpen: boolean;
  onClose: () => void;
  readingContent: string;
  selectedText?: string;
  onClearSelection?: () => void;
  /**
   * 书籍独立空间（P0）：当前书籍的标识。传入后面板的会话保存、恢复与
   * 「历史会话」列表都只在该书的空间里进行；不传时退回旧版行为（每个
   * 阅读文本一个会话位）。阅读页接入时务必传书架里的稳定书籍 id。
   */
  bookId?: string;
  /** 当前书籍的标题，用于面板头的空间标识「《书名》· AI 伴读」。 */
  bookTitle?: string;
}

const SESSION_LIST_ID = 'ai-session-list';
const NOTES_LIST_ID = 'ai-notes-list';
const EDIT_DEBOUNCE_MS = 300;
// How often a command of the ⌘K palette is retried while an answer runs.
const COMMAND_RETRY_MS = 250;

const LIST_ROW_CLASS =
  'session-row items-stretch gap-1 rounded-md px-3 py-2.5 cursor-pointer [&>svg]:hidden';
const CONNECT_ROW_CLASS =
  'notes-connect-row items-stretch gap-1 rounded-md px-3 py-2 cursor-pointer [&>svg]:hidden';

function noteSourceTitle(note: StoredNote): string {
  return note.sourceLabel || note.sourceContentId || '未知来源';
}

function formatNoteTime(updatedAt: number, now: number = Date.now()): string {
  const elapsed = now - updatedAt;
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 24 * 3_600_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  const then = new Date(updatedAt);
  return `${then.getMonth() + 1}月${then.getDate()}日`;
}

function fullNoteTime(updatedAt: number): string {
  return new Date(updatedAt).toLocaleString();
}

/**
 * The visible chat conversation layered onto Deer's storage. The assistant-ui
 * runtime owns the live messages; this component mirrors them into localStorage
 * on every finished turn and drives the header panels (sessions, notes, undo)
 * around the `<Thread>` it hosts.
 */
export default function AIPanel({
  isOpen,
  onClose,
  readingContent,
  selectedText,
  onClearSelection,
  bookId,
  bookTitle,
}: AIPanelProps) {
  const [config] = useState<AIModelConfig | null>(() => getStoredConfig());
  const contentId = getReadingContentId(readingContent);
  // The conversation on screen, identified by the session it belongs to. The
  // messages typed in this panel session are layered on top of it. Inside a
  // book's space the initial session is that book's most recently active one
  // (a fresh space starts empty); without a bookId the legacy per-text slot
  // applies.
  const [initial] = useState(() => {
    if (bookId) {
      const latest = pickLatestSpaceSession(listSessions(bookId), bookId);
      if (latest) {
        return {
          active: { contentId: latest.contentId, messages: latest.messages } as {
            contentId: string;
            messages: StoredChatMessage[];
          },
          pendingUndo: peekUndo(),
        };
      }
    }
    return {
      active: { contentId, messages: loadChatHistory(contentId, bookId) } as {
        contentId: string;
        messages: StoredChatMessage[];
      },
      pendingUndo: peekUndo(),
    };
  });
  const [active, setActive] = useState(initial.active);
  const [visibleMessages, setVisibleMessages] = useState<readonly StoredChatMessage[]>(
    initial.active.messages,
  );
  const [pendingUndo, setPendingUndo] = useState<StoredSession | null>(initial.pendingUndo);
  const sessionsEntryRef = useRef<HTMLButtonElement>(null);
  // The two side views: the session list and the notes view, mutually
  // exclusive, layered over the conversation.
  const [showList, setShowList] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [draftUnderstanding, setDraftUnderstanding] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectFilter, setConnectFilter] = useState('');
  const [noteVersion, setNoteVersion] = useState(0);
  const [linkedHint, setLinkedHint] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The pending edit draft lives outside React state: the debounce timer must
  // persist the values typed most recently, not the ones captured by the
  // render that armed it.
  const [draftController] = useState(() =>
    createDraftController({
      delayMs: EDIT_DEBOUNCE_MS,
      persist: (target, patch) => {
        if (updateNote(target.id, patch)) setNoteVersion((v) => v + 1);
      },
    }),
  );
  const notesEntryRef = useRef<HTMLButtonElement>(null);
  const connectEntryRef = useRef<HTMLButtonElement>(null);
  // The command of the ⌘K palette that is waiting to be applied, and the
  // timer that retries it while an answer is running.
  const pendingTargetRef = useRef<CommandTarget | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The loading state as the command handler and the header buttons see it:
  // the runtime manages it, and an inner component reports it up.
  const isLoadingRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const timersRef = useRef<{
    linked?: ReturnType<typeof setTimeout>;
  }>({});
  // S5: the current turn's selection, when the question came from a text
  // selection. The visible prompt keeps its user-facing wording, but the
  // protocol no longer depends on sniffing that wording.
  const selectionRef = useRef<{ active: boolean; text: string }>({ active: false, text: '' });
  // Switching the reading text reloads the matching session into the live
  // runtime, so the conversation never belongs to two books at once.
  const prevContentIdRef = useRef(contentId);
  const prevSpaceRef = useRef(bookId);

  const activeContentId = active.contentId;
  // The live runtime lives inside the keyed <DeerRuntimeScope> below; the
  // panel reaches it imperatively through this ref. Restoring a conversation
  // is a remount with a fresh seed (the scope's key), NOT `thread.reset()`:
  // the AI SDK runtime's reset converts restored messages through the
  // external-store round trip and loses them on the way back into the AI SDK
  // chat, leaving the conversation on screen empty.
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  // Bumped on every conversation identity change (book switch, session pick,
  // clear, undo restore) so the scope remounts and reseeds from storage.
  const [threadEpoch, setThreadEpoch] = useState(0);
  // 撤销档属于某个空间：只有当被清空的会话与当前空间同书（或同为旧档位）
  // 时才给出撤销入口，别书的撤销档不会出现在本书的面板里。
  const undoAvailable =
    pendingUndo !== null &&
    (bookId ? pendingUndo.bookId === bookId : pendingUndo.bookId === LEGACY_BOOK_ID);

  const allNotes = useMemo(() => {
    void noteVersion;
    return showNotes ? listNotes() : [];
  }, [showNotes, noteVersion]);

  const detailNote = useMemo(() => {
    void noteVersion;
    return openNoteId ? allNotes.find((n) => n.id === openNoteId) ?? null : null;
  }, [allNotes, openNoteId, noteVersion]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach((t) => t !== undefined && clearTimeout(t));
      // An edit that was still pending when the panel went away is saved
      // rather than dropped.
      draftController.flush();
    };
  }, [draftController]);

  // Esc leaves the session list and hands focus back to its entry button.
  useEffect(() => {
    if (!showList) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setShowList(false);
      sessionsEntryRef.current?.focus();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showList]);

  // Esc leaves the notes view (detail first, then the list) and returns focus
  // to the notes entry button. With the connection selector open, Esc only
  // collapses the selector so the entry button survives and takes focus back.
  useEffect(() => {
    if (!showNotes) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (openNoteId) {
        if (connectOpen) {
          setConnectOpen(false);
          connectEntryRef.current?.focus();
          return;
        }
        setOpenNoteId(null);
        setConnectOpen(false);
        setConfirmDelete(false);
      } else {
        setShowNotes(false);
        notesEntryRef.current?.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showNotes, openNoteId, connectOpen]);

  // Esc collapses the inline connection selector and returns focus to its
  // entry button.
  useEffect(() => {
    if (!connectOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setConnectOpen(false);
      connectEntryRef.current?.focus();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [connectOpen]);

  // A command from the ⌘K palette: show the picked session, or the picked note
  // in the notes view. The command is applied from the event itself, so it
  // never waits for a render to pick it up. A command that arrives while an
  // answer is running waits for it to end: the conversation on screen must
  // never belong to two sessions at once.
  useEffect(() => {
    function applyCommand(target: CommandTarget): boolean {
      if (isLoadingRef.current) return false;

      if (target.kind === 'session') {
        const session = target.id
          ? listSessions(bookId).find((s) => s.contentId === target.id)
          : undefined;
        if (!session) return true;
        // Switching protects the session from eviction and makes it the current one.
        touchSession(session.contentId, bookId);
        setActive({ contentId: session.contentId, messages: session.messages });
        setVisibleMessages(session.messages);
        setThreadEpoch((epoch) => epoch + 1);
        setShowList(false);
        setShowNotes(false);
        setOpenNoteId(null);
        return true;
      }

      if (target.kind === 'note') {
        const note = target.id ? listNotes().find((n) => n.id === target.id) : undefined;
        if (!note) return true;
        setShowNotes(true);
        setNoteSearch('');
        setNoteVersion((v) => v + 1);
        setOpenNoteId(note.id);
        setDraftTitle(null);
        setDraftUnderstanding(null);
        setConnectOpen(false);
        setConnectFilter('');
        return true;
      }

      return true;
    }

    // The command waits in a slot while an answer is running and is applied
    // as soon as the answer is over.
    function applyPending() {
      const pending = pendingTargetRef.current;
      if (!pending) return;
      if (applyCommand(pending)) {
        pendingTargetRef.current = null;
        return;
      }
      retryTimerRef.current = setTimeout(applyPending, COMMAND_RETRY_MS);
    }

    function onCommand(event: Event) {
      const target = (event as CustomEvent<CommandTarget>).detail;
      if (!target || target.kind === 'settings') return;
      pendingTargetRef.current = target;
      applyPending();
    }

    window.addEventListener(COMMAND_EVENT, onCommand);
    return () => {
      window.removeEventListener(COMMAND_EVENT, onCommand);
      if (retryTimerRef.current !== undefined) clearTimeout(retryTimerRef.current);
    };
    // applyCommand works on panel state and storage only, so the listener is
    // registered once for the panel's lifetime.
  }, []);

  const stableOnClearSelection = useCallback(() => {
    onClearSelection?.();
  }, [onClearSelection]);

  // When selectedText changes, send it as a message.
  useEffect(() => {
    if (selectedText && config && isOpen) {
      selectionRef.current = { active: true, text: selectedText };
      sendQuestion(`请解释这段内容：\n\n"${selectedText}"`);
      stableOnClearSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedText, config, isOpen, stableOnClearSelection]);

  // 切书自动切换（P0，无弹窗无确认）：书籍标识或阅读文本变化时，把目标书
  // 空间里最近活跃的会话装进面板；该书还没有会话就呈现空会话。空间里的
  // 会话列表、当前会话和建议一起换，各书的会话互不可见。恢复走 scope 的
  // 重挂载种子（threadEpoch），不是 thread.reset()。
  useEffect(() => {
    if (prevSpaceRef.current === bookId && prevContentIdRef.current === contentId) return;
    const bookChanged = prevSpaceRef.current !== bookId;
    prevSpaceRef.current = bookId;
    prevContentIdRef.current = contentId;
    let restored: StoredChatMessage[] = [];
    let sessionContentId = contentId;
    if (bookId) {
      const latest = pickLatestSpaceSession(listSessions(bookId), bookId);
      if (latest) {
        sessionContentId = latest.contentId;
        restored = loadChatHistory(latest.contentId, bookId);
      }
    } else if (!bookChanged) {
      restored = loadChatHistory(contentId);
    }
    setActive({ contentId: sessionContentId, messages: restored });
    setVisibleMessages(restored);
    setThreadEpoch((epoch) => epoch + 1);
    setShowList(false);
    setPendingUndo(peekUndo());
  }, [bookId, contentId]);

  function sendQuestion(content: string) {
    if (!config || !content.trim()) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.thread.composer.setText(content);
    runtime.thread.composer.send();
  }

  function handleSummarizeChapter() {
    if (!config) return;
    selectionRef.current = { active: false, text: '' };
    sendQuestion(SUMMARIZE_CHAPTER_PROMPT);
  }

  function handleClearConversation() {
    if (isRunning) return;
    const cleared = clearSessionToUndo(activeContentId, bookId);
    setPendingUndo(cleared ?? peekUndo());
    setActive({ contentId: activeContentId, messages: [] });
    setVisibleMessages([]);
    setThreadEpoch((epoch) => epoch + 1);
  }

  function handleRestoreUndo() {
    if (isRunning) return;
    const restored = restoreUndo();
    if (!restored) return;
    // 撤销档只恢复属于本书空间的会话；别书的会话留在档里不动。
    if (bookId && restored.bookId !== bookId) {
      setPendingUndo(peekUndo());
      return;
    }
    setPendingUndo(peekUndo());
    setVisibleMessages([]);
    setActive({ contentId: restored.contentId, messages: restored.messages });
    prevContentIdRef.current = restored.contentId;
    setThreadEpoch((epoch) => epoch + 1);
  }

  function loadSession(targetContentId: string) {
    const session = listSessions(bookId).find((s) => s.contentId === targetContentId);
    if (!session) return;
    touchSession(targetContentId, bookId);
    setActive({ contentId: session.contentId, messages: session.messages });
    setVisibleMessages(session.messages);
    setThreadEpoch((epoch) => epoch + 1);
    setShowList(false);
    setShowNotes(false);
    setOpenNoteId(null);
  }

  function handleSelectSession(target: StoredSession) {
    loadSession(target.contentId);
  }

  function handleToggleSessionList() {
    // The updater must stay pure, so the fresh undo slot is read here in the
    // event handler rather than inside a state updater.
    setPendingUndo(peekUndo());
    setShowList(!showList);
    if (!showList) {
      setShowNotes(false);
      setOpenNoteId(null);
      setSessionSearch('');
    }
  }

  function handleToggleNotes() {
    setShowNotes(!showNotes);
    if (!showNotes) {
      setShowList(false);
      setOpenNoteId(null);
      setNoteSearch('');
      setNoteVersion((v) => v + 1);
    }
  }

  function flashLinked() {
    setLinkedHint(true);
    if (timersRef.current.linked) clearTimeout(timersRef.current.linked);
    timersRef.current.linked = setTimeout(() => setLinkedHint(false), 1500);
  }

  function openDetail(id: string) {
    setOpenNoteId(id);
    setDraftTitle(null);
    setDraftUnderstanding(null);
    setConnectOpen(false);
    setConnectFilter('');
    setConfirmDelete(false);
  }

  function flushEdits() {
    // The controller owns the pending values and the note they belong to, so a
    // flush always persists what was typed last, whichever render armed the timer.
    draftController.flush();
    setDraftTitle(null);
    setDraftUnderstanding(null);
  }

  function queueEdit(target: StoredNote, field: 'title' | 'understanding', value: string) {
    if (field === 'title') setDraftTitle(value);
    else setDraftUnderstanding(value);
    draftController.edit(target, field, value);
  }

  function handleDeleteNote(id: string) {
    deleteNote(id);
    setNoteVersion((v) => v + 1);
    setOpenNoteId(null);
    setConnectOpen(false);
    setConfirmDelete(false);
  }

  function handleToggleConnect(peerId: string) {
    if (!detailNote) return;
    if (detailNote.links.includes(peerId)) {
      disconnectNotes(detailNote.id, peerId);
      flashLinked();
    } else {
      connectNotes(detailNote.id, peerId);
    }
    setNoteVersion((v) => v + 1);
  }

  function clearNoteSearch() {
    setNoteSearch('');
  }

  if (!isOpen) return null;

  if (!config) {
    return (
      <aside className="ai-panel open" role="complementary" aria-label="AI 助手面板">
        <div className="ai-panel-placeholder">
          <p>🦌 配置 AI 助手</p>
          <p className="ai-hint">请先在设置中配置 AI 模型，才能使用智能阅读助手功能。</p>
        </div>
      </aside>
    );
  }

  const sessions = showList ? listSessions(bookId) : [];
  const detailPeers = detailNote
    ? detailNote.links
        .map((id) => allNotes.find((n) => n.id === id))
        .filter((n): n is StoredNote => n !== undefined)
    : [];
  // The candidates of the connection picker. The query is not applied here:
  // the Command list matches it, with the rule the search used before it moved
  // onto the component.
  const connectCandidates = detailNote ? allNotes.filter((n) => n.id !== detailNote.id) : [];

  const overlay = showNotes
    ? detailNote
      ? renderNoteDetail()
      : renderNotesList()
    : showList
      ? renderSessionList()
      : null;

  function renderNotesList() {
    return (
      <div className="session-list" id={NOTES_LIST_ID}>
        {/* The list is the view itself: the search filters it in place, so the
            Command lives inline and the panel keeps its shape. */}
        <Command className="h-auto! shrink-0 p-0" filter={commandTextFilter} label="搜索概念名或摘录">
          <CommandInput
            value={noteSearch}
            onValueChange={setNoteSearch}
            placeholder="搜索概念名或摘录"
            aria-label="搜索概念名或摘录"
            disabled={isRunning}
          />
          <CommandList className="max-h-none">
            <CommandEmpty>
              {allNotes.length === 0 ? (
                <div className="ai-empty-state">
                  <p>还没有概念笔记。在阅读区划选一段文字，点『🔖 收藏笔记』把重要概念留下来。</p>
                </div>
              ) : (
                <div className="ai-empty-state">
                  <p>没有匹配「{noteSearch.trim()}」的笔记。</p>
                  <button className="notes-text-btn" onClick={clearNoteSearch} type="button">
                    清除搜索
                  </button>
                </div>
              )}
            </CommandEmpty>
            <CommandGroup className="p-0">
              {allNotes.map((n) => (
                <CommandItem
                  key={n.id}
                  value={n.id}
                  keywords={[n.title, n.excerpt]}
                  onSelect={() => openDetail(n.id)}
                  disabled={isRunning}
                  className={LIST_ROW_CLASS}
                  title={`${n.title}｜${fullNoteTime(n.updatedAt)}`}
                  aria-label={`打开笔记「${n.title}」，${fullNoteTime(n.updatedAt)}`}
                >
                  <span className="session-title">{n.title}</span>
                  <span className="notes-muted">{n.excerpt}</span>
                  <span className="session-meta">
                    {n.links.length > 0 && <span>🔗 {n.links.length}</span>}
                    <time dateTime={new Date(n.updatedAt).toISOString()} title={fullNoteTime(n.updatedAt)}>
                      {formatNoteTime(n.updatedAt)}
                    </time>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <p
          className="list-footer"
          style={allNotes.length >= MAX_NOTES - 20 ? { color: 'var(--moss)' } : undefined}
        >
          {allNotes.length} / {MAX_NOTES}
        </p>
        {wasLastParseCorrupt() && <p className="notes-muted" role="status">笔记数据无法读取，已重置为空</p>}
      </div>
    );
  }

  function renderNoteDetail() {
    if (!detailNote) return null;
    return (
      <div className="notes-detail">
        <div className="notes-hint">
          <button
            className="notes-text-btn"
            onClick={() => {
              flushEdits();
              setOpenNoteId(null);
              setConnectOpen(false);
            }}
            type="button"
          >
            ← 返回列表
          </button>
          {confirmDelete ? (
            <span className="notes-muted">
              <span>删除后相关连接一并移除，确定？</span>
              <button className="notes-text-btn" onClick={() => handleDeleteNote(detailNote.id)} type="button">
                删除
              </button>
              <button className="notes-text-btn" onClick={() => setConfirmDelete(false)} type="button">
                取消
              </button>
            </span>
          ) : (
            <button className="notes-text-btn" onClick={() => setConfirmDelete(true)} type="button">
              🗑️ 删除
            </button>
          )}
        </div>

        <label className="notes-muted" htmlFor="note-title-input">概念名</label>
        <input
          id="note-title-input"
          className="notes-edit-input"
          value={draftTitle ?? detailNote.title}
          onChange={(e) => queueEdit(detailNote, 'title', e.target.value)}
          onBlur={() => flushEdits()}
          disabled={isRunning}
        />

        <label className="notes-muted" htmlFor="note-understanding-input">我的理解</label>
        <textarea
          id="note-understanding-input"
          className="notes-edit-input"
          style={{ minHeight: 72, resize: 'vertical' }}
          value={draftUnderstanding ?? detailNote.understanding}
          placeholder="用自己的话写下对它的理解…"
          onChange={(e) => queueEdit(detailNote, 'understanding', e.target.value)}
          onBlur={() => flushEdits()}
          disabled={isRunning}
        />

        <p className="notes-muted">摘录</p>
        <blockquote className="notes-excerpt">{detailNote.excerpt}</blockquote>
        <p className="notes-muted" title={detailNote.sourceContentId}>来源：{noteSourceTitle(detailNote)}</p>

        <div className="notes-stack">
          <button
            ref={connectEntryRef}
            className="action-btn"
            onClick={() => setConnectOpen(true)}
            disabled={isRunning}
            type="button"
            aria-haspopup="dialog"
          >
            🔗 连接概念
          </button>

          {linkedHint && <p className="notes-muted" role="status" aria-live="polite">已解除</p>}
        </div>

        {/* The connection picker is a second layer over the note: it covers the
            note it belongs to, and it is dismissed on purpose (Esc or the
            backdrop), so it lives in a dialog and not in the panel. */}
        <CommandDialog
          open={connectOpen}
          onOpenChange={(next) => {
            setConnectOpen(next);
            if (!next) setConnectFilter('');
          }}
          title="连接概念"
          description="搜索并选择要连接的概念"
          className="top-1/4 translate-y-0 sm:max-w-md"
        >
          <Command filter={commandTextFilter} label="搜索要连接的概念">
            <CommandInput
              value={connectFilter}
              onValueChange={setConnectFilter}
              placeholder="搜索要连接的概念…"
              aria-label="搜索要连接的概念"
            />
            <CommandList>
              <CommandEmpty>
                <div className="ai-empty-state">
                  <p>没有可连接的其他概念</p>
                </div>
              </CommandEmpty>
              {/* The group keeps its own padding here: it lives in a dialog, like
                  the group of the ⌘K palette, so the rows stay lined up with the
                  search box above them. The inline lists of the panel are flush
                  instead, and drop it. */}
              <CommandGroup>
                {connectCandidates.map((n) => {
                  const linked = detailNote.links.includes(n.id);
                  return (
                    <CommandItem
                      key={n.id}
                      value={n.id}
                      keywords={[n.title, n.excerpt]}
                      onSelect={() => handleToggleConnect(n.id)}
                      disabled={isRunning}
                      className={CONNECT_ROW_CLASS}
                      aria-label={`${linked ? '解除连接' : '连接'}「${n.title}」`}
                    >
                      <span className="session-title">{n.title}</span>
                      <span className="session-meta">
                        {linked && <span className="badge-current">已连接 ✓</span>}
                        <span>{noteSourceTitle(n)}</span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </CommandDialog>

        {detailPeers.length > 0 && (
          <div className="notes-stack" style={{ gap: 4 }}>
            <p className="notes-muted">相关概念</p>
            {detailPeers.map((p) => (
              <div key={p.id} className="notes-hint">
                <button
                  className="notes-text-btn"
                  style={{ color: 'var(--ink)' }}
                  onClick={() => {
                    flushEdits();
                    openDetail(p.id);
                  }}
                  type="button"
                >
                  {p.title}
                </button>
                <button
                  className="notes-text-btn"
                  onClick={() => handleToggleConnect(p.id)}
                  type="button"
                  aria-label={`解除与「${p.title}」的连接`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderSessionList() {
    return (
      <div className="session-list" id={SESSION_LIST_ID}>
        {/* 空间标识（P0）：这一层列表只属于当前书，顶部一行小字说明归属。 */}
        {bookTitle && (
          <p className="session-space-label" aria-label={`当前空间：${bookTitle}的会话`}>
            《{bookTitle}》的会话
          </p>
        )}
        {/* The session list is a view of its own: the search filters it in
            place, like the search of the notes list. */}
        <Command className="h-auto! shrink-0 p-0" filter={commandTextFilter} label="搜索历史会话">
          <CommandInput
            value={sessionSearch}
            onValueChange={setSessionSearch}
            placeholder="搜索历史会话"
            aria-label="搜索历史会话"
            disabled={isRunning}
          />
          <CommandList className="max-h-none">
            <CommandEmpty>
              {sessions.length === 0 ? (
                <div className="ai-empty-state">
                  <p>{bookTitle ? '这本书还没有会话' : '还没有历史会话'}</p>
                </div>
              ) : (
                <div className="ai-empty-state">
                  <p>没有匹配「{sessionSearch.trim()}」的会话。</p>
                  <button className="notes-text-btn" onClick={() => setSessionSearch('')} type="button">
                    清除搜索
                  </button>
                </div>
              )}
            </CommandEmpty>
            <CommandGroup className="p-0">
              {sessions.map((item) => {
                const current = item.contentId === activeContentId;
                const summary = sessionSummary(item.messages);
                const full = fullSessionSummary(item.messages);
                return (
                  <CommandItem
                    key={item.contentId}
                    value={item.contentId}
                    keywords={[summary, full]}
                    onSelect={() => handleSelectSession(item)}
                    disabled={isRunning}
                    className={LIST_ROW_CLASS}
                    title={`${full}｜${fullSessionTime(item.updatedAt)}`}
                    aria-label={`打开会话「${full}」，当前会话`}
                    aria-current={current ? 'true' : undefined}
                  >
                    <span className="session-title">{summary}</span>
                    <span className="session-meta">
                      {current && <span className="badge-current">当前</span>}
                      <time dateTime={isoSessionTime(item.updatedAt)} title={fullSessionTime(item.updatedAt)}>
                        {formatSessionTime(item.updatedAt)}
                      </time>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <p className="list-footer">最多保留 20 个会话，超出自动淘汰最早使用的</p>
      </div>
    );
  }

  return (
    <aside className="ai-panel open" role="complementary" aria-label="AI 助手面板">
      <div className="ai-panel-header">
        <h3>
          {showNotes
            ? detailNote
              ? '概念笔记'
              : `概念笔记 (${allNotes.length}/${MAX_NOTES})`
            : showList
              ? `历史会话 (${sessions.length})`
              : bookTitle
                ? `《${bookTitle}》· AI 伴读`
                : '🦌 AI 助手'}
        </h3>
        <div className="ai-panel-header-actions">
          {!showNotes && !showList && (
            <>
              <button
                className="icon-btn"
                onClick={handleToggleNotes}
                disabled={isRunning}
                type="button"
                aria-expanded={showNotes}
                aria-controls={NOTES_LIST_ID}
                aria-label="概念笔记"
                title="概念笔记"
              >
                📔
              </button>
              <button
                className="icon-btn"
                onClick={handleToggleSessionList}
                disabled={isRunning}
                type="button"
                aria-expanded={showList}
                aria-controls={SESSION_LIST_ID}
                aria-label="历史会话"
                title="历史会话"
              >
                🗂️
              </button>
              <button
                className="icon-btn"
                onClick={handleClearConversation}
                disabled={isRunning || visibleMessages.length === 0}
                type="button"
                aria-label="清空对话"
                title="清空对话"
              >
                🗑️
              </button>
              {undoAvailable && (
                <button
                  className="icon-btn"
                  onClick={handleRestoreUndo}
                  disabled={isRunning}
                  type="button"
                  aria-label={`撤销上次清空，恢复「${fullSessionSummary(pendingUndo?.messages ?? [])}」`}
                  title={`撤销恢复：${fullSessionSummary(pendingUndo?.messages ?? [])}`}
                >
                  ↩️
                </button>
              )}
            </>
          )}
          <button
            className="close-btn"
            onClick={
              showNotes
                ? detailNote
                  ? () => {
                      flushEdits();
                      setOpenNoteId(null);
                      setConnectOpen(false);
                    }
                  : () => setShowNotes(false)
                : showList
                  ? () => setShowList(false)
                  : onClose
            }
            type="button"
            aria-label={
              showNotes
                ? detailNote
                  ? '返回笔记列表'
                  : '关闭概念笔记列表'
                : showList
                  ? '关闭历史会话列表'
                  : '关闭 AI 面板'
            }
          >
            ✕
          </button>
        </div>
      </div>

      <div className="ai-panel-body">
        <div className="ai-chat">
          <DeerRuntimeScope
            key={`${bookId ?? ''}:${threadEpoch}`}
            config={config}
            readingContent={readingContent}
            initialMessages={active.messages}
            bookTitle={bookTitle}
            getSelectedText={() => (selectionRef.current.active ? selectionRef.current.text : undefined)}
            onTurnComplete={(messages) => {
              // Persist only once the reply is complete, mirroring the legacy panel's
              // behavior: a refresh mid-stream restores the conversation without the
              // half-written message. The conversation keeps the id of the session it
              // belongs to, so continuing a foreign session appends to that session,
              // and the turn lands in this book's space.
              setVisibleMessages(messages);
              saveChatHistory(activeContentId, messages, bookId);
            }}
            onRuntimeReady={(runtime) => {
              runtimeRef.current = runtime;
            }}
            onRunningChange={(running) => {
              isLoadingRef.current = running;
              setIsRunning(running);
            }}
            onSummarize={handleSummarizeChapter}
          />
        </div>

        {overlay && <div className="ai-overlay">{overlay}</div>}
      </div>
    </aside>
  );
}

/**
 * Hosts the assistant-ui runtime and `<Thread>` for one conversation identity.
 * The key from the host ties the scope to the active session: switching books
 * or sessions remounts this component, which is how a conversation is
 * restored — the runtime seeds from `initialMessages` at construction, the
 * one channel the AI SDK runtime keeps intact (see the note on runtimeRef).
 */
function DeerRuntimeScope({
  config,
  readingContent,
  initialMessages,
  bookTitle,
  getSelectedText,
  onTurnComplete,
  onRuntimeReady,
  onRunningChange,
  onSummarize,
}: {
  config: AIModelConfig | null;
  readingContent: string;
  initialMessages: readonly StoredChatMessage[];
  bookTitle: string | undefined;
  getSelectedText: () => string | undefined;
  onTurnComplete: (messages: readonly StoredChatMessage[]) => void;
  onRuntimeReady: (runtime: AssistantRuntime) => void;
  onRunningChange: (running: boolean) => void;
  onSummarize: () => void;
}) {
  const runtime = useDeerRuntime({
    config,
    readingContent,
    initialMessages,
    getSelectedText,
    onTurnComplete,
  });

  useEffect(() => {
    onRuntimeReady(runtime);
  }, [runtime, onRuntimeReady]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <DeerBookProvider bookTitle={bookTitle}>
        <ChatArea onRunningChange={onRunningChange} onSummarize={onSummarize} />
      </DeerBookProvider>
    </AssistantRuntimeProvider>
  );
}

/**
 * Hosts the assistant-ui `<Thread>` inside the runtime provider and reports the
 * run state upward so the header buttons can disable themselves while a reply
 * streams. The `<Thread>` stays mounted under the list/notes overlays so an
 * in-flight answer is never aborted by opening them.
 */
function ChatArea({
  onRunningChange,
  onSummarize,
}: {
  onRunningChange: (running: boolean) => void;
  onSummarize: () => void;
}) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  useEffect(() => {
    onRunningChange(isRunning);
  }, [isRunning, onRunningChange]);

  // The preset sits just above the composer, where a reader decides what to
  // ask next, rather than in the panel header.
  const composerHeader = useMemo(
    () =>
      function ComposerHeader() {
        return (
          <div className="ai-composer-head">
            <button
              className="action-btn summarize-btn"
              onClick={onSummarize}
              disabled={isRunning}
              type="button"
            >
              📝 总结本章
            </button>
          </div>
        );
      },
    [isRunning, onSummarize],
  );

  return (
    <Thread
      components={{
        Welcome: ChatWelcome,
        ComposerHeader: composerHeader,
        ComposerExtra: DeerComposerTools,
      }}
    />
  );
}

/**
 * 空态建议 chips（§4.7）：没有会话内容时给出可直接发送的话题。点击即以该
 * 话题发起提问。
 */
const SUGGESTION_CHIPS: { label: string; prompt: string }[] = [
  { label: '总结本章', prompt: SUMMARIZE_CHAPTER_PROMPT },
  { label: '这段在讲什么', prompt: '这段在讲什么？' },
  { label: '作者的核心论点', prompt: '作者的核心论点是什么？' },
];

/** Welcome screen shown when the conversation is empty. */
function ChatWelcome() {
  const aui = useAui();
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col gap-3 px-2">
      <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        🦌 有什么可以帮你？
      </p>
      <p className="text-muted-foreground text-sm">
        你可以选中正文任意文字直接提问，或从下面选一个话题
      </p>
      <div className="flex flex-wrap gap-2" role="list" aria-label="建议话题">
        {SUGGESTION_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            role="listitem"
            className="suggestion-chip"
            onClick={() => {
              aui.thread.composer().setText(chip.prompt);
              aui.thread.composer().send();
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Composer 左下工具行（§4.5）：「🌐 联网搜索」只保留位置，置灰禁用并挂
 * 「占位」badge 与 tooltip——真实搜索等接口接入后再启用；旁边是键盘 hint。
 */
function DeerComposerTools() {
  return (
    <div className="deer-composer-tools">
      <span className="deer-net-search" aria-disabled="true" title="搜索接口待接入">
        <GlobeIcon className="size-3.5" aria-hidden />
        联网搜索
        <span className="badge-placeholder">占位</span>
      </span>
      <span className="deer-composer-hint">Enter 发送 · Shift+Enter 换行</span>
    </div>
  );
}
