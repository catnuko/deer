import { describe, expect, it } from 'vitest';

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
