import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChatMessages, formatSelectionPrompt, trimHistoryMessages } from '@/src/lib/chat-context';
import {
  CHAT_STORAGE_KEY,
  clearChatHistory,
  getReadingContentId,
  loadChatHistory,
  saveChatHistory,
  withCompletedTurn,
  type StoredChatMessage,
} from '@/src/lib/chat-storage';

describe('AI panel message formatting', () => {
  it('formats selected text as a question', () => {
    const selectedText = '这是一段需要解释的内容';
    const question = `请解释这段内容：\n\n"${selectedText}"`;
    expect(question).toContain('请解释这段内容');
    expect(question).toContain(selectedText);
  });

  it('handles empty selected text', () => {
    const selectedText = '';
    const question = `请解释这段内容：\n\n"${selectedText}"`;
    expect(question).toBe('请解释这段内容：\n\n""');
  });

  it('generates chapter summary prompt', () => {
    const summaryPrompt = '请总结本章的主要内容（前500字）：';
    expect(summaryPrompt).toContain('总结');
    expect(summaryPrompt).toContain('500字');
  });
});

describe('AI panel context truncation', () => {
  it('truncates reading content to 2000 characters', () => {
    const longContent = 'a'.repeat(3000);
    const truncated = longContent.slice(0, 2000);
    expect(truncated.length).toBe(2000);
  });

  it('preserves short content as-is', () => {
    const shortContent = 'Short content';
    const truncated = shortContent.slice(0, 2000);
    expect(truncated).toBe(shortContent);
  });
});

describe('AI message structure', () => {
  it('creates user message with correct structure', () => {
    const message = {
      id: '123',
      role: 'user' as const,
      content: 'Hello',
    };
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello');
    expect(message.id).toBeDefined();
  });

  it('creates assistant message with correct structure', () => {
    const message = {
      id: '456',
      role: 'assistant' as const,
      content: 'Hi there',
    };
    expect(message.role).toBe('assistant');
    expect(message.content).toBe('Hi there');
  });
});

describe('AI panel multi-turn payload (Issue #15)', () => {
  it('sends the panel session history plus the current question', () => {
    const session = [
      { role: 'user' as const, content: '这段话在说什么' },
      { role: 'assistant' as const, content: '在描述一位老人' },
    ];
    const payload = buildChatMessages({
      history: trimHistoryMessages(session),
      userInput: formatSelectionPrompt('第二段'),
      readingContent: '全文',
    });
    expect(payload[0].role).toBe('system');
    expect(payload.slice(1, 3)).toEqual(session);
    expect(payload[3].content).toContain('【选中文本】');
  });

  it('keeps the current selected-text question intact after trimming', () => {
    const longSession = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `历史消息 ${i} ` + 'x'.repeat(400),
    }));
    const payload = buildChatMessages({
      history: trimHistoryMessages(longSession),
      userInput: formatSelectionPrompt('需要解释的句子'),
    });
    expect(payload[payload.length - 1].content).toContain('需要解释的句子');
  });
});

