import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_EXCERPT_CHARS,
  MAX_NOTES,
  NOTES_STORAGE_KEY,
  connectNotes,
  createNote,
  deleteNote,
  deriveNoteTitle,
  disconnectNotes,
  getNote,
  listNotes,
  updateNote,
  type StoredNote,
} from '../src/lib/notes';

let localStore: Record<string, string>;

function installWindow(): void {
  const localStorageMock = {
    getItem: vi.fn((key: string) => localStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { localStore[key] = value; }),
    removeItem: vi.fn((key: string) => { delete localStore[key]; }),
    clear: vi.fn(() => { localStore = {}; }),
  };
  vi.stubGlobal('window', { localStorage: localStorageMock });
  vi.stubGlobal('localStorage', localStorageMock);
}

function seedNotes(notes: StoredNote[]): void {
  localStore[NOTES_STORAGE_KEY] = JSON.stringify(notes);
}

function note(id: string, overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    id,
    title: `概念${id}`,
    excerpt: `摘录${id}`,
    excerptTruncated: false,
    understanding: '',
    sourceContentId: 'c1-abc',
    sourceLabel: '来源文本',
    createdAt: 1000,
    updatedAt: 1000,
    links: [],
    ...overrides,
  };
}

describe('createNote - capture fields (AC1/AC7 捕获字段)', () => {
  beforeEach(() => {
    localStore = {};
    installWindow();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a note with all capture fields and persists it', () => {
    const result = createNote({
      selection: '重要概念原文',
      sourceContentId: 'c1-abc',
      sourceLabel: '第一章',
    });
    expect(result.ok).toBe(true);
    const created = result.ok ? result.note : null;
    expect(created?.title.length).toBeGreaterThan(0);
    expect(created?.excerpt).toBe('重要概念原文');
    expect(created?.excerptTruncated).toBe(false);
    expect(created?.sourceContentId).toBe('c1-abc');
    expect(created?.sourceLabel).toBe('第一章');
    expect(created?.createdAt).toBeGreaterThan(0);
    expect(created?.updatedAt).toBe(created?.createdAt);
    expect(listNotes()).toHaveLength(1);
  });

  it('truncates excerpts beyond the 500-char cap and flags it', () => {
    const long = 'x'.repeat(MAX_EXCERPT_CHARS + 100);
    const result = createNote({ selection: long, sourceContentId: 'c1', sourceLabel: 's' });
    expect(result.ok).toBe(true);
    const created = result.ok ? result.note : null;
    expect(created?.excerpt.length).toBe(MAX_EXCERPT_CHARS);
    expect(created?.excerptTruncated).toBe(true);
  });

  it('reports the cap as its own reason instead of evicting silently', () => {
    const full: StoredNote[] = [];
    for (let i = 0; i < MAX_NOTES; i += 1) full.push(note(`n${i}`, { updatedAt: i }));
    seedNotes(full);
    expect(createNote({ selection: '新概念', sourceContentId: 'c', sourceLabel: 's' })).toEqual({
      ok: false,
      reason: 'cap',
    });
    expect(listNotes()).toHaveLength(MAX_NOTES);
  });

  it('rejects an empty selection', () => {
    expect(createNote({ selection: '   ', sourceContentId: 'c', sourceLabel: 's' })).toEqual({
      ok: false,
      reason: 'empty',
    });
  });
});

describe('deriveNoteTitle', () => {
  it('takes the first sentence and caps the length', () => {
    expect(deriveNoteTitle('第一句。第二句！第三句？')).toBe('第一句。');
    expect(deriveNoteTitle('没有句号的一整段很长内容')).toBe('没有句号的一整段很长内容');
    const long = `${'长'.repeat(30)}。`;
    expect(deriveNoteTitle(long).length).toBeLessThanOrEqual(21);
    expect(deriveNoteTitle(long).endsWith('…')).toBe(true);
  });
});

