'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { type AIModelConfig, getStoredConfig } from '@/src/lib/ai-config';
import { CONTEXT_LIMITS, formatSelectionPrompt, trimHistoryMessages } from '@/src/lib/chat-context';
import {
  clearSessionToUndo,
  getReadingContentId,
  listSessions,
  loadChatHistory,
  peekUndo,
  restoreUndo,
  saveChatHistory,
  touchSession,
  withCompletedTurn,
  type StoredSession,
} from '@/src/lib/chat-storage';
import {
  formatSessionTime,
  fullSessionSummary,
  fullSessionTime,
  isoSessionTime,
  sessionSummary,
  undoButtonLabel,
} from '@/src/lib/session-display';
import {
  MAX_NOTES,
  connectNotes,
  createNote,
  deleteNote,
  disconnectNotes,
  listNotes,
  updateNote,
  wasLastParseCorrupt,
  type StoredNote,
} from '@/src/lib/notes';
import { getSelectionText, isCaptureAvailable } from '@/src/lib/selection';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface AIPanelProps {
  isOpen: boolean;
  onClose: () => void;
  readingContent: string;
  selectedText?: string;
  onClearSelection?: () => void;
}

const SESSION_LIST_ID = 'ai-session-list';
const NOTES_LIST_ID = 'ai-notes-list';
const HINT_VISIBLE_MS = 1500;
const EDIT_DEBOUNCE_MS = 300;
const SEARCH_DEBOUNCE_MS = 200;

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

