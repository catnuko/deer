import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSpaceId, pickLatestSpaceSession } from '../src/lib/book-space';
import {
  LEGACY_BOOK_ID,
  SESSIONS_STORAGE_KEY,
  UNDO_STORAGE_KEY,
  clearSessionToUndo,
  listSessions,
  loadChatHistory,
  peekUndo,
  restoreUndo,
  saveChatHistory,
  type StoredChatMessage,
  type StoredSession,
} from '../src/lib/chat-storage';

let store: Record<string, string>;

function installWindow(): void {
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  };
  vi.stubGlobal('window', { localStorage: mockLocalStorage });
  vi.stubGlobal('localStorage', mockLocalStorage);
}

function message(index: number, role: 'user' | 'assistant' = index % 2 === 0 ? 'user' : 'assistant'): StoredChatMessage {
  return { id: String(index), role, content: `消息 ${index}` };
}

function rawSessions(): StoredSession[] {
  return JSON.parse(store[SESSIONS_STORAGE_KEY]) as StoredSession[];
}

describe('book-space - 空间标识', () => {
  it('有书籍标识时以书为准（同书各章节共享一个空间）', () => {
    expect(resolveSpaceId('book-sanTi', 'c1-abc')).toBe('book-sanTi');
    expect(resolveSpaceId('  book-sanTi  ', 'c1-abc')).toBe('book-sanTi');
  });

  it('没有书籍标识时退回阅读文本指纹，与旧版行为一致', () => {
    expect(resolveSpaceId(undefined, 'c1-abc')).toBe('c1-abc');
    expect(resolveSpaceId('', 'c1-abc')).toBe('c1-abc');
    expect(resolveSpaceId('   ', 'c1-abc')).toBe('c1-abc');
  });
});

describe('book-space - 切书自动切换（无确认）', () => {
  it('恢复目标书最近活跃的会话', () => {
    const a1: StoredSession = { contentId: 'a1', bookId: 'book-a', messages: [message(0)], updatedAt: 100 };
    const a2: StoredSession = { contentId: 'a2', bookId: 'book-a', messages: [message(1)], updatedAt: 300 };
    const b1: StoredSession = { contentId: 'b1', bookId: 'book-b', messages: [message(2)], updatedAt: 200 };
    const sessions = [a1, b1, a2];
    expect(pickLatestSpaceSession(sessions, 'book-a')).toBe(a2);
    expect(pickLatestSpaceSession(sessions, 'book-b')).toBe(b1);
  });

  it('目标书没有会话（或消息为空）时返回 null，呈现空会话', () => {
    const empty: StoredSession = { contentId: 'a0', bookId: 'book-a', messages: [], updatedAt: 999 };
    const sessions = [empty, { contentId: 'b1', bookId: 'book-b', messages: [message(0)], updatedAt: 1 }];
    expect(pickLatestSpaceSession(sessions, 'book-a')).toBeNull();
    expect(pickLatestSpaceSession(sessions, 'book-c')).toBeNull();
  });

  it('旧档位（无 bookId）的会话不属于任何书的空间', () => {
    const legacy: StoredSession = { contentId: 'l1', bookId: LEGACY_BOOK_ID, messages: [message(0)], updatedAt: 500 };
    expect(pickLatestSpaceSession([legacy], 'book-a')).toBeNull();
    expect(pickLatestSpaceSession([legacy], undefined)).toBeNull();
  });
});

describe('chat-storage - 书籍空间隔离（存储层）', () => {
  beforeEach(() => {
    store = {};
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('写入会话带上 bookId；各书会话列表互不污染', () => {
    saveChatHistory('c-a', [message(0), message(1)], 'book-a');
    saveChatHistory('c-b', [message(2), message(3)], 'book-b');

    const listA = listSessions('book-a');
    expect(listA).toHaveLength(1);
    expect(listA[0].contentId).toBe('c-a');
    expect(listA[0].bookId).toBe('book-a');

    const listB = listSessions('book-b');
    expect(listB).toHaveLength(1);
    expect(listB[0].contentId).toBe('c-b');

    expect(listSessions('book-c')).toHaveLength(0);
  });

  it('旧数据（无 bookId 字段）兼容归档：不进任何书的空间列表，但数据保留', () => {
    // 模拟本字段引入前写入的条目。
    store[SESSIONS_STORAGE_KEY] = JSON.stringify([
      { contentId: 'c-old', messages: [message(0)], updatedAt: 100 },
    ]);
    saveChatHistory('c-a', [message(1)], 'book-a');

    const listA = listSessions('book-a');
    expect(listA.map((s) => s.contentId)).toEqual(['c-a']);
    expect(listSessions()).toHaveLength(2); // 全局视图仍能看到归档会话
    // 数据没有被破坏性迁移掉。
    expect(rawSessions().some((s) => s.contentId === 'c-old' && s.bookId === LEGACY_BOOK_ID)).toBe(true);
  });

  it('loadChatHistory 按空间取回：别书同指纹或旧档位都取不到', () => {
    saveChatHistory('c-shared', [message(0)], 'book-a');
    expect(loadChatHistory('c-shared', 'book-a')).toHaveLength(1);
    expect(loadChatHistory('c-shared', 'book-b')).toHaveLength(0);

    store[SESSIONS_STORAGE_KEY] = JSON.stringify([
      { contentId: 'c-old', messages: [message(0)], updatedAt: 100 },
    ]);
    expect(loadChatHistory('c-old', 'book-a')).toHaveLength(0);
    expect(loadChatHistory('c-old')).toHaveLength(1); // 不传 bookId 保持旧语义
  });

  it('同书同指纹的会话才被覆盖，别书同指纹互不影响', () => {
    saveChatHistory('c-shared', [message(0)], 'book-a');
    saveChatHistory('c-shared', [message(1), message(2)], 'book-b');
    expect(loadChatHistory('c-shared', 'book-a')).toEqual([message(0)]);
    expect(loadChatHistory('c-shared', 'book-b')).toHaveLength(2);
    expect(listSessions('book-a')).toHaveLength(1);
    expect(listSessions('book-b')).toHaveLength(1);
  });

  it('清空与撤销只在本书空间内发生', () => {
    saveChatHistory('c-shared', [message(0)], 'book-a');
    saveChatHistory('c-shared', [message(1)], 'book-b');

    const cleared = clearSessionToUndo('c-shared', 'book-a');
    expect(cleared).not.toBeNull();
    expect(cleared?.bookId).toBe('book-a');
    expect(loadChatHistory('c-shared', 'book-a')).toHaveLength(0);
    expect(loadChatHistory('c-shared', 'book-b')).toHaveLength(1);

    const restored = restoreUndo();
    expect(restored?.bookId).toBe('book-a');
    expect(loadChatHistory('c-shared', 'book-a')).toHaveLength(1);
    expect(loadChatHistory('c-shared', 'book-b')).toHaveLength(1);
    expect(peekUndo()).toBeNull();
  });

  it('撤销档写入保留 bookId，别书的撤销不串书', () => {
    saveChatHistory('c-a', [message(0)], 'book-a');
    clearSessionToUndo('c-a', 'book-a');
    const pending = peekUndo();
    expect(pending?.bookId).toBe('book-a');
    // 书 B 里看不到任何可清空对象，也不产生撤销档。
    expect(clearSessionToUndo('c-a', 'book-b')).toBeNull();
    expect(UNDO_STORAGE_KEY in store).toBe(true);
    expect(JSON.parse(store[UNDO_STORAGE_KEY] as string).bookId).toBe('book-a');
  });
});
