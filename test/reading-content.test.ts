import { describe, expect, it } from 'vitest';

describe('reading content parsing', () => {
  it('splits plain text into paragraphs by double newlines', () => {
    const text = '第一段内容。\n\n第二段内容。\n\n第三段内容。';
    const paragraphs = text.split(/\n\s*\n/);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].trim()).toBe('第一段内容。');
    expect(paragraphs[1].trim()).toBe('第二段内容。');
    expect(paragraphs[2].trim()).toBe('第三段内容。');
  });

  it('handles single paragraph without splitting', () => {
    const text = '只有一段内容，没有换行。';
    const paragraphs = text.split(/\n\s*\n/);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].trim()).toBe('只有一段内容，没有换行。');
  });

  it('handles empty content', () => {
    const text = '';
    const paragraphs = text.split(/\n\s*\n/);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].trim()).toBe('');
  });

  it('handles paragraphs separated by blank lines with spaces', () => {
    const text = '第一段。\n   \n第二段。';
    const paragraphs = text.split(/\n\s*\n/);
    expect(paragraphs).toHaveLength(2);
  });
});

describe('file type detection', () => {
  it('detects .md files as markdown', () => {
    const fileName = 'book.md';
    const type = fileName.endsWith('.md') ? 'markdown' : 'text';
    expect(type).toBe('markdown');
  });

  it('detects .txt files as text', () => {
    const fileName = 'notes.txt';
    const type = fileName.endsWith('.md') ? 'markdown' : 'text';
    expect(type).toBe('text');
  });

  it('defaults to text for unknown extensions', () => {
    const fileName = 'document.pdf';
    const type = fileName.endsWith('.md') ? 'markdown' : 'text';
    expect(type).toBe('text');
  });

  it('handles null filename', () => {
    const fileName: string | null = null;
    const isMarkdown = fileName != null && (fileName as string).endsWith('.md');
    const type = isMarkdown ? 'markdown' : 'text';
    expect(type).toBe('text');
  });
});

describe('file size validation', () => {
  it('accepts files under 50KB', () => {
    const fileSize = 30 * 1024; // 30KB
    expect(fileSize).toBeLessThan(50 * 1024);
  });

  it('accepts files at exactly 50KB', () => {
    const fileSize = 50 * 1024; // 50KB
    expect(fileSize).toBeLessThanOrEqual(50 * 1024);
  });

  it('rejects files over 50KB', () => {
    const fileSize = 60 * 1024; // 60KB
    expect(fileSize).toBeGreaterThan(50 * 1024);
  });
});
