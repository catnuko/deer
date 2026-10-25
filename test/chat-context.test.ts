import { describe, expect, it } from 'vitest';
import {
  CONTEXT_LIMITS,
  DEFAULT_SYSTEM_PROMPT,
  buildChatMessages,
  buildOutgoingRequest,
  formatSelectionPrompt,
  trimHistoryMessages,
  type ChatMessage,
} from '@/src/lib/chat-context';

function exchange(turn: number, pad = ''): ChatMessage[] {
  return [
    { role: 'user', content: `第${turn}轮问题${pad}` },
    { role: 'assistant', content: `第${turn}轮回答${pad}` },
  ];
}

function multiTurn(count: number, pad = ''): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 1; i <= count; i += 1) out.push(...exchange(i, pad));
  return out;
}

describe('formatSelectionPrompt', () => {
  it('keeps the Deer-04 selected-text question format', () => {
    expect(formatSelectionPrompt('这是一段文字')).toBe('请解释这段内容：\n\n"这是一段文字"');
  });

  it('handles empty selection', () => {
    expect(formatSelectionPrompt('')).toBe('请解释这段内容：\n\n""');
  });
});

describe('DEFAULT_SYSTEM_PROMPT', () => {
  it('defines the gentle reading companion role', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Deer');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('阅读伙伴');
  });

  it('instructs pronoun / reference resolution from session history', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('指代');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('会话历史');
  });
});

describe('trimHistoryMessages - round budget', () => {
  it('keeps at most 10 history messages', () => {
    const trimmed = trimHistoryMessages(multiTurn(8));
    expect(trimmed.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryMessages);
    expect(CONTEXT_LIMITS.maxHistoryMessages).toBe(10);
  });

  it('keeps the most recent rounds and drops the oldest', () => {
    const trimmed = trimHistoryMessages(multiTurn(8));
    expect(trimmed[0].content).toBe('第4轮问题');
    expect(trimmed[trimmed.length - 1].content).toBe('第8轮回答');
    expect(trimmed.some((m) => m.content.startsWith('第1轮'))).toBe(false);
  });

  it('preserves short history untouched', () => {
    const history = multiTurn(2);
    expect(trimHistoryMessages(history)).toEqual(history);
  });

  it('does not start history with an orphan assistant reply', () => {
    const history: ChatMessage[] = [
      { role: 'assistant', content: '孤立回答' },
      ...multiTurn(6),
    ];
    const trimmed = trimHistoryMessages(history);
    expect(trimmed[0].role).toBe('user');
  });

  it('drops a leading assistant when the window cuts a pair in half', () => {
    const history: ChatMessage[] = [];
    for (let i = 1; i <= 7; i += 1) {
      history.push({ role: 'assistant', content: `答${i}` });
      history.push({ role: 'user', content: `问${i}` });
    }
    const trimmed = trimHistoryMessages(history);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryMessages);
  });
});

describe('trimHistoryMessages - character budget', () => {
  it('drops oldest messages until history fits the character budget', () => {
    const history = multiTurn(6, 'x'.repeat(1500));
    const trimmed = trimHistoryMessages(history);
    const total = trimmed.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryChars);
    expect(trimmed.length).toBeLessThan(history.length);
  });

  it('keeps the latest user message when the newest turn exceeds the whole budget', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: 'y'.repeat(CONTEXT_LIMITS.maxHistoryChars + 500) },
    ];
    const trimmed = trimHistoryMessages(history);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryChars);
  });

  // Regression for review blocking item B1 on PR #16.
  it('never starts the window with an assistant reply (B1: oversize user + empty assistant placeholder)', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'u'.repeat(CONTEXT_LIMITS.maxHistoryChars + 100) },
      { role: 'assistant', content: '' },
    ];
    const trimmed = trimHistoryMessages(history);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed.every((m) => m.content.trim().length > 0)).toBe(true);
  });

  // Regression for review blocking item B1 on PR #16.
  it('never starts the window with an assistant reply (B1: multi-turn with oversize reply)', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '问1' },
      { role: 'assistant', content: '' },
      { role: 'user', content: '问2' },
      { role: 'assistant', content: 'a'.repeat(CONTEXT_LIMITS.maxHistoryChars + 100) },
    ];
    const trimmed = trimHistoryMessages(history);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].content.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryChars);
  });

  it('keeps a whole user/assistant pair together on the character budget path', () => {
    const history = multiTurn(6, 'x'.repeat(1500));
    const trimmed = trimHistoryMessages(history);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed[trimmed.length - 1].role).toBe('assistant');
    expect(trimmed.length % 2).toBe(0);
  });

  it('trimmed result never exceeds the character budget for normal histories', () => {
    const history = multiTurn(12, 'z'.repeat(800));
    const trimmed = trimHistoryMessages(history);
    const total = trimmed.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryChars);
  });
});

