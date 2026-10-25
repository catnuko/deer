import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_LIMITS } from '@/src/lib/chat-context';

type CapturedCall = { url: string; init: RequestInit };

const captured: CapturedCall[] = [];

function sseResponse(chunks: string[], provider: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const text of chunks) {
        const payload = provider === 'anthropic'
          ? JSON.stringify({ type: 'content_block_delta', delta: { text } })
          : JSON.stringify({ choices: [{ delta: { content: text } }] });
        controller.enqueue(encoder.encode(`data: ${payload}\n`));
      }
      if (provider !== 'anthropic') controller.enqueue(encoder.encode('data: [DONE]\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function readAll(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function makeRequest(payload: unknown): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

interface UpstreamBody {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  system?: string;
  stream?: boolean;
}

function lastBody(): UpstreamBody {
  return JSON.parse(String(captured[captured.length - 1].init.body)) as UpstreamBody;
}

describe('POST /api/chat - multi-turn context (Issue #15)', () => {
  beforeEach(() => {
    captured.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init: init ?? {} });
      return sseResponse(['你', '好'], 'openai');
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('AC3: request body sent upstream contains system + history + current input', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const history = [
      { role: 'user', content: '这段话在说什么' },
      { role: 'assistant', content: '它在讲作者的一次散步' },
      { role: 'user', content: '第二句呢' },
      { role: 'assistant', content: '第二句在写天气' },
    ];

    const response = await POST(makeRequest({
      config: { provider: 'openai', apiKey: 'sk-test' },
      messages: history,
      userInput: '那它的作者是谁？',
      context: '作者出门散步。',
    }));

    expect(response.status).toBe(200);
    const body = lastBody();
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('作者出门散步');
    expect(body.messages.slice(1, 5)).toEqual(history);
    expect(body.messages[body.messages.length - 1]).toEqual({
      role: 'user',
      content: '那它的作者是谁？',
    });
  });

  it('AC3: api key stays only in the Authorization header, never in the body', async () => {
    const { POST } = await import('@/app/api/chat/route');
    await POST(makeRequest({
      config: { provider: 'openai', apiKey: 'sk-very-secret' },
      messages: [],
      userInput: '你好',
    }));

    expect(String(captured[0].init.body)).not.toContain('sk-very-secret');
    expect((captured[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-very-secret');
  });

  it('AC4: over-budget history is trimmed and the request still succeeds', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const history = [];
    for (let i = 1; i <= 15; i += 1) {
      history.push({ role: 'user', content: `第${i}轮问题` + 'q'.repeat(600) });
      history.push({ role: 'assistant', content: `第${i}轮回答` + 'a'.repeat(600) });
    }

    const response = await POST(makeRequest({
      config: { provider: 'deepseek', apiKey: 'sk-test' },
      messages: history,
      userInput: '最核心的一句话是什么？',
    }));

    expect(response.status).toBe(200);
    const body = lastBody();
    const sentHistory = body.messages.slice(1, -1);
    expect(sentHistory.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryMessages);
    const historyChars = sentHistory.reduce((sum: number, m: { content: string }) => sum + m.content.length, 0);
    expect(historyChars).toBeLessThanOrEqual(CONTEXT_LIMITS.maxHistoryChars);
    expect(sentHistory[0].content.startsWith('第1轮')).toBe(false);
    expect(body.messages[body.messages.length - 1].content).toBe('最核心的一句话是什么？');
  });

  it('AC5: chapter summary and the follow-up share one conversation thread', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const summaryTurn = [
      { role: 'user', content: '请总结本章的主要内容（前500字）：' },
      { role: 'assistant', content: '本章讲了一棵树与一位老人。' },
    ];

    await POST(makeRequest({
      config: { provider: 'openai', apiKey: 'sk-test' },
      messages: summaryTurn,
      userInput: '最核心的一句话是什么？',
    }));

    const body = lastBody();
    expect(body.messages).toHaveLength(4);
    expect(body.messages[2].content).toBe('本章讲了一棵树与一位老人。');
  });

  it('AC6: streaming works for anthropic with system hoisted', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init: init ?? {} });
      return sseResponse(['逐', '字'], 'anthropic');
    }));
    const { POST } = await import('@/app/api/chat/route');

    const response = await POST(makeRequest({
      config: { provider: 'anthropic', apiKey: 'sk-ant', modelName: 'claude-3-5-sonnet-20241022' },
      messages: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好呀' }],
      userInput: '继续',
    }));

    expect(await readAll(response)).toBe('逐字');
    const body = lastBody();
    expect(typeof body.system).toBe('string');
    expect(body.messages.every((m) => m.role !== 'system')).toBe(true);
    expect(body.stream).toBe(true);
  });

  it('AC6: streaming works for openai and deepseek', async () => {
    const { POST } = await import('@/app/api/chat/route');
    for (const provider of ['openai', 'deepseek'] as const) {
      const response = await POST(makeRequest({
        config: { provider, apiKey: 'sk-test' },
        messages: [],
        userInput: '你好',
      }));
      expect(await readAll(response)).toBe('你好');
    }
  });

  it('keeps the legacy single-field `prompt` input working', async () => {
    const { POST } = await import('@/app/api/chat/route');
    await POST(makeRequest({
      config: { provider: 'openai', apiKey: 'sk-test' },
      prompt: '旧版单轮请求',
    }));

    const body = lastBody();
    expect(body.messages[body.messages.length - 1].content).toBe('旧版单轮请求');
  });

  it('rejects requests without AI configuration', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(makeRequest({ messages: [], userInput: '你好' }));
    expect(response.status).toBe(400);
    expect(captured).toHaveLength(0);
  });

  it('surfaces upstream errors without leaking the api key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(makeRequest({
      config: { provider: 'openai', apiKey: 'sk-very-secret' },
      messages: [],
      userInput: '你好',
    }));
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain('sk-very-secret');
  });
});
