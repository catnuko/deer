'use client';

import { useState, useSyncExternalStore } from 'react';
import { notFound } from 'next/navigation';
import AIPanel from '@/src/components/AIPanel';
import { SESSIONS_STORAGE_KEY, type StoredSession } from '@/src/lib/chat-storage';

/**
 * 泳道 B 的书籍独立空间验证页（仅开发环境，生产构建直接 404）：
 * 模拟「三体 / 红楼梦」两本书切换，人工验证切书自动切换（无弹窗无确认）
 * 与跨书零串扰。AI 模型配置指向一个不可达的本地地址——验证不依赖真实
 * 回答，会话数据由「写入种子数据」按钮预置。
 */

const VERIFY_CONFIG_KEY = 'deer-ai-config';

// AIPanel 在首帧 useState 里读取模型配置，这里必须在模块加载时预置好。
if (typeof window !== 'undefined' && !window.localStorage.getItem(VERIFY_CONFIG_KEY)) {
  window.localStorage.setItem(
    VERIFY_CONFIG_KEY,
    JSON.stringify({
      provider: 'custom',
      apiKey: 'dev-verify-only',
      baseUrl: 'http://127.0.0.1:9/v1',
      modelName: 'dev-verify',
    }),
  );
}

const BOOKS = [
  {
    id: 'book-santi-verify',
    title: '三体',
    content:
      '「宇宙就是一座时空的坟墓，静静地等待着…」智子展开，锁死了人类的基础物理学。这是三体人迈向地球的第一步。',
  },
  {
    id: 'book-honglou-verify',
    title: '红楼梦',
    content:
      '黛玉扶着紫鹃的手，进了荣国府。步步留心，时时在意，不肯轻易多说一句话，多行一步路，惟恐被人耻笑了他去。',
  },
] as const;

const MINUTE = 60_000;

function seedSessions(): StoredSession[] {
  const now = Date.now();
  return [
    {
      contentId: 'santi-c1',
      bookId: 'book-santi-verify',
      messages: [
        { id: 'm1', role: 'user', content: '智子为什么封锁人类科技？' },
        { id: 'm2', role: 'assistant', content: '三体人用智子干扰高能粒子对撞实验，让人类的基础物理学研究停滞。' },
      ],
      updatedAt: now - 120 * MINUTE,
    },
    {
      contentId: 'santi-c2',
      bookId: 'book-santi-verify',
      messages: [
        { id: 'm3', role: 'user', content: '面壁计划是什么？' },
        { id: 'm4', role: 'assistant', content: '面壁计划是利用人类思维不透明对抗三体智子监听的战略部署。（种子数据）' },
      ],
      updatedAt: now - 10 * MINUTE,
    },
    {
      contentId: 'hlm-c1',
      bookId: 'book-honglou-verify',
      messages: [
        { id: 'm5', role: 'user', content: '黛玉进府为什么步步留心？' },
        { id: 'm6', role: 'assistant', content: '她寄人篱下，唯恐行为失当被人耻笑，这正是她敏感自尊的体现。（种子数据）' },
      ],
      updatedAt: now - 30 * MINUTE,
    },
  ];
}

export default function DevBookSpacePage() {
  const [bookIndex, setBookIndex] = useState(0);
  const [aiOpen, setAiOpen] = useState(true);
  // 模型配置在模块加载时写入 localStorage，服务端渲染读不到它；挂载后再渲染
  // 面板，避免 SSR/客户端首帧不一致。
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  function writeSeed() {
    window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(seedSessions()));
    window.location.reload();
  }

  function clearSeed() {
    window.localStorage.removeItem(SESSIONS_STORAGE_KEY);
    window.location.reload();
  }

  const book = BOOKS[bookIndex];

  if (process.env.NODE_ENV === 'production') notFound();

  if (!mounted) return null;

  return (
    <main style={{ display: 'flex', height: '100dvh', fontFamily: 'sans-serif' }}>
      <div style={{ width: 260, borderRight: '1px solid #ddd', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>书籍独立空间验证（dev）</h1>
        <p style={{ fontSize: 12, color: '#666', margin: 0 }}>
          切换书籍应自动切换 AI 空间：无弹窗、无确认；各书会话互不可见。
        </p>
        {BOOKS.map((b, index) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBookIndex(index)}
            aria-pressed={index === bookIndex}
            style={{
              textAlign: 'left',
              padding: '8px 12px',
              borderRadius: 8,
              border: index === bookIndex ? '2px solid #d97706' : '1px solid #ccc',
              background: index === bookIndex ? '#fdf3e7' : '#fff',
              cursor: 'pointer',
            }}
          >
            《{b.title}》{index === bookIndex ? '（当前）' : ''}
          </button>
        ))}
        <button type="button" onClick={writeSeed}>写入种子会话数据</button>
        <button type="button" onClick={clearSeed}>清空会话存储</button>
        <button type="button" onClick={() => setAiOpen((v) => !v)}>
          {aiOpen ? '收起 AI 面板' : '展开 AI 面板'}
        </button>
      </div>
      <div style={{ flex: 1, padding: 16 }}>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>当前阅读：《{book.title}》第 1 章</h2>
        <p style={{ maxWidth: 480, lineHeight: 1.8 }}>{book.content}</p>
      </div>
      <AIPanel
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
        readingContent={book.content}
        bookId={book.id}
        bookTitle={book.title}
      />
    </main>
  );
}
