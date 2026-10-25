import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_CHAT_STORAGE_KEY,
  SESSIONS_STORAGE_KEY,
  UNDO_STORAGE_KEY,
  MAX_STORED_MESSAGES,
  MAX_STORED_SESSIONS,
  clearSessionToUndo,
  getReadingContentId,
  isPersistableMessage,
  listSessions,
  loadChatHistory,
  migrateLegacyHistory,
  peekUndo,
  restoreUndo,
  saveChatHistory,
  sanitizeStoredMessages,
  touchSession,
  withCompletedTurn,
  type StoredChatMessage,
  type StoredSession,
} from '../src/lib/chat-storage';

let store: Record<string, string>;
let failingSetItem = false;

function installWindow(): void {
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      if (failingSetItem) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { Object.keys(store).forEach((key) => delete store[key]); }),
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

describe('chat-storage - saveChatHistory (multi slot)', () => {
  beforeEach(() => {
    store = {};
    failingSetItem = false;
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC1: persists sessions as records under the documented multi-slot key', () => {
    saveChatHistory('content-a', [message(1, 'user'), message(2, 'assistant')]);
    expect(SESSIONS_STORAGE_KEY).toBe('deer-chat-sessions');
    const sessions = rawSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].contentId).toBe('content-a');
    expect(sessions[0].messages).toEqual([message(1, 'user'), message(2, 'assistant')]);
    expect(typeof sessions[0].updatedAt).toBe('number');
  });

  it('AC1: saving content B keeps content A intact (Deer-06 limitation 1 removed)', () => {
    saveChatHistory('content-a', [
      { id: '1', role: 'user', content: 'A 的问题' },
      { id: '2', role: 'assistant', content: 'A 的回答' },
    ]);
    saveChatHistory('content-b', [
      { id: '3', role: 'user', content: 'B 的问题' },
      { id: '4', role: 'assistant', content: 'B 的回答' },
    ]);

    expect(loadChatHistory('content-a')).toEqual([
      { id: '1', role: 'user', content: 'A 的问题' },
      { id: '2', role: 'assistant', content: 'A 的回答' },
    ]);
    expect(loadChatHistory('content-b')).toHaveLength(2);
    expect(rawSessions()).toHaveLength(2);
  });

  it('AC1: re-saving the same content upserts one session, newest messages win', () => {
    saveChatHistory('content-a', [message(1, 'user')]);
    saveChatHistory('content-a', [message(1, 'user'), message(2, 'assistant')]);
    expect(rawSessions()).toHaveLength(1);
    expect(loadChatHistory('content-a')).toHaveLength(2);
  });

  it('AC7: stored records never carry config fields', () => {
    saveChatHistory('content-a', [
      { id: '1', role: 'user', content: 'ok', apiKey: 'sk-leak', baseUrl: 'http://x' } as StoredChatMessage,
    ]);
    const raw = store[SESSIONS_STORAGE_KEY];
    for (const forbidden of ['apiKey', 'baseUrl', 'provider', 'modelName', 'sk-']) {
      expect(raw).not.toContain(forbidden);
    }
    const sessions = rawSessions();
    expect(Object.keys(sessions[0]).sort().join(',')).toBe('contentId,messages,updatedAt');
    expect(
      sessions[0].messages.every((m) => Object.keys(m).sort().join(',') === 'content,id,role'),
    ).toBe(true);
  });

  it('AC2: never persists an empty assistant placeholder', () => {
    saveChatHistory('content-a', [message(1, 'user'), { id: '2', role: 'assistant', content: '   ' }]);
    expect(rawSessions()[0].messages).toEqual([message(1, 'user')]);
  });

  it('AC4: each session keeps only the newest 100 messages', () => {
    const many = Array.from({ length: 130 }, (_, i) => message(i));
    saveChatHistory('content-a', many);
    saveChatHistory('content-b', many);
    expect(MAX_STORED_MESSAGES).toBe(100);
    for (const session of rawSessions()) {
      expect(session.messages).toHaveLength(100);
      expect(session.messages[0]).toEqual(message(30));
      expect(session.messages[99]).toEqual(message(129));
    }
  });

  it('AC3: an empty message list removes that session only', () => {
    saveChatHistory('content-a', [message(1, 'user')]);
    saveChatHistory('content-b', [message(2, 'assistant')]);
    saveChatHistory('content-a', []);
    expect(loadChatHistory('content-a')).toEqual([]);
    expect(loadChatHistory('content-b')).toHaveLength(1);
  });

  it('AC3: LRU evicts the oldest updatedAt session beyond 20', () => {
    for (let i = 1; i <= 20; i += 1) {
      saveChatHistory(`content-${i}`, [{ id: `u${i}`, role: 'user', content: `问题 ${i}` }]);
    }
    expect(rawSessions()).toHaveLength(20);
    saveChatHistory('content-21', [{ id: 'u21', role: 'user', content: '问题 21' }]);

    const sessions = rawSessions();
    expect(MAX_STORED_SESSIONS).toBe(20);
    expect(sessions).toHaveLength(20);
    expect(sessions.find((s) => s.contentId === 'content-1')).toBeUndefined();
    expect(sessions.find((s) => s.contentId === 'content-21')).toBeDefined();
    expect(loadChatHistory('content-2')).toEqual([{ id: 'u2', role: 'user', content: '问题 2' }]);
  });

  it('AC3: touch moves a session to the newest slot instead of dropping it', () => {
    for (let i = 1; i <= 20; i += 1) {
      saveChatHistory(`content-${i}`, [{ id: `u${i}`, role: 'user', content: `问题 ${i}` }]);
    }
    touchSession('content-1');
    saveChatHistory('content-21', [{ id: 'u21', role: 'user', content: '问题 21' }]);

    const sessions = rawSessions();
    expect(sessions.find((s) => s.contentId === 'content-1')).toBeDefined();
    expect(sessions.find((s) => s.contentId === 'content-2')).toBeUndefined();
  });

  it('listSessions orders by updatedAt desc with the documented shape', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: 'A' }]);
    saveChatHistory('content-b', [{ id: '2', role: 'user', content: 'B' }]);
    const listed = listSessions();
    expect(listed.map((s) => s.contentId)).toEqual(['content-b', 'content-a']);
    expect(listed[1].messages).toEqual([{ id: '1', role: 'user', content: 'A' }]);
  });

  it('degrades silently when the quota is exhausted', () => {
    failingSetItem = true;
    expect(() => saveChatHistory('content-a', [message(1, 'user')])).not.toThrow();
  });

  it('is a no-op without a window (server rendering)', () => {
    vi.unstubAllGlobals();
    expect(() => saveChatHistory('content-a', [message(1, 'user')])).not.toThrow();
  });
});

