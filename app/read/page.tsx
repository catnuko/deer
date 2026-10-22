'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import ThemeToggle from '@/src/components/ThemeToggle';
import SettingsPanel from '@/src/components/SettingsPanel';
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

  useEffect(() => {
    if (!state) {
      router.push('/');
    }
  }, [state, router]);

  if (!state) {
    return null;
  }

  const { content, title, contentType } = state;

  function renderAiPanelContent() {
    if (!hasConfig) {
      return (
        <div className="ai-panel-placeholder">
          <p>🦌 配置 AI 助手</p>
          <p className="ai-hint">
            请先在设置中配置 AI 模型，才能使用智能阅读助手功能。
          </p>
          <button
            className="ai-config-btn"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            打开设置
          </button>
        </div>
      );
    }

    return (
      <div className="ai-panel-placeholder">
        <p>🦌 AI 助手即将上线</p>
        <p className="ai-hint">选中文本即可向 Deer 提问、获取解释或生成摘要。</p>
      </div>
    );
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
        <main className="reading-area" role="main" aria-label="阅读区域">
          {renderContent()}
        </main>

        <aside
          className={`ai-panel ${aiPanelOpen ? 'open' : ''}`}
          role="complementary"
          aria-label="AI 助手面板"
        >
          {renderAiPanelContent()}
        </aside>
      </div>

      <SettingsPanel isOpen={settingsOpen} onClose={() => {
        setSettingsOpen(false);
        setHasConfig(getStoredConfig() !== null);
      }} />
    </div>
  );
}