describe('connectNotes / disconnectNotes (AC7 连接幂等、解除双清、自连接忽略)', () => {
  beforeEach(() => {
    localStore = {};
    installWindow();
    seedNotes([note('a'), note('b'), note('c')]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a bidirectional link exactly once on repeated connects (idempotent)', () => {
    expect(connectNotes('a', 'b')).toBe(true);
    expect(connectNotes('a', 'b')).toBe(true);
    const a = getNote('a');
    const b = getNote('b');
    expect(a?.links).toEqual(['b']);
    expect(b?.links).toEqual(['a']);
  });

  it('ignores self-connection silently', () => {
    expect(connectNotes('a', 'a')).toBe(false);
    expect(getNote('a')?.links).toEqual([]);
  });

  it('ignores connects when either side is missing', () => {
    expect(connectNotes('a', 'missing')).toBe(false);
    expect(connectNotes('missing', 'b')).toBe(false);
  });

  it('removes the link from both sides on disconnect', () => {
    connectNotes('a', 'b');
    expect(disconnectNotes('a', 'b')).toBe(true);
    expect(getNote('a')?.links).toEqual([]);
    expect(getNote('b')?.links).toEqual([]);
    expect(disconnectNotes('a', 'b')).toBe(false);
  });
});

describe('deleteNote (AC7 删除级联清边)', () => {
  beforeEach(() => {
    localStore = {};
    installWindow();
    seedNotes([note('a'), note('b'), note('c')]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deletes the note and clears every edge pointing to it', () => {
    connectNotes('a', 'b');
    connectNotes('a', 'c');
    connectNotes('b', 'c');
    expect(deleteNote('a')).toBe(true);
    expect(listNotes().map((n) => n.id).sort()).toEqual(['b', 'c']);
    expect(getNote('b')?.links).toEqual(['c']);
    expect(getNote('c')?.links).toEqual(['b']);
  });

  it('returns false for an unknown id without touching others', () => {
    expect(deleteNote('missing')).toBe(false);
    expect(listNotes()).toHaveLength(3);
  });
});

describe('updateNote (AC2 编辑即时持久化)', () => {
  beforeEach(() => {
    localStore = {};
    installWindow();
    seedNotes([note('a'), note('c')]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists edits and bumps updatedAt without changing links', () => {
    connectNotes('a', 'c');
    const updated = updateNote('a', { title: '新名', understanding: '我的理解' });
    expect(updated?.title).toBe('新名');
    expect(updated?.understanding).toBe('我的理解');
    expect(updated?.links).toEqual(['c']);
    expect(listNotes()[0].title).toBe('新名');
  });

  it('returns null for an unknown id', () => {
    expect(updateNote('missing', { title: 'x' })).toBeNull();
  });
});

describe('corrupt storage degradation (AC6/AC7 损坏降级)', () => {
  beforeEach(() => {
    localStore = {};
    installWindow();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('degrades to an empty library with a console warn and never throws', () => {
    localStore[NOTES_STORAGE_KEY] = '{not-json';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(listNotes()).toEqual([]);
    expect(createNote({ selection: '新概念', sourceContentId: 'c', sourceLabel: 's' }).ok).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not touch chat storage when deer-notes is corrupt', () => {
    localStore['deer-chat-sessions'] = '[{"contentId":"c1","messages":[],"updatedAt":1}]';
    localStore[NOTES_STORAGE_KEY] = 'garbage{';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    listNotes();
    warn.mockRestore();
    expect(JSON.parse(localStore['deer-chat-sessions'])).toHaveLength(1);
  });
});

describe('quota failure (失败路径)', () => {
  beforeEach(() => {
    localStore = {};
    installWindow();
    seedNotes([note('a')]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports failure without corrupting stored data when the write throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn((key: string) => localStore[key] ?? null),
        setItem: vi.fn(() => {
          throw new DOMException('QuotaExceededError');
        }),
        removeItem: vi.fn((key: string) => { delete localStore[key]; }),
      },
    });
    expect(createNote({ selection: '新', sourceContentId: 'c', sourceLabel: 's' })).toEqual({
      ok: false,
      reason: 'quota',
    });
    expect(JSON.parse(localStore[NOTES_STORAGE_KEY])).toHaveLength(1);
    expect(connectNotes('a', 'a')).toBe(false);
  });
});