describe('chat-storage - loadChatHistory', () => {
  beforeEach(() => {
    store = {};
    failingSetItem = false;
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC1: restores messages in their original order', () => {
    saveChatHistory('content-a', [message(1, 'user'), message(2, 'assistant'), message(3, 'user')]);
    const restored = loadChatHistory('content-a');
    expect(restored.map((m) => m.content)).toEqual(['消息 1', '消息 2', '消息 3']);
    expect(restored.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('AC1: an unknown content id yields an empty session', () => {
    saveChatHistory('content-a', [message(1, 'user')]);
    expect(loadChatHistory('content-b')).toEqual([]);
  });

  it('AC6/AC8: falls back to an empty session on invalid JSON', () => {
    store[SESSIONS_STORAGE_KEY] = '{not json';
    expect(() => loadChatHistory('content-a')).not.toThrow();
    expect(loadChatHistory('content-a')).toEqual([]);
  });

  it('AC8: half-valid payloads keep only structurally valid sessions', () => {
    store[SESSIONS_STORAGE_KEY] = JSON.stringify([
      { contentId: 'content-a', messages: [message(1, 'user')], updatedAt: 5 },
      { contentId: 'content-x', messages: 'oops', updatedAt: 6 },
      { messages: [message(1, 'user')] },
      'text',
    ]);
    expect(loadChatHistory('content-a')).toEqual([message(1, 'user')]);
    expect(loadChatHistory('content-x')).toEqual([]);
  });

  it('AC8: a session list of the wrong shape yields an empty session', () => {
    store[SESSIONS_STORAGE_KEY] = JSON.stringify({ contentId: 'content-a' });
    expect(loadChatHistory('content-a')).toEqual([]);
  });

  it('returns an empty session when nothing is stored', () => {
    expect(loadChatHistory('content-a')).toEqual([]);
  });

  it('is a no-op without a window (server rendering)', () => {
    vi.unstubAllGlobals();
    expect(loadChatHistory('content-a')).toEqual([]);
  });
});

describe('chat-storage - migrateLegacyHistory', () => {
  beforeEach(() => {
    store = {};
    failingSetItem = false;
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC6: migrates the legacy single slot exactly once and deletes the old key', () => {
    expect(LEGACY_CHAT_STORAGE_KEY).toBe('deer-chat-history');
    store[LEGACY_CHAT_STORAGE_KEY] = JSON.stringify({
      contentId: 'content-a',
      messages: [{ id: '1', role: 'user', content: '旧问题' }, { id: '2', role: 'assistant', content: '旧回答' }],
    });

    const migrated = migrateLegacyHistory();
    expect(migrated).toBe(true);
    expect(store[LEGACY_CHAT_STORAGE_KEY]).toBeUndefined();

    const sessions = rawSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].contentId).toBe('content-a');
    expect(sessions[0].messages).toEqual([
      { id: '1', role: 'user', content: '旧问题' },
      { id: '2', role: 'assistant', content: '旧回答' },
    ]);
    expect(typeof sessions[0].updatedAt).toBe('number');

    // A second load must not migrate or duplicate anything.
    expect(migrateLegacyHistory()).toBe(false);
    expect(rawSessions()).toHaveLength(1);
  });

  it('AC6: a migrated legacy session coexists with newly written sessions', () => {
    store[LEGACY_CHAT_STORAGE_KEY] = JSON.stringify({
      contentId: 'content-a',
      messages: [{ id: '1', role: 'user', content: '旧问题' }],
    });
    migrateLegacyHistory();
    saveChatHistory('content-b', [{ id: '2', role: 'user', content: '新问题' }]);

    expect(loadChatHistory('content-a')).toEqual([{ id: '1', role: 'user', content: '旧问题' }]);
    expect(loadChatHistory('content-b')).toEqual([{ id: '2', role: 'user', content: '新问题' }]);
  });

  it('AC6: invalid legacy JSON is discarded, the old key is deleted and storage still works', () => {
    store[LEGACY_CHAT_STORAGE_KEY] = '{broken';
    expect(() => migrateLegacyHistory()).not.toThrow();
    expect(store[LEGACY_CHAT_STORAGE_KEY]).toBeUndefined();
    expect(listSessions()).toEqual([]);

    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '还能用' }]);
    expect(loadChatHistory('content-a')).toEqual([{ id: '1', role: 'user', content: '还能用' }]);
  });

  it('AC6: a legacy session with no persistable messages is dropped with the old key', () => {
    store[LEGACY_CHAT_STORAGE_KEY] = JSON.stringify({
      contentId: 'content-a',
      messages: [{ id: '2', role: 'assistant', content: '' }],
    });
    expect(migrateLegacyHistory()).toBe(true);
    expect(store[LEGACY_CHAT_STORAGE_KEY]).toBeUndefined();
    expect(listSessions()).toEqual([]);
  });

  it('AC6: a clean browser without the legacy key stays empty and never errors', () => {
    expect(migrateLegacyHistory()).toBe(false);
    expect(listSessions()).toEqual([]);
    expect(store[SESSIONS_STORAGE_KEY]).toBeUndefined();
  });

  it('AC6: a legacy id of the wrong shape fails open without throwing', () => {
    store[LEGACY_CHAT_STORAGE_KEY] = JSON.stringify({ messages: [{ id: '1', role: 'user', content: 'x' }] });
    expect(() => migrateLegacyHistory()).not.toThrow();
    expect(store[LEGACY_CHAT_STORAGE_KEY]).toBeUndefined();
    expect(listSessions()).toEqual([]);
  });

  it('is a no-op without a window (server rendering)', () => {
    vi.unstubAllGlobals();
    expect(() => migrateLegacyHistory()).not.toThrow();
  });
});

