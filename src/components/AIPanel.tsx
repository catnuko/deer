'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { type AIModelConfig, getStoredConfig } from '@/src/lib/ai-config';

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stableOnClearSelection = useCallback(() => {
    onClearSelection?.();
  }, [onClearSelection]);

  // When selectedText changes, send it as a message
  useEffect(() => {
    if (selectedText && config && isOpen) {
      const question = `请解释这段内容：\n\n"${selectedText}"`;
      sendMessage(question);
      stableOnClearSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedText, config, isOpen, stableOnClearSelection]);

  async function sendMessage(content: string) {
    if (!config || isLoading || !content.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);
    setInput('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
          context: readingContent.slice(0, 2000),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantContent += chunk;

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id ? { ...m, content: assistantContent } : m
            )
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSummarizeChapter() {
    if (!config || isLoading) return;
    const summaryPrompt = '请总结本章的主要内容（前500字）：';
    sendMessage(summaryPrompt);
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
