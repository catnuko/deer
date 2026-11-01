# AIPanel 独立挂载说明（泳道 B 交付）

`AIPanel`（`src/components/AIPanel.tsx`）是可独立挂载的 AI 伴读面板组件，
不依赖任何宿主页面的内部状态。阅读页外壳（泳道 A 拥有的 `app/read/page.tsx`）
接入时只需按下面的 props 挂载，不需要改 AIPanel 本身。

## 基本挂载

```tsx
'use client';

import { useState } from 'react';
import AIPanel from '@/src/components/AIPanel';

function ReaderPage({ bookId, bookTitle, chapterContent }: {
  bookId: string;        // 书架里的稳定书籍 id，书籍独立空间的标识
  bookTitle: string;
  chapterContent: string;
}) {
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedText, setSelectedText] = useState<string | undefined>();

  return (
    <>
      {/* 阅读区 … */}
      <AIPanel
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
        readingContent={chapterContent}
        selectedText={selectedText}
        onClearSelection={() => setSelectedText(undefined)}
        bookId={bookId}          // ← 书籍独立空间（P0）：务必传稳定书籍 id
        bookTitle={bookTitle}    // ← 面板头「《书名》· AI 伴读」与空间标识
      />
    </>
  );
}
```

## Props

| Prop | 必填 | 说明 |
| --- | --- | --- |
| `isOpen` | 是 | 面板展开/折叠；折叠时组件返回 `null`，可常驻挂载。 |
| `onClose` | 是 | 请求关闭面板的回调。 |
| `readingContent` | 是 | 当前章节正文。文本指纹（`getReadingContentId`）决定章节内的会话位。 |
| `selectedText` | 否 | 划选工具条「问 AI」带入的选中文本；变化时自动作为提问发送。 |
| `onClearSelection` | 否 | 面板接收选中文本后回调，宿主应清空自己的选中态。 |
| `bookId` | 否 | **书籍独立空间标识**。传入后该面板实例的全部会话保存/恢复/列表都只在该书空间内；不传时退回旧版行为（每个阅读文本一个全局会话位，历史数据归 `LEGACY_BOOK_ID` 档位）。 |
| `bookTitle` | 否 | 当前书名，用于面板头空间标识「《书名》· AI 伴读」与会话列表顶部的空间标注。 |

## 书籍独立空间行为（P0，catnuko 2026-10-28 拍板）

- 挂载时传入 `bookId` 后，面板进入该书的空间：初始恢复该书**最近活跃**
  的会话，该书还没有会话时呈现空会话。
- 宿主切换书籍时只需改变传入的 `bookId`（和 `bookTitle`、`readingContent`），
  面板自动切换到目标书的空间——**无弹窗、无确认**。
- 各书会话列表互不可见；跨书零串扰由 `deer-chat-sessions` 的 `bookId`
  字段保证（本字段是唯一获批的存储契约变更）。
- 旧数据兼容：`bookId` 引入前写入的会话归 `LEGACY_BOOK_ID`（空字符串）
  档位，保留在存储中但不出现在任何书籍空间里。

## 验证挂载效果的 dev 路由

`app/dev/book-space/page.tsx` 是一个**仅开发环境可用**的验证页（生产构建
直接 404）：模拟「三体 / 红楼梦」两本书切换，用于人工验证切书自动切换与
跨书零串扰。`pnpm dev` 后访问 `/dev/book-space`。