describe('chat-storage - clearSessionToUndo and restoreUndo', () => {
  beforeEach(() => {
    store = {};
    failingSetItem = false;
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC5: clearing moves the session into the persisted undo slot', () => {
    saveChatHistory('content-a', [
      { id: '1', role: 'user', content: '问题' },
      { id: '2', role: 'assistant', content: '回答' },
    ]);

    const undone = clearSessionToUndo('content-a');
    expect(undone).not.toBeNull();
    expect(loadChatHistory('content-a')).toEqual([]);
    expect(store[UNDO_STORAGE_KEY]).toBeDefined();

    // A panel remount (refresh) reads the slot straight from storage.
    const reloaded = peekUndo();
    expect(reloaded).not.toBeNull();
    expect(reloaded?.contentId).toBe('content-a');
    expect(reloaded?.messages).toEqual([
      { id: '1', role: 'user', content: '问题' },
      { id: '2', role: 'assistant', content: '回答' },
    ]);
  });

  it('AC5: restoreUndo reinserts the session verbatim and empties the slot', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '问题' }]);
    clearSessionToUndo('content-a');

    const restored = restoreUndo();
    expect(restored?.contentId).toBe('content-a');
    expect(loadChatHistory('content-a')).toEqual([{ id: '1', role: 'user', content: '问题' }]);
    expect(peekUndo()).toBeNull();
    expect(store[UNDO_STORAGE_KEY]).toBeUndefined();
  });

  it('AC5 (review): a restored session is touched so it is not the next LRU victim', () => {
    for (let i = 1; i <= 20; i += 1) {
      saveChatHistory(`content-${i}`, [{ id: String(i), role: 'user', content: `会话 ${i}` }]);
    }
    expect(listSessions()).toHaveLength(20);

    clearSessionToUndo('content-1');
    expect(listSessions()).toHaveLength(19);

    const restored = restoreUndo();
    expect(restored?.contentId).toBe('content-1');
    // Restore counts as use: the restored session jumps to the top of the list.
    expect(listSessions()[0]?.contentId).toBe('content-1');

    // The next save evicts the now-oldest session, not the restored one.
    saveChatHistory('content-21', [{ id: '21', role: 'user', content: '新会话' }]);
    const survivors = listSessions().map((s) => s.contentId);
    expect(survivors).toHaveLength(20);
    expect(survivors).toContain('content-1');
    expect(survivors).not.toContain('content-2');
  });

  it('AC5: a later clear replaces the slot, the first clear is unrecoverable', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: 'A 的问题' }]);
    saveChatHistory('content-b', [{ id: '2', role: 'user', content: 'B 的问题' }]);

    clearSessionToUndo('content-a');
    clearSessionToUndo('content-b');

    const restored = restoreUndo();
    expect(restored?.contentId).toBe('content-b');
    expect(loadChatHistory('content-a')).toEqual([]);
    expect(peekUndo()).toBeNull();
  });

  it('AC5: clearing a session that does not exist leaves no undo slot', () => {
    expect(clearSessionToUndo('content-ghost')).toBeNull();
    expect(peekUndo()).toBeNull();
  });

  it('AC5: clearing the session that was just restored removes it again', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '问题' }]);
    clearSessionToUndo('content-a');
    restoreUndo();
    expect(clearSessionToUndo('content-a')).not.toBeNull();
    expect(loadChatHistory('content-a')).toEqual([]);
  });

  it('AC5: restoreUndo without a pending slot returns null and changes nothing', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '问题' }]);
    expect(restoreUndo()).toBeNull();
    expect(loadChatHistory('content-a')).toHaveLength(1);
  });

  it('AC7: the persisted undo slot never carries config fields', () => {
    saveChatHistory('content-a', [
      { id: '1', role: 'user', content: '问题', apiKey: 'sk-leak', provider: 'openai' } as StoredChatMessage,
    ]);
    clearSessionToUndo('content-a');

    const raw = store[UNDO_STORAGE_KEY];
    for (const forbidden of ['apiKey', 'baseUrl', 'provider', 'modelName', 'sk-']) {
      expect(raw).not.toContain(forbidden);
    }
    const parsed = JSON.parse(raw) as { contentId: string; messages: Record<string, unknown>[] };
    expect(Object.keys(parsed).sort().join(',')).toBe('contentId,messages,updatedAt');
    expect(Object.keys(parsed.messages[0]).sort().join(',')).toBe('content,id,role');
  });

  it('AC8: an unreadable undo slot fails open to no undo', () => {
    store[UNDO_STORAGE_KEY] = '{broken';
    expect(peekUndo()).toBeNull();
    expect(restoreUndo()).toBeNull();
  });

  it('AC5 (review): a failed undo-slot write keeps the session in the list', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '问题' }]);
    saveChatHistory('content-b', [{ id: '2', role: 'user', content: 'B 的问题' }]);

    failingSetItem = true;
    expect(clearSessionToUndo('content-a')).toBeNull();

    // Nothing was cleared: the list is untouched and no "removed but slotless" state exists.
    expect(listSessions().map((s) => s.contentId)).toEqual(['content-b', 'content-a']);
    expect(peekUndo()).toBeNull();
  });

  it('AC5 (review): a failed restore list write keeps the undo slot for a retry', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '问题' }]);
    clearSessionToUndo('content-a');
    expect(loadChatHistory('content-a')).toEqual([]);

    failingSetItem = true;
    expect(restoreUndo()).toBeNull();
    // Nothing was restored and the slot survived, so the user can retry.
    expect(loadChatHistory('content-a')).toEqual([]);
    expect(peekUndo()?.contentId).toBe('content-a');

    failingSetItem = false;
    const restored = restoreUndo();
    expect(restored?.contentId).toBe('content-a');
    expect(loadChatHistory('content-a')).toEqual([{ id: '1', role: 'user', content: '问题' }]);
    expect(peekUndo()).toBeNull();
  });

  it('degrades silently when the quota is exhausted', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '问题' }]);
    failingSetItem = true;
    expect(() => clearSessionToUndo('content-a')).not.toThrow();
    expect(() => touchSession('content-a')).not.toThrow();
  });

  it('are safe without a window (server rendering)', () => {
    vi.unstubAllGlobals();
    expect(() => clearSessionToUndo('content-a')).not.toThrow();
    expect(clearSessionToUndo('content-a')).toBeNull();
    expect(peekUndo()).toBeNull();
    expect(restoreUndo()).toBeNull();
  });
});

