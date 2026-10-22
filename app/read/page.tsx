'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import ThemeToggle from '@/src/components/ThemeToggle';
import SettingsPanel from '@/src/components/SettingsPanel';
import AIPanel from '@/src/components/AIPanel';
import FloatingToolbar from '@/src/components/FloatingToolbar';
import { getStoredConfig } from '@/src/lib/ai-config';

type ReadState = {
  content: string;
  title: string;
  contentType: 'text' | 'markdown';
} | null;

function readFromSession(): ReadState {
  if (typeof window === 'undefined') return null;
  const stored = sessionStorage.getItem('deer-reading-content');
  if (!stored) return null;
  const storedTitle = sessionStorage.getItem('deer-reading-title');
  const storedType = sessionStorage.getItem('deer-reading-type');
  return {
    content: stored,
    title: storedTitle || '未命名文本',
    contentType: storedType === 'markdown' ? 'markdown' : 'text',
  };
}

export default function ReadPage() {
  const router = useRouter();
  const [state] = useState<ReadState>(() => readFromSession());
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasConfig, setHasConfig] = useState(() => getStoredConfig() !== null);
  const [selectedText, setSelectedText] = useState<string | undefined>();
  const readingAreaRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!state) {
      router.push('/');
    }
  }, [state, router]);

  if (!state) {
    return null;
  }

  const { content, title, contentType } = state;

  function handleAskDeer(text: string) {
    setSelectedText(text);
    setAiPanelOpen(true);
  }

  function renderContent() {
    if (contentType === 'markdown') {
      return (
        <div className="markdown-content">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      );
    }

    const paragraphs = content.split(/\n\s*\n/);
    return (
      <div className="text-content">
        {paragraphs.map((p, i) => (
          <p key={i}>{p.trim()}</p>
        ))}
      </div>
    );
  }

  return (
    <div className="read-layout">
      <header className="read-header">
        <button className="back-btn" onClick={() => router.push('/')} type="button" aria-label="返回首页">
          ← 返回
        </button>
        <h1 className="read-title">{title}</h1>
        <div className="header-actions">
          <button
            className="ai-panel-toggle"
            onClick={() => setAiPanelOpen(!aiPanelOpen)}
            type="button"
            aria-label={aiPanelOpen ? '收起 AI 面板' : '展开 AI 面板'}
          >
            🤖 AI 助手
          </button>
          <button
            className="settings-btn"
            onClick={() => setSettingsOpen(true)}
            type="button"
            aria-label="打开 AI 模型设置"
          >
            ⚙️
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="read-body">
        <main className="reading-area" role="main" aria-label="阅读区域" ref={readingAreaRef}>
          {renderContent()}
          {hasConfig && (
            <FloatingToolbar
              onAskDeer={handleAskDeer}
              containerRef={readingAreaRef}
            />
          )}
        </main>

        <AIPanel
          isOpen={aiPanelOpen}
          onClose={() => setAiPanelOpen(false)}
          readingContent={content}
          selectedText={selectedText}
          onClearSelection={() => setSelectedText(undefined)}
        />
      </div>

      <SettingsPanel isOpen={settingsOpen} onClose={() => {
        setSettingsOpen(false);
        setHasConfig(getStoredConfig() !== null);
      }} />
    </div>
  );
}