describe('AI panel persistence (Issue #19)', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
    };
    vi.stubGlobal('window', { localStorage: mockLocalStorage });
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The panel keeps the full conversation in memory but only sends the
   *  trimmed window, and persists the turn once the reply is complete. */
  function finishTurn(
    conversation: StoredChatMessage[],
    contentId: string,
    question: string,
    reply: string,
  ) {
    const history = trimHistoryMessages(conversation);
    saveChatHistory(contentId, [
      ...conversation,
      { id: 'u-new', role: 'user', content: question },
      { id: 'a-new', role: 'assistant', content: reply },
    ]);
    return buildChatMessages({ history, userInput: question, readingContent: '全文' });
  }

  it('AC3: restored history reaches buildChatMessages and goes through trimming', () => {
    const content = '第一段讲时间，第二段讲记忆。';
    const contentId = getReadingContentId(content);
    saveChatHistory(contentId, [
      { id: '1', role: 'user', content: '这段话在说什么' },
      { id: '2', role: 'assistant', content: '讲到时间与记忆两点' },
    ]);

    const restored = loadChatHistory(contentId);
    expect(restored).toHaveLength(2);

    const payload = finishTurn(restored, contentId, '第二点是什么意思', '第二点说的是记忆');
    expect(payload[0].role).toBe('system');
    expect(payload[1]).toEqual({ role: 'user', content: '这段话在说什么' });
    expect(payload[2]).toEqual({ role: 'assistant', content: '讲到时间与记忆两点' });
    expect(payload[payload.length - 1]).toEqual({ role: 'user', content: '第二点是什么意思' });

    // The completed turn is persisted, so a reload restores the same window.
    const afterReload = loadChatHistory(contentId);
    expect(afterReload).toHaveLength(4);
    expect(afterReload.slice(0, 2)).toEqual(restored);
    expect(trimHistoryMessages(afterReload)).toEqual([
      { role: 'user', content: '这段话在说什么' },
      { role: 'assistant', content: '讲到时间与记忆两点' },
      { role: 'user', content: '第二点是什么意思' },
      { role: 'assistant', content: '第二点说的是记忆' },
    ]);
  });

  it('AC3: an oversized restored session is still trimmed and stays user-first', () => {
    const contentId = getReadingContentId('全文');
    const long: StoredChatMessage[] = Array.from({ length: 24 }, (_, i) => ({
      id: String(i),
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `历史 ${i} ` + 'x'.repeat(500),
    }));
    saveChatHistory(contentId, long);
    const restored = loadChatHistory(contentId);
    expect(restored).toHaveLength(24);

    const payload = finishTurn(restored, contentId, '接着上文说', '收到');
    const dialogue = payload.slice(1);
    expect(dialogue[0].role).toBe('user');
    const historyMessages = dialogue.slice(0, -1);
    expect(historyMessages.length).toBeLessThanOrEqual(10);
    expect(historyMessages.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(8000);
  });

  it('AC2: a turn that never got its full reply leaves no partial message behind', () => {
    const contentId = getReadingContentId('全文');
    saveChatHistory(contentId, [
      { id: '1', role: 'user', content: '第一个问题' },
      { id: '2', role: 'assistant', content: '第一个回答' },
      { id: '3', role: 'user', content: '第二个问题' },
      { id: '4', role: 'assistant', content: '' },
    ]);

    expect(loadChatHistory(contentId)).toEqual([
      { id: '1', role: 'user', content: '第一个问题' },
      { id: '2', role: 'assistant', content: '第一个回答' },
      { id: '3', role: 'user', content: '第二个问题' },
    ]);
  });

  it('AC4: clearing the conversation drops the persisted session', () => {
    const contentId = getReadingContentId('全文');
    saveChatHistory(contentId, [{ id: '1', role: 'user', content: '问题' }]);
    expect(store[CHAT_STORAGE_KEY]).toBeDefined();

    clearChatHistory();
    expect(store[CHAT_STORAGE_KEY]).toBeUndefined();
    expect(loadChatHistory(contentId)).toEqual([]);
  });

  it('AC5: another reading text starts clean and switching back restores it', () => {
    const textA = '文本 A 的内容';
    const textB = '文本 B 的内容';
    const idA = getReadingContentId(textA);
    const idB = getReadingContentId(textB);

    saveChatHistory(idA, [
      { id: '1', role: 'user', content: 'A 的问题' },
      { id: '2', role: 'assistant', content: 'A 的回答' },
    ]);

    expect(getReadingContentId(textA)).not.toBe(getReadingContentId(textB));
    expect(loadChatHistory(idB)).toEqual([]);
    expect(loadChatHistory(idA)).toHaveLength(2);
  });

  it('AC8: the persisted session never carries configuration fields', () => {
    const contentId = getReadingContentId('全文');
    saveChatHistory(contentId, [{ id: '1', role: 'user', content: '问题' }]);
    const raw = store[CHAT_STORAGE_KEY];
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('baseUrl');
  });

  it('S1: a single slot means saving B overwrites A, so A no longer restores', () => {
    const idA = getReadingContentId('文本 A 的内容');
    const idB = getReadingContentId('文本 B 的内容');
    saveChatHistory(idA, [
      { id: '1', role: 'user', content: 'A 的问题' },
      { id: '2', role: 'assistant', content: 'A 的回答' },
    ]);
    saveChatHistory(idB, [
      { id: '3', role: 'user', content: 'B 的问题' },
      { id: '4', role: 'assistant', content: 'B 的回答' },
    ]);

    expect(loadChatHistory(idA)).toEqual([]);
    expect(loadChatHistory(idB)).toHaveLength(2);
  });

  it('AC2 (panel): an interrupted stream leaves the persisted history untouched', () => {
    const contentId = getReadingContentId('全文');
    saveChatHistory(contentId, [
      { id: '1', role: 'user', content: '第一个问题' },
      { id: '2', role: 'assistant', content: '第一个回答' },
    ]);
    const before = loadChatHistory(contentId);

    // The panel collects the stream, then persists exactly this turn; an empty
    // reply here stands for a stream that produced no text (B1 regression).
    const interrupted = withCompletedTurn(
      before,
      { id: '3', role: 'user', content: '第二个问题' },
      { id: '4', role: 'assistant', content: '' },
    );
    saveChatHistory(contentId, interrupted);

    expect(loadChatHistory(contentId)).toEqual(before);
  });

  it('AC2 (panel): a finished stream persists the whole turn', () => {
    const contentId = getReadingContentId('全文');
    saveChatHistory(contentId, [
      { id: '1', role: 'user', content: '第一个问题' },
      { id: '2', role: 'assistant', content: '第一个回答' },
    ]);
    const before = loadChatHistory(contentId);

    const streamed = ['第一', '段'.repeat(3), '回复'].join('');
    saveChatHistory(
      contentId,
      withCompletedTurn(
        before,
        { id: '3', role: 'user', content: '第二个问题' },
        { id: '4', role: 'assistant', content: streamed },
      ),
    );

    expect(loadChatHistory(contentId)).toEqual([
      ...before,
      { id: '3', role: 'user', content: '第二个问题' },
      { id: '4', role: 'assistant', content: '第一段段段回复' },
    ]);
  });
});