describe('chat-storage - touchSession', () => {
  beforeEach(() => {
    store = {};
    failingSetItem = false;
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC3: touching updates updatedAt to now without changing messages', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '问题' }]);
    const before = rawSessions()[0];
    store[SESSIONS_STORAGE_KEY] = JSON.stringify([{ ...before, updatedAt: before.updatedAt - 60_000 }]);

    touchSession('content-a');

    const after = rawSessions()[0];
    expect(Date.now() - after.updatedAt).toBeLessThan(5_000);
    expect(after.messages).toEqual(before.messages);
    expect(listSessions().map((s) => s.contentId)).toEqual(['content-a']);
  });

  it('touching an unknown session changes nothing', () => {
    saveChatHistory('content-a', [{ id: '1', role: 'user', content: '问题' }]);
    const snapshot = store[SESSIONS_STORAGE_KEY];
    touchSession('content-ghost');
    expect(store[SESSIONS_STORAGE_KEY]).toBe(snapshot);
  });
});

describe('chat-storage - sanitizeStoredMessages', () => {
  it('drops entries with unknown roles, missing ids or blank content', () => {
    const sanitized = sanitizeStoredMessages([
      { id: '1', role: 'user', content: 'ok' },
      { id: '2', role: 'system', content: 'injected' },
      { id: '', role: 'user', content: 'no id' },
      { id: '3', role: 'assistant', content: '   ' },
      { id: '4', role: 'assistant', content: 42 },
      null,
      'text',
    ]);
    expect(sanitized).toEqual([{ id: '1', role: 'user', content: 'ok' }]);
  });

  it('caps the sanitized list to the newest messages', () => {
    const many = Array.from({ length: 120 }, (_, i) => message(i));
    expect(sanitizeStoredMessages(many)).toHaveLength(MAX_STORED_MESSAGES);
  });

  it('returns an empty list for non-array input', () => {
    expect(sanitizeStoredMessages(null)).toEqual([]);
    expect(sanitizeStoredMessages({})).toEqual([]);
  });

  it('keeps only the documented fields', () => {
    const sanitized = sanitizeStoredMessages([
      { id: '1', role: 'user', content: 'ok', apiKey: 'sk-leak', baseUrl: 'http://x' },
    ]);
    expect(sanitized).toEqual([{ id: '1', role: 'user', content: 'ok' }]);
  });
});

