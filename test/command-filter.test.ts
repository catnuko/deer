import { describe, expect, it } from 'vitest';
import { commandTextFilter, matchesQuery } from '@/src/lib/command-filter';

/**
 * The matching rule of the panel searches.
 *
 * The rule the searches used before they were moved onto the Command
 * component is spelled out here as `legacyMatch`, so the two can be
 * compared case by case: a search that returns different rows after the
 * move is a regression, and this is where that is caught.
 */
function legacyMatch(title: string, excerpt: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return title.toLowerCase().includes(needle) || excerpt.toLowerCase().includes(needle);
}

const CASES: Array<{ title: string; excerpt: string; query: string }> = [
  { title: '读书笔记', excerpt: '关于阅读的一段摘录', query: '读书' },
  { title: '读书笔记', excerpt: '关于阅读的一段摘录', query: '读书笔记' },
  { title: '读书笔记', excerpt: '关于阅读的一段摘录', query: 'READING' },
  { title: 'Reading', excerpt: 'excerpt', query: 'reading' },
  { title: '读书笔记', excerpt: '关于阅读的一段摘录', query: '  读书  ' },
  { title: '读书笔记', excerpt: '关于阅读的一段摘录', query: '   ' },
  { title: '读书笔记', excerpt: '关于阅读的一段摘录', query: '' },
  { title: '读书笔记', excerpt: '关于阅读的一段摘录', query: '摘录' },
  { title: '读书笔记', excerpt: '关于阅读的一段摘录', query: '不存在的词' },
  { title: 'a b c', excerpt: '', query: 'a b' },
  { title: 'a b c', excerpt: '', query: 'a  b' },
  { title: 'a b c', excerpt: '', query: 'abc' },
  { title: 'alpha', excerpt: 'beta', query: 'aph' },
  { title: '概念', excerpt: '摘录里才有这个词', query: '才有' },
];

describe('the matching rule of a search', () => {
  it('ignores the case of the query', () => {
    expect(matchesQuery('Reading', 'reading')).toBe(true);
    expect(matchesQuery('Reading', 'READING')).toBe(true);
  });

  it('ignores the spaces around the query', () => {
    expect(matchesQuery('读书笔记', '  读书  ')).toBe(true);
  });

  it('takes a query that is only spaces for an empty query', () => {
    expect(matchesQuery('读书笔记', '   ')).toBe(true);
  });

  it('matches the query as one piece, not as scattered characters', () => {
    // A fuzzy matcher would call this a match; the old rule did not.
    expect(matchesQuery('alpha', 'aph')).toBe(false);
    expect(matchesQuery('a b c', 'abc')).toBe(false);
  });

  it('keeps the spaces inside the query', () => {
    expect(matchesQuery('a b c', 'a b')).toBe(true);
    expect(matchesQuery('a b c', 'a  b')).toBe(false);
  });
});

describe('the filter of the Command lists', () => {
  it('scores a matching row above zero and a missing row at zero', () => {
    expect(commandTextFilter('note-1', '读书', ['读书笔记'])).toBeGreaterThan(0);
    expect(commandTextFilter('note-1', '没有这个词', ['读书笔记'])).toBe(0);
  });

  it('matches the other text of the row as well', () => {
    // The title does not hold the query; the excerpt beside it does.
    expect(commandTextFilter('note-1', '才有', ['概念', '摘录里才有这个词'])).toBeGreaterThan(0);
  });

  it('keeps every row when the query is empty', () => {
    expect(commandTextFilter('note-1', '', ['读书笔记'])).toBeGreaterThan(0);
    expect(commandTextFilter('note-1', '  ', ['别的'])).toBeGreaterThan(0);
  });

  it('does not search the id of the row', () => {
    // The value of a row is its id. An id must not answer to a query:
    // otherwise every row of the list would come back for a short query.
    expect(commandTextFilter('note-3f2a', '3f2', ['读书笔记'])).toBe(0);
  });

  it('returns the same rows as the rule the searches used before', () => {
    for (const { title, excerpt, query } of CASES) {
      const legacy = legacyMatch(title, excerpt, query);
      const current = commandTextFilter('row-id', query, [title, excerpt]) > 0;
      expect(current, `「${title}」/「${excerpt}」/「${query}」`).toBe(legacy);
    }
  });
});