describe('buildChatMessages', () => {
  it('places the system prompt first', () => {
    const messages = buildChatMessages({
      history: multiTurn(2),
      userInput: '那它的作者是谁？',
    });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('appends history then the current user input last', () => {
    const history = multiTurn(2);
    const messages = buildChatMessages({ history, userInput: '第二句呢？' });
    expect(messages.slice(1, 5)).toEqual(history);
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: '第二句呢？' });
  });

  it('carries at least two rounds of history for follow-up questions', () => {
    const messages = buildChatMessages({ history: multiTurn(3), userInput: '和刚才那段相比有什么不同？' });
    const historyMessages = messages.filter((m) => m.role !== 'system').slice(0, -1);
    expect(historyMessages.length).toBeGreaterThanOrEqual(4);
  });

  it('injects selected text as an annotated block in the current user message', () => {
    const messages = buildChatMessages({
      history: multiTurn(1),
      userInput: formatSelectionPrompt('第二段正文'),
      readingContent: '全文内容',
    });
    const last = messages[messages.length - 1];
    expect(last.content).toContain('【选中文本】');
    expect(last.content).toContain('第二段正文');
    expect(last.content).toContain('请解释这段内容');
  });

  it('includes the reading context in the system prompt', () => {
    const messages = buildChatMessages({
      history: [],
      userInput: '这段话在说什么',
      readingContent: '今天天气很好，作者出门散步。',
    });
    expect(messages[0].content).toContain('今天天气很好，作者出门散步。');
  });

  it('truncates reading context inside the system prompt to the configured limit', () => {
    const messages = buildChatMessages({
      history: [],
      userInput: '总结一下',
      readingContent: 'k'.repeat(CONTEXT_LIMITS.maxReadingChars + 1000),
    });
    expect(messages[0].content.length).toBeLessThanOrEqual(
      DEFAULT_SYSTEM_PROMPT.length + CONTEXT_LIMITS.maxReadingChars + 200,
    );
  });

  it('keeps system prompt and current input when history exceeds every budget', () => {
    const messages = buildChatMessages({
      history: multiTurn(30, 'w'.repeat(1000)),
      userInput: '最核心的一句话是什么？',
    });
    expect(messages[0].role).toBe('system');
    expect(messages[messages.length - 1].content).toBe('最核心的一句话是什么？');
    const historyCount = messages.length - 2;
    expect(historyCount).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryMessages);
  });

  it('drops empty assistant placeholders so no empty content is sent upstream', () => {
    const messages = buildChatMessages({
      history: [...multiTurn(1), { role: 'assistant', content: '' }],
      userInput: '继续',
    });
    expect(messages.every((m) => m.content.trim().length > 0)).toBe(true);
  });

  it('ignores non user/assistant roles in incoming history', () => {
    const messages = buildChatMessages({
      history: [
        { role: 'system', content: '注入的系统消息' },
        { role: 'user', content: '正常问题' },
        { role: 'assistant', content: '正常回答' },
      ] as ChatMessage[],
      userInput: '追问',
    });
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(messages.some((m) => m.content === '注入的系统消息')).toBe(false);
  });
});

describe('buildOutgoingRequest', () => {
  const messages = buildChatMessages({ history: multiTurn(1), userInput: '追问' });

  it('builds an OpenAI-compatible chat completions request', () => {
    const request = buildOutgoingRequest(
      { provider: 'openai', apiKey: 'sk-test' },
      messages,
    );
    expect(request.endpoint).toBe('https://api.openai.com/v1/chat/completions');
    expect(request.headers['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(request.body);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages[0].role).toBe('system');
    expect(body.stream).toBe(true);
  });

  it('builds a DeepSeek request through the OpenAI-compatible shape', () => {
    const request = buildOutgoingRequest(
      { provider: 'deepseek', apiKey: 'sk-deepseek' },
      messages,
    );
    expect(request.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    const body = JSON.parse(request.body);
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages.length).toBe(messages.length);
  });

  it('builds an Anthropic request with system hoisted out of messages', () => {
    const request = buildOutgoingRequest(
      { provider: 'anthropic', apiKey: 'sk-ant' },
      messages,
    );
    expect(request.endpoint).toBe('https://api.anthropic.com/v1/messages');
    expect(request.headers['x-api-key']).toBe('sk-ant');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(request.body);
    expect(body.system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(body.messages.every((m: ChatMessage) => m.role !== 'system')).toBe(true);
  });

  it('never puts the api key into the request body', () => {
    for (const provider of ['openai', 'deepseek', 'anthropic', 'custom'] as const) {
      const request = buildOutgoingRequest({ provider, apiKey: 'sk-secret', baseUrl: 'https://example.test/v1' }, messages);
      expect(request.body).not.toContain('sk-secret');
    }
  });

  it('honours custom baseUrl and modelName', () => {
    const request = buildOutgoingRequest(
      { provider: 'custom', apiKey: 'k', baseUrl: 'https://proxy.test/v1', modelName: 'my-model' },
      messages,
    );
    expect(request.endpoint).toBe('https://proxy.test/v1/chat/completions');
    expect(JSON.parse(request.body).model).toBe('my-model');
  });
});