describe('chat-storage - isPersistableMessage', () => {
  it('accepts a finished user or assistant message', () => {
    expect(isPersistableMessage(message(1, 'user'))).toBe(true);
    expect(isPersistableMessage(message(2, 'assistant'))).toBe(true);
  });

  it('rejects the empty assistant placeholder used while streaming', () => {
    expect(isPersistableMessage({ id: '9', role: 'assistant', content: '' })).toBe(false);
  });
});

describe('chat-storage - withCompletedTurn', () => {
  const existing: StoredChatMessage[] = [
    { id: '1', role: 'user', content: '第一个问题' },
    { id: '2', role: 'assistant', content: '第一个回答' },
  ];
  const user: StoredChatMessage = { id: '3', role: 'user', content: '第二个问题' };

  it('appends the user turn and its finished reply', () => {
    const result = withCompletedTurn(existing, user, { id: '4', role: 'assistant', content: '第二个回答' });
    expect(result).toEqual([...existing, user, { id: '4', role: 'assistant', content: '第二个回答' }]);
  });

  it('B1: an empty reply keeps the previous conversation untouched', () => {
    const result = withCompletedTurn(existing, user, { id: '4', role: 'assistant', content: '' });
    expect(result).toEqual(existing);
  });

  it('B1: a whitespace-only reply is treated as unfinished', () => {
    expect(withCompletedTurn(existing, user, { id: '4', role: 'assistant', content: '  \n' })).toEqual(existing);
  });

  it('B1: an interrupted stream does not change what storage already holds', () => {
    installWindow();
    const contentId = getReadingContentId('全文');
    saveChatHistory(contentId, existing);

    saveChatHistory(contentId, withCompletedTurn(existing, user, { id: '4', role: 'assistant', content: '' }));

    expect(loadChatHistory(contentId)).toEqual(existing);
    vi.unstubAllGlobals();
    installWindow();
  });
});

describe('chat-storage - getReadingContentId', () => {
  it('AC5: is stable for identical text', () => {
    expect(getReadingContentId('同一段文字')).toBe(getReadingContentId('同一段文字'));
  });

  it('AC5: differs for different texts', () => {
    expect(getReadingContentId('文本 A')).not.toBe(getReadingContentId('文本 B'));
  });

  it('AC5: distinguishes texts that only differ late in the document', () => {
    const base = 'x'.repeat(3000);
    expect(getReadingContentId(base + 'a')).not.toBe(getReadingContentId(base + 'b'));
  });

  it('returns an empty id for empty content', () => {
    expect(getReadingContentId('   ')).toBe('');
  });
});
