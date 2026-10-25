'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { type AIModelConfig, getStoredConfig } from '@/src/lib/ai-config';
import { formatSelectionPrompt, trimHistoryMessages } from '@/src/lib/chat-context';
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

  const stableOnClearSelection = useCallback(() => {
    onClearSelection?.();
  }, [onClearSelection]);

  // When selectedText changes, send it as a message
  useEffect(() => {
    if (selectedText && config && isOpen) {
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
          context: readingContent.slice(0, 2000),
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
  }

  function onFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!config || isLoading || showList || !input.trim()) return;
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

  return (
    <aside className="ai-panel open" role="complementary" aria-label="AI 助手面板">
      <div className="ai-panel-header">
        <h3>{showList ? `历史会话 (${sessions.length})` : '🦌 AI 助手'}</h3>
        <button
          className="close-btn"
          onClick={showList ? () => setShowList(false) : onClose}
          type="button"
          aria-label={showList ? '关闭历史会话列表' : '关闭 AI 面板'}
        >
          ✕
        </button>
      </div>

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
          onClick={handleClearConversation}
          disabled={isLoading || messages.length === 0}
          type="button"
          aria-label="清空对话"
        >
          🗑️ 清空
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
      </div>

      {showList ? (
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
      )}

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
    </aside>
  );
}
