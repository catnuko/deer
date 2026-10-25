'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { type AIModelConfig, getStoredConfig } from '@/src/lib/ai-config';
import { formatSelectionPrompt, trimHistoryMessages } from '@/src/lib/chat-context';
import {
  clearChatHistory,
  getReadingContentId,
  loadChatHistory,
  saveChatHistory,
  withCompletedTurn,
} from '@/src/lib/chat-storage';

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

export default function AIPanel({ isOpen, onClose, readingContent, selectedText, onClearSelection }: AIPanelProps) {
  const [config] = useState<AIModelConfig | null>(() => getStoredConfig());
  const contentId = getReadingContentId(readingContent);
  // The conversation restored from storage for `restored.contentId`; the
  // messages typed in this session are layered on top of it.
  const [restored, setRestored] = useState<{ contentId: string; messages: Message[] } | null>(null);
  const [session, setSession] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Restore the conversation that belongs to the current reading text. A
  // stored conversation of another text is never restored nor overwritten
  // here, so switching texts back and forth keeps each conversation.
  if (restored?.contentId !== contentId) {
    setRestored({ contentId, messages: loadChatHistory(contentId) });
    setSession([]);
    setError(null);
  }

  const restoredMessages = useMemo(
    () => (restored?.contentId === contentId ? restored.messages : []),
    [restored, contentId],
  );
  const messages = useMemo(() => [...restoredMessages, ...session], [restoredMessages, session]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      ...restoredMessages,
      ...session,
      { id: Date.now().toString(), role: 'user' as const, content },
    ];
    const history = trimHistoryMessages([...restoredMessages, ...session]);

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
      // that never received text adds nothing to the stored history.
      const completed = withCompletedTurn(
        allMessages.slice(0, -1),
        allMessages[allMessages.length - 1],
        { ...assistantMessage, content: assistantContent },
      );
      setSession(completed.slice(restoredMessages.length));
      saveChatHistory(contentId, completed);
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
    clearChatHistory();
    setRestored({ contentId, messages: [] });
    setSession([]);
    setError(null);
  }

  function onFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!config || isLoading || !input.trim()) return;
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

  return (
    <aside className="ai-panel open" role="complementary" aria-label="AI 助手面板">
      <div className="ai-panel-header">
        <h3>🦌 AI 助手</h3>
        <button className="close-btn" onClick={onClose} type="button" aria-label="关闭 AI 面板">
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
      </div>

      <div className="ai-messages">
        {messages.length === 0 && (
          <div className="ai-empty-state">
            <p>选中文本或输入问题，开始与 Deer 对话</p>
          </div>
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
          disabled={isLoading}
          aria-label="AI 对话输入框"
        />
        <button className="ai-send-btn" type="submit" disabled={isLoading || !input.trim()}>
          发送
        </button>
      </form>
    </aside>
  );
}