export default function AIPanel({ isOpen, onClose, readingContent, selectedText, onClearSelection }: AIPanelProps) {
  const [config] = useState<AIModelConfig | null>(() => getStoredConfig());
  const contentId = getReadingContentId(readingContent);
  // The conversation on screen, identified by the session it belongs to. The
  // messages typed in this panel session are layered on top of it.
  const [active, setActive] = useState<{ contentId: string; messages: Message[] } | null>(null);
  const [loadedReadingId, setLoadedReadingId] = useState('');
  const [session, setSession] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<StoredSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionsEntryRef = useRef<HTMLButtonElement>(null);
  // Notes view state: `showNotes` is mutually exclusive with `showList`.
  const [showNotes, setShowNotes] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');
  const [noteFilter, setNoteFilter] = useState('');
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [draftUnderstanding, setDraftUnderstanding] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectFilter, setConnectFilter] = useState('');
  const [noteVersion, setNoteVersion] = useState(0);
  const [captureFeedback, setCaptureFeedback] = useState(false);
  const [capHint, setCapHint] = useState(false);
  const [quotaHint, setQuotaHint] = useState(false);
  const [linkedHint, setLinkedHint] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Bug #30: the capture entry is driven by the browser's live selection, so
  // it stays enabled while a selection exists regardless of the 「问 Deer」
  // conversation flow that consumes its own selectedText copy.
  const [liveSelection, setLiveSelection] = useState('');
  const notesEntryRef = useRef<HTMLButtonElement>(null);
  const connectEntryRef = useRef<HTMLButtonElement>(null);
  const connectSearchRef = useRef<HTMLInputElement>(null);
  const timersRef = useRef<{
    capture?: ReturnType<typeof setTimeout>;
    capHint?: ReturnType<typeof setTimeout>;
    quotaHint?: ReturnType<typeof setTimeout>;
    linked?: ReturnType<typeof setTimeout>;
    edit?: ReturnType<typeof setTimeout>;
    search?: ReturnType<typeof setTimeout>;
  }>({});
  // S5: the current turn's selection, when the question came from a text
  // selection. The visible prompt keeps its user-facing wording, but the
  // protocol no longer depends on sniffing that wording.
  const selectionRef = useRef<{ active: boolean; text: string }>({ active: false, text: '' });

  // Opening the panel (or switching the reading text) derives the visible
  // conversation and the pending undo entry from storage, so both survive a
  // refresh. A stored conversation of another text is never overwritten here.
  if (loadedReadingId !== contentId) {
    setLoadedReadingId(contentId);
    setActive({ contentId, messages: loadChatHistory(contentId) });
    setSession([]);
    setError(null);
    setShowList(false);
    setPendingUndo(peekUndo());
  }

  const activeContentId = active?.contentId ?? contentId;
  const activeMessages = useMemo(() => (active ? active.messages : []), [active]);
  const messages = useMemo(() => [...activeMessages, ...session], [activeMessages, session]);
  const isForeignSession = activeContentId !== contentId;
  const undoAvailable = pendingUndo !== null;
  const clearedNotice = messages.length === 0 && pendingUndo?.contentId === activeContentId;

  const allNotes = useMemo(() => {
    void noteVersion;
    return showNotes ? listNotes() : [];
  }, [showNotes, noteVersion]);

  const detailNote = useMemo(() => {
    void noteVersion;
    return openNoteId ? allNotes.find((n) => n.id === openNoteId) ?? null : null;
  }, [allNotes, openNoteId, noteVersion]);

  const selectedTextAvailable = isCaptureAvailable(liveSelection);

  // Track the browser's live selection so the capture button reflects the
  // real-time reading-area selection. Asking a question consumes only the
  // panel's own selectedText prop; it never clears the browser selection and
  // must not disable capture.
  useEffect(() => {
    function syncSelection() {
      setLiveSelection(getSelectionText());
    }
    syncSelection();
    document.addEventListener('selectionchange', syncSelection);
    return () => {
      document.removeEventListener('selectionchange', syncSelection);
    };
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach((t) => t !== undefined && clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const stableOnClearSelection = useCallback(() => {
    onClearSelection?.();
  }, [onClearSelection]);

  // When selectedText changes, send it as a message
  useEffect(() => {
    if (selectedText && config && isOpen) {
      selectionRef.current = { active: true, text: selectedText };
      sendMessage(formatSelectionPrompt(selectedText));
      stableOnClearSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedText, config, isOpen, stableOnClearSelection]);

  async function sendMessage(content: string) {
    if (!config || isLoading || !content.trim()) return;

    // The full in-memory conversation; only finished messages reach storage.
    const allMessages = [
      ...activeMessages,
      ...session,
      { id: Date.now().toString(), role: 'user' as const, content },
    ];
    const history = trimHistoryMessages([...activeMessages, ...session]);

    setSession([...session, allMessages[allMessages.length - 1]]);
    setIsLoading(true);
    setError(null);
    setInput('');

    let pendingId: string | null = null;
    let assistantContent = '';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          messages: history,
          userInput: content,
          context: readingContent.slice(0, CONTEXT_LIMITS.maxReadingChars),
          // S5: the selection travels as an explicit protocol field.
          selectedText: selectionRef.current.active ? selectionRef.current.text : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty response body');
      const decoder = new TextDecoder();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };
      pendingId = assistantMessage.id;

      setSession((prev) => [...prev, assistantMessage]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantContent += chunk;

        setSession((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id ? { ...m, content: assistantContent } : m
          )
        );
      }

      // A reply cut short by the network may end mid-character.
      assistantContent += decoder.decode();

      // Persist only once the reply is complete, so a refresh mid-stream
      // restores the conversation without the half-written message. A turn
      // that never received text adds nothing to the stored history. The
      // conversation keeps the id of the session it belongs to, so continuing
      // a foreign session appends to that session instead of the open text.
      const completed = withCompletedTurn(
        allMessages.slice(0, -1),
        allMessages[allMessages.length - 1],
        { ...assistantMessage, content: assistantContent },
      );
      setSession(completed.slice(activeMessages.length));
      saveChatHistory(activeContentId, completed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setSession((prev) =>
        // Drop an empty assistant placeholder so failures never enter the
        // multi-turn history the next request is built from.
        prev.filter((m) => m.id !== pendingId || m.content.trim().length > 0)
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleSummarizeChapter() {
    if (!config || isLoading) return;
    const summaryPrompt = '请总结本章的主要内容（前500字）：';
    selectionRef.current = { active: false, text: '' };
    sendMessage(summaryPrompt);
  }

  function handleClearConversation() {
    if (isLoading) return;
    const cleared = clearSessionToUndo(activeContentId);
    setPendingUndo(cleared ?? peekUndo());
    setActive({ contentId: activeContentId, messages: [] });
    setSession([]);
    setError(null);
  }

  function handleRestoreUndo() {
    if (isLoading) return;
    const restored = restoreUndo();
    if (!restored) return;
    setPendingUndo(peekUndo());
    setSession([]);
    setError(null);
    setActive({ contentId: restored.contentId, messages: restored.messages });
    if (restored.contentId === contentId) setLoadedReadingId(contentId);
  }

  function handleSelectSession(target: StoredSession) {
    if (isLoading) return;
    // Switching protects the session from eviction and makes it the current one.
    touchSession(target.contentId);
    setActive({ contentId: target.contentId, messages: target.messages });
    setSession([]);
    setError(null);
    setShowList(false);
  }

  function handleToggleSessionList() {
    if (isLoading) return;
    // The updater must stay pure, so the fresh undo slot is read here in the
    // event handler rather than inside a state updater.
    setPendingUndo(peekUndo());
    setShowList(!showList);
    if (!showList) {
      setShowNotes(false);
      setOpenNoteId(null);
    }
  }

  function handleToggleNotes() {
    if (isLoading) return;
    setShowNotes(!showNotes);
    if (!showNotes) {
      setShowList(false);
      setOpenNoteId(null);
      setNoteSearch('');
      setNoteFilter('');
      setNoteVersion((v) => v + 1);
    }
  }

  function flashHint(set: (v: boolean) => void, key: 'capHint' | 'quotaHint' | 'linked') {
    set(true);
    if (timersRef.current[key]) clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => set(false), HINT_VISIBLE_MS);
  }

  function handleCaptureNote() {
    if (isLoading || !selectedTextAvailable) return;
    // Capture reads the live selection at click time; it neither consumes nor
    // clears it, so capturing and asking stay independent actions.
    const selection = getSelectionText();
    if (!isCaptureAvailable(selection)) {
      setLiveSelection(selection);
      return;
    }
    const created = createNote({
      selection,
      sourceContentId: contentId,
      sourceLabel: document.title || '阅读内容',
    });
    if (!created) {
      // Distinguish the 200-note cap from a quota write failure: one inline
      // hint each, no automatic deletion, no retry hammering.
      if (allNotes.length >= MAX_NOTES) flashHint(setCapHint, 'capHint');
      else flashHint(setQuotaHint, 'quotaHint');
      return;
    }
    setCaptureFeedback(true);
    setNoteVersion((v) => v + 1);
    if (timersRef.current.capture) clearTimeout(timersRef.current.capture);
    timersRef.current.capture = setTimeout(() => setCaptureFeedback(false), HINT_VISIBLE_MS);
  }

  function openDetail(id: string) {
    setOpenNoteId(id);
    setDraftTitle(null);
    setDraftUnderstanding(null);
    setConnectOpen(false);
    setConnectFilter('');
    setConfirmDelete(false);
  }

  function flushEdits(target: StoredNote) {
    if (timersRef.current.edit) {
      clearTimeout(timersRef.current.edit);
      timersRef.current.edit = undefined;
    }
    const title = draftTitle;
    const understanding = draftUnderstanding;
    setDraftTitle(null);
    setDraftUnderstanding(null);
    const patch: { title?: string; understanding?: string } = {};
    if (title !== null && title.trim() !== '' && title !== target.title) patch.title = title;
    if (understanding !== null && understanding !== target.understanding) patch.understanding = understanding;
    if (Object.keys(patch).length === 0) return;
    updateNote(target.id, patch);
    setNoteVersion((v) => v + 1);
  }

  function queueEdit(target: StoredNote, field: 'title' | 'understanding', value: string) {
    if (field === 'title') setDraftTitle(value);
    else setDraftUnderstanding(value);
    if (timersRef.current.edit) clearTimeout(timersRef.current.edit);
    timersRef.current.edit = setTimeout(() => flushEdits(target), EDIT_DEBOUNCE_MS);
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
      flashHint(setLinkedHint, 'linked');
    } else {
      connectNotes(detailNote.id, peerId);
    }
    setNoteVersion((v) => v + 1);
  }

  function handleNoteSearch(value: string) {
    setNoteSearch(value);
    if (timersRef.current.search) clearTimeout(timersRef.current.search);
    timersRef.current.search = setTimeout(() => setNoteFilter(value.trim().toLowerCase()), SEARCH_DEBOUNCE_MS);
  }

  function clearNoteSearch() {
    setNoteSearch('');
    setNoteFilter('');
    if (timersRef.current.search) clearTimeout(timersRef.current.search);
  }

  function onFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!config || isLoading || showList || showNotes || !input.trim()) return;
    selectionRef.current = { active: false, text: '' };
    sendMessage(input);
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

  const sessions = showList ? listSessions() : [];
  const shownNotes = noteFilter
    ? allNotes.filter(
        (n) =>
          n.title.toLowerCase().includes(noteFilter) ||
          n.excerpt.toLowerCase().includes(noteFilter),
      )
    : allNotes;
  const captureLabel = captureFeedback ? '✓ 已收藏' : '🔖 收藏笔记';
  const captureAria = selectedTextAvailable
    ? '收藏选中内容为概念笔记'
    : '收藏笔记（先在阅读区划选文本）';
  const detailPeers = detailNote
    ? detailNote.links
        .map((id) => allNotes.find((n) => n.id === id))
        .filter((n): n is StoredNote => n !== undefined)
    : [];
  const connectCandidates = detailNote
    ? allNotes
        .filter((n) => n.id !== detailNote.id)
        .filter((n) => {
          const q = connectFilter.trim().toLowerCase();
          if (!q) return true;
          return n.title.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q);
        })
    : [];

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
              : '🦌 AI 助手'}
        </h3>
        <button
          className="close-btn"
          onClick={
            showNotes
              ? detailNote
                ? () => {
                    flushEdits(detailNote);
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

      {showNotes && detailNote ? (
        <div className="notes-detail">
          <div className="notes-hint">
            <button
              className="notes-text-btn"
              onClick={() => {
                if (detailNote) flushEdits(detailNote);
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
            onBlur={() => flushEdits(detailNote)}
            disabled={isLoading}
          />

          <label className="notes-muted" htmlFor="note-understanding-input">我的理解</label>
          <textarea
            id="note-understanding-input"
            className="notes-edit-input"
            style={{ minHeight: 72, resize: 'vertical' }}
            value={draftUnderstanding ?? detailNote.understanding}
            placeholder="用自己的话写下对它的理解…"
            onChange={(e) => queueEdit(detailNote, 'understanding', e.target.value)}
            onBlur={() => flushEdits(detailNote)}
            disabled={isLoading}
          />

          <p className="notes-muted">摘录</p>
          <blockquote className="notes-excerpt">{detailNote.excerpt}</blockquote>
          <p className="notes-muted" title={detailNote.sourceContentId}>来源：{noteSourceTitle(detailNote)}</p>

          <div className="notes-stack">
            <button
              ref={connectEntryRef}
              className="action-btn"
              onClick={() => {
                setConnectOpen(!connectOpen);
                if (!connectOpen) setTimeout(() => connectSearchRef.current?.focus(), 0);
              }}
              disabled={isLoading}
              type="button"
              aria-expanded={connectOpen}
            >
              🔗 连接概念
            </button>

            {connectOpen && (
              <div className="notes-stack" style={{ gap: 4 }}>
                <input
                  ref={connectSearchRef}
                  className="notes-edit-input"
                  type="search"
                  placeholder="搜索要连接的概念…"
                  value={connectFilter}
                  onChange={(e) => setConnectFilter(e.target.value)}
                  disabled={isLoading}
                  aria-label="搜索要连接的概念"
                />
                {connectCandidates.length === 0 && (
                  <p className="ai-empty-state">没有可连接的其他概念</p>
                )}
                {connectCandidates.map((n) => {
                  const linked = detailNote.links.includes(n.id);
                  return (
                    <button
                      key={n.id}
                      className="notes-connect-row"
                      onClick={() => handleToggleConnect(n.id)}
                      disabled={isLoading}
                      type="button"
                      aria-label={`${linked ? '解除连接' : '连接'}「${n.title}」`}
                    >
                      <span className="session-title">{n.title}</span>
                      <span className="session-meta">
                        {linked && <span className="badge-current">已连接 ✓</span>}
                        <span>{noteSourceTitle(n)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {linkedHint && (
              <p className="notes-muted" role="status" aria-live="polite">已解除</p>
            )}
          </div>

          {detailPeers.length > 0 && (
            <div className="notes-stack" style={{ gap: 4 }}>
              <p className="notes-muted">相关概念</p>
              {detailPeers.map((p) => (
                <div key={p.id} className="notes-hint">
                  <button
                    className="notes-text-btn"
                    style={{ color: 'var(--ink)' }}
                    onClick={() => {
                      flushEdits(detailNote);
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
      ) : showNotes ? (
        <div className="session-list" id={NOTES_LIST_ID}>
          <input
            className="notes-edit-input"
            type="search"
            placeholder="搜索概念名或摘录"
            value={noteSearch}
            onChange={(e) => handleNoteSearch(e.target.value)}
            disabled={isLoading}
            aria-label="搜索概念名或摘录"
          />
          {allNotes.length === 0 ? (
            <div className="ai-empty-state">
              <p>还没有概念笔记。在阅读区划选一段文字，点『🔖 收藏笔记』把重要概念留下来。</p>
            </div>
          ) : shownNotes.length === 0 ? (
            <div className="ai-empty-state">
              <p>没有匹配「{noteSearch.trim()}」的笔记。</p>
              <button className="notes-text-btn" onClick={clearNoteSearch} type="button">清除搜索</button>
            </div>
          ) : (
            shownNotes.map((n) => (
              <button
                key={n.id}
                className="session-row"
                onClick={() => openDetail(n.id)}
                disabled={isLoading}
                type="button"
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
              </button>
            ))
          )}
          <p
            className="list-footer"
            style={allNotes.length >= MAX_NOTES - 20 ? { color: 'var(--moss)' } : undefined}
          >
            {allNotes.length} / {MAX_NOTES}
          </p>
          {wasLastParseCorrupt() && (
            <p className="notes-muted" role="status">笔记数据无法读取，已重置为空</p>
          )}
        </div>
      ) : showList ? (
        <div className="session-list" id={SESSION_LIST_ID}>
          {sessions.length === 0 && (
            <div className="ai-empty-state">
              <p>还没有历史会话</p>
            </div>
          )}
          {sessions.map((item) => {
            const current = item.contentId === activeContentId;
            const summary = sessionSummary(item.messages);
            const full = fullSessionSummary(item.messages);
            return (
              <button
                key={item.contentId}
                className="session-row"
                onClick={() => handleSelectSession(item)}
                disabled={isLoading}
                type="button"
                title={`${full}｜${fullSessionTime(item.updatedAt)}`}
                aria-label={`打开会话「${full}」，${fullSessionTime(item.updatedAt)}${current ? '，当前会话' : ''}`}
                aria-current={current ? 'true' : undefined}
              >
                <span className="session-title">{summary}</span>
                <span className="session-meta">
                  {current && <span className="badge-current">当前</span>}
                  <time dateTime={isoSessionTime(item.updatedAt)} title={fullSessionTime(item.updatedAt)}>
                    {formatSessionTime(item.updatedAt)}
                  </time>
                </span>
              </button>
            );
          })}
          <p className="list-footer">最多保留 20 个会话，超出自动淘汰最早使用的</p>
        </div>
      ) : (
        <>
          <div className="ai-panel-actions">
            <button
              className="action-btn"
              onClick={handleSummarizeChapter}
              disabled={isLoading}
              type="button"
            >
              📝 总结本章
            </button>
            <button
              className="action-btn"
              onClick={handleCaptureNote}
              disabled={isLoading || !selectedTextAvailable}
              aria-disabled={!selectedTextAvailable}
              type="button"
              aria-label={captureAria}
            >
              {captureLabel}
            </button>
            <button
              className="action-btn"
              onClick={handleClearConversation}
              disabled={isLoading || messages.length === 0}
              type="button"
              aria-label="清空对话"
            >
              🗑️ 清空
            </button>
            <button
              ref={notesEntryRef}
              className="action-btn"
              onClick={handleToggleNotes}
              disabled={isLoading}
              type="button"
              aria-expanded={showNotes}
              aria-controls={NOTES_LIST_ID}
            >
              📔 概念笔记
            </button>
            <button
              className="action-btn"
              onClick={handleToggleSessionList}
              disabled={isLoading}
              type="button"
              aria-expanded={showList}
              aria-controls={SESSION_LIST_ID}
            >
              🗂️ 历史会话
            </button>
            {undoAvailable && (
              <button
                className="action-btn"
                onClick={handleRestoreUndo}
                disabled={isLoading}
                type="button"
                aria-label={`撤销上次清空，恢复「${fullSessionSummary(pendingUndo?.messages ?? [])}」`}
              >
                {undoButtonLabel(pendingUndo?.messages ?? [])}
              </button>
            )}
            {quotaHint && (
              <p className="notes-hint" role="status" aria-live="polite">
                收藏失败，笔记未保存
              </p>
            )}
            {capHint && (
              <p className="notes-hint" role="status" aria-live="polite">
                已达 {MAX_NOTES} 条上限，删除一些笔记后才能继续收藏
                <button
                  className="notes-text-btn"
                  onClick={() => {
                    setShowList(false);
                    setShowNotes(true);
                    setNoteVersion((v) => v + 1);
                  }}
                  type="button"
                >
                  打开笔记面板
                </button>
              </p>
            )}
          </div>

          <div className="ai-messages">
            {isForeignSession && (
              <p className="ai-hint">此会话来自另一段阅读内容</p>
            )}
            {messages.length === 0 && (
              <div className="ai-empty-state">
                <p>{clearedNotice ? '对话已清空，可点「撤销恢复」找回' : '选中文本或输入问题，开始与 Deer 对话'}</p>
              </div>
            )}
            {clearedNotice && (
              <p className="ai-hint" role="status" aria-live="polite">
                对话已清空，可点「撤销恢复」找回
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`ai-message ${m.role}`}>
                <div className="message-role">{m.role === 'user' ? '你' : 'Deer'}</div>
                <div className="message-content">{m.content || (isLoading ? '正在思考…' : '')}</div>
              </div>
            ))}
            {error && (
              <div className="ai-error">
                <p>出错了：{error}</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="ai-input-form" onSubmit={onFormSubmit}>
            <input
              className="ai-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入问题…"
              disabled={isLoading || showList}
              aria-label="AI 对话输入框"
            />
            <button className="ai-send-btn" type="submit" disabled={isLoading || showList || !input.trim()}>
              发送
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
