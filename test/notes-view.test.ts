import { describe, expect, it } from 'vitest';
import type { StoredNote } from '../src/lib/notes';
import {
  HIGHLIGHT_COLORS,
  bookListOf,
  deriveHighlightColor,
  deriveNoteKind,
  filterNotes,
  formatRelativeTime,
} from '../src/lib/notes-view';
import { createSeedNotes } from '../src/lib/notes-seed';

function makeNote(overrides: Partial<StoredNote>): StoredNote {
  return {
    id: 'n1',
    title: '标题',
    excerpt: '摘录内容',
    excerptTruncated: false,
    understanding: '',
    sourceContentId: 'c1',
    sourceLabel: '《三体》· 第 3 章',
    createdAt: 0,
    updatedAt: 0,
    links: [],
    ...overrides,
  };
}

describe('deriveHighlightColor', () => {
  it('always returns one of the five board colours', () => {
    for (let i = 0; i < 50; i += 1) {
      const color = deriveHighlightColor(`note-${i}`);
      expect(HIGHLIGHT_COLORS.some((c) => c.id === color.id)).toBe(true);
    }
  });

  it('is stable for the same id', () => {
    expect(deriveHighlightColor('seed-1')).toEqual(deriveHighlightColor('seed-1'));
  });

  it('spreads ids across more than one colour', () => {
    const used = new Set(Array.from({ length: 50 }, (_, i) => deriveHighlightColor(`n${i}`).id));
    expect(used.size).toBeGreaterThan(1);
  });
});

describe('deriveNoteKind', () => {
  it('marks ai: prefixed source ids as AI 问答', () => {
    expect(deriveNoteKind(makeNote({ sourceContentId: 'ai:x' }))).toBe('ai');
  });

  it('marks notes with an annotation as 笔记', () => {
    expect(deriveNoteKind(makeNote({ understanding: '有批注' }))).toBe('note');
  });

  it('falls back to 高亮', () => {
    expect(deriveNoteKind(makeNote({}))).toBe('highlight');
  });
});

describe('filterNotes', () => {
  const notes = [
    makeNote({ id: 'a', understanding: '有批注' }),
    makeNote({ id: 'b', sourceContentId: 'ai:x', sourceLabel: '《三体》· 第 12 章' }),
    makeNote({ id: 'c', title: 'Another', sourceLabel: '《球状闪电》' }),
  ];

  it('filters by tab', () => {
    expect(filterNotes(notes, { tab: 'note', book: null, colorId: null, query: '' }).map((n) => n.id)).toEqual(['a']);
    expect(filterNotes(notes, { tab: 'ai', book: null, colorId: null, query: '' }).map((n) => n.id)).toEqual(['b']);
  });

  it('filters by book', () => {
    const result = filterNotes(notes, { tab: 'all', book: '《球状闪电》', colorId: null, query: '' });
    expect(result.map((n) => n.id)).toEqual(['c']);
  });

  it('filters by search across title, excerpt and understanding', () => {
    const byTitle = filterNotes(notes, { tab: 'all', book: null, colorId: null, query: 'another' });
    expect(byTitle.map((n) => n.id)).toEqual(['c']);
    const byAnnotation = filterNotes(notes, { tab: 'all', book: null, colorId: null, query: '有批注' });
    expect(byAnnotation.map((n) => n.id)).toEqual(['a']);
  });

  it('combines filters with AND', () => {
    const result = filterNotes(notes, { tab: 'ai', book: '《球状闪电》', colorId: null, query: '' });
    expect(result).toEqual([]);
  });
});

describe('bookListOf', () => {
  it('extracts unique 《…》 book names', () => {
    const books = bookListOf(createSeedNotes(0));
    expect(books).toEqual(['《三体》']);
  });

  it('falls back to the whole label when no 《…》 segment exists', () => {
    expect(bookListOf([makeNote({ sourceLabel: '无书名来源' })])).toEqual(['无书名来源']);
  });
});

describe('formatRelativeTime', () => {
  const now = 1_000_000_000_000;
  const cases: [number, string][] = [
    [now - 10_000, '刚刚'],
    [now - 5 * 60_000, '5 分钟前'],
    [now - 3 * 3_600_000, '3 小时前'],
    [now - 26 * 3_600_000, '昨天'],
    [now - 3 * 86_400_000, '3 天前'],
    [now - 8 * 86_400_000, '上周'],
    [now - 20 * 86_400_000, '2 周前'],
  ];

  for (const [timestamp, expected] of cases) {
    it(`formats ${timestamp} as ${expected}`, () => {
      expect(formatRelativeTime(timestamp, now)).toBe(expected);
    });
  }
});

describe('createSeedNotes', () => {
  it('produces valid StoredNote-shaped entries without touching storage', () => {
    const seeds = createSeedNotes(0);
    expect(seeds.length).toBeGreaterThan(0);
    for (const note of seeds) {
      expect(typeof note.id).toBe('string');
      expect(typeof note.excerpt).toBe('string');
      expect(Array.isArray(note.links)).toBe(true);
    }
    expect(seeds.some((n) => n.sourceContentId.startsWith('ai:'))).toBe(true);
  });
});
