import { describe, expect, it } from 'vitest';
import { UPSTREAM_TIMEOUT_MS, parseChatRequest } from '../src/lib/chat-request';

const validConfig = { provider: 'openai', apiKey: 'sk-test' };

function expectInvalid(payload: unknown): { message: string } {
  const parsed = parseChatRequest(payload);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error('expected payload to be rejected');
  return { message: parsed.message };
}

describe('parseChatRequest (S2)', () => {
  it('accepts a valid payload and fills defaults', () => {
    const parsed = parseChatRequest({ config: validConfig, userInput: '你好' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.config).toEqual(validConfig);
    expect(parsed.value.messages).toEqual([]);
    expect(parsed.value.userInput).toBe('你好');
    expect(parsed.value.context).toBeUndefined();
    expect(parsed.value.selectedText).toBeUndefined();
    expect(parsed.value.prompt).toBeUndefined();
  });

  it('keeps optional string fields when present', () => {
    const parsed = parseChatRequest({
      config: { provider: 'custom', apiKey: 'k', baseUrl: 'https://proxy.test/v1', modelName: 'm' },
      messages: [{ role: 'user', content: '问' }],
      userInput: '追问',
      context: '全文',
      selectedText: '选区',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.config.baseUrl).toBe('https://proxy.test/v1');
    expect(parsed.value.config.modelName).toBe('m');
    expect(parsed.value.messages).toEqual([{ role: 'user', content: '问' }]);
    expect(parsed.value.context).toBe('全文');
    expect(parsed.value.selectedText).toBe('选区');
  });

  it('rejects a non-object body', () => {
    expectInvalid(null);
    expectInvalid('oops');
    expectInvalid(42);
    expectInvalid([]);
  });

  it('rejects a missing or non-object config', () => {
    expectInvalid({ userInput: '你好' });
    expectInvalid({ config: 'openai', userInput: '你好' });
  });

  it('rejects an unknown provider without echoing the value', () => {
    const { message } = expectInvalid({ config: { provider: 'javascript-yolo', apiKey: 'sk-x' } });
    expect(message).not.toContain('javascript-yolo');
  });

  it('rejects a non-string provider', () => {
    expectInvalid({ config: { provider: 7, apiKey: 'sk-x' } });
  });

  it('rejects a missing, empty or non-string apiKey without echoing values', () => {
    expectInvalid({ config: { provider: 'openai' } });
    const empty = expectInvalid({ config: { provider: 'openai', apiKey: '' } });
    expect(empty.message).not.toContain('sk-');
    const numeric = expectInvalid({ config: { provider: 'openai', apiKey: 987654321 } });
    expect(numeric.message).not.toContain('987654321');
  });

  it('rejects non-string baseUrl and modelName', () => {
    expectInvalid({ config: { provider: 'openai', apiKey: 'sk', baseUrl: 1 } });
    expectInvalid({ config: { provider: 'openai', apiKey: 'sk', modelName: {} } });
  });

  it('rejects a non-array messages field', () => {
    expectInvalid({ config: validConfig, messages: 'oops' });
  });

  it('rejects malformed message entries', () => {
    expectInvalid({ config: validConfig, messages: ['裸字符串'] });
    expectInvalid({ config: validConfig, messages: [{ role: 'admin', content: 'x' }] });
    expectInvalid({ config: validConfig, messages: [{ role: 'user' }] });
    expectInvalid({ config: validConfig, messages: [{ role: 'user', content: 3 }] });
  });

  it('rejects non-string userInput, prompt, context and selectedText', () => {
    expectInvalid({ config: validConfig, userInput: 5 });
    expectInvalid({ config: validConfig, prompt: {} });
    expectInvalid({ config: validConfig, context: [] });
    expectInvalid({ config: validConfig, selectedText: true });
  });

  it('drops unknown config fields so junk never reaches the upstream request', () => {
    const parsed = parseChatRequest({
      config: { provider: 'openai', apiKey: 'sk', evil: 'x' },
      userInput: '你好',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.config).toEqual({ provider: 'openai', apiKey: 'sk' });
  });

  it('defines a positive upstream timeout constant', () => {
    expect(Number.isFinite(UPSTREAM_TIMEOUT_MS)).toBe(true);
    expect(UPSTREAM_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
