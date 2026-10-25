import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_STORAGE_KEY,
  MAX_STORED_MESSAGES,
  clearChatHistory,
  getReadingContentId,
  isPersistableMessage,
  loadChatHistory,
  saveChatHistory,
  sanitizeStoredMessages,
  type StoredChatMessage,
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

function roundTrip(messages: StoredChatMessage[]): string {
  return JSON.stringify({ contentId: 'content-a', messages });
}

describe('chat-storage - saveChatHistory', () => {
  beforeEach(() => {
    store = {};
    failingSetItem = false;
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC1: persists completed messages under the documented key', () => {
    saveChatHistory('content-a', [message(1, 'user'), message(2, 'assistant')]);
    const raw = store[CHAT_STORAGE_KEY];
    expect(CHAT_STORAGE_KEY).toBe('deer-chat-history');
    const parsed = JSON.parse(raw) as { contentId: string; messages: StoredChatMessage[] };
    expect(parsed.contentId).toBe('content-a');
    expect(parsed.messages).toEqual([message(1, 'user'), message(2, 'assistant')]);
  });

  it('AC8: stored payload contains no config fields and no api key', () => {
    saveChatHistory('content-a', [message(1, 'user'), message(2, 'assistant')]);
    const raw = store[CHAT_STORAGE_KEY];
    for (const forbidden of ['apiKey', 'baseUrl', 'provider', 'modelName', 'sk-']) {
      expect(raw).not.toContain(forbidden);
    }
    const parsed = JSON.parse(raw) as { messages: Record<string, unknown>[] };
    expect(parsed.messages.every((m) => Object.keys(m).sort().join(',') === 'content,id,role')).toBe(true);
  });

  it('AC2: never persists an empty assistant placeholder', () => {
    saveChatHistory('content-a', [message(1, 'user'), { id: '2', role: 'assistant', content: '   ' }]);
    const parsed = JSON.parse(store[CHAT_STORAGE_KEY]) as { messages: StoredChatMessage[] };
    expect(parsed.messages).toEqual([message(1, 'user')]);
  });

  it('AC7: keeps only the newest 100 messages', () => {
    const many = Array.from({ length: 130 }, (_, i) => message(i));
    saveChatHistory('content-a', many);
    const parsed = JSON.parse(store[CHAT_STORAGE_KEY]) as { messages: StoredChatMessage[] };
    expect(MAX_STORED_MESSAGES).toBe(100);
    expect(parsed.messages).toHaveLength(100);
    expect(parsed.messages[0]).toEqual(message(30));
    expect(parsed.messages[99]).toEqual(message(129));
  });

  it('AC4: an empty message list removes the stored session', () => {
    saveChatHistory('content-a', [message(1, 'user')]);
    saveChatHistory('content-a', []);
    expect(store[CHAT_STORAGE_KEY]).toBeUndefined();
    expect(loadChatHistory('content-a')).toEqual([]);
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
    store[CHAT_STORAGE_KEY] = roundTrip([message(1, 'user'), message(2, 'assistant'), message(3, 'user')]);
    const restored = loadChatHistory('content-a');
    expect(restored.map((m) => m.content)).toEqual(['消息 1', '消息 2', '消息 3']);
    expect(restored.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('AC5: returns an empty session when the reading content id differs', () => {
    store[CHAT_STORAGE_KEY] = roundTrip([message(1, 'user')]);
    expect(() => loadChatHistory('content-b')).not.toThrow();
    expect(loadChatHistory('content-b')).toEqual([]);
  });

  it('AC5: keeps the stored session for content A while hiding it for content B', () => {
    store[CHAT_STORAGE_KEY] = roundTrip([message(1, 'user'), message(2, 'assistant')]);
    expect(loadChatHistory('content-b')).toEqual([]);
    expect(loadChatHistory('content-a')).toHaveLength(2);
    expect(store[CHAT_STORAGE_KEY]).toContain('content-a');
  });

  it('AC6: falls back to an empty session on invalid JSON', () => {
    store[CHAT_STORAGE_KEY] = '{not json';
    expect(() => loadChatHistory('content-a')).not.toThrow();
    expect(loadChatHistory('content-a')).toEqual([]);
  });

  it('AC6: falls back to an empty session when the payload shape is wrong', () => {
    store[CHAT_STORAGE_KEY] = JSON.stringify({ contentId: 'content-a', messages: 'oops' });
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

describe('chat-storage - clearChatHistory', () => {
  beforeEach(() => {
    store = {};
    failingSetItem = false;
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC4: removes the stored session so a reload shows no old history', () => {
    saveChatHistory('content-a', [message(1, 'user'), message(2, 'assistant')]);
    clearChatHistory();
    expect(store[CHAT_STORAGE_KEY]).toBeUndefined();
    expect(loadChatHistory('content-a')).toEqual([]);
  });

  it('is idempotent and safe without a window', () => {
    expect(() => clearChatHistory()).not.toThrow();
    vi.unstubAllGlobals();
    expect(() => clearChatHistory()).not.toThrow();
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
