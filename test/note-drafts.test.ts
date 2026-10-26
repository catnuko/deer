import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNotePatch, createDraftController, type NotePatch } from '../src/lib/note-drafts';
import type { StoredNote } from '../src/lib/notes';

function note(overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    id: 'a',
    title: '旧概念名',
    excerpt: '摘录',
    excerptTruncated: false,
    understanding: '旧理解',
    sourceContentId: 'c1-abc',
    sourceLabel: '来源文本',
    createdAt: 1000,
    updatedAt: 1000,
    links: [],
    ...overrides,
  };
}

describe('buildNotePatch', () => {
  const target = note();

  it('patches only the title when only the title was edited', () => {
    expect(buildNotePatch(target, { title: '新概念名', understanding: null })).toEqual({
      title: '新概念名',
    });
  });

  it('patches only the understanding when only the understanding was edited', () => {
    expect(buildNotePatch(target, { title: null, understanding: '新的理解' })).toEqual({
      understanding: '新的理解',
    });
  });

  it('drops a blank title and keeps the stored one', () => {
    expect(buildNotePatch(target, { title: '   ', understanding: null })).toEqual({});
  });

  it('allows clearing the understanding to an empty string', () => {
    expect(buildNotePatch(target, { title: null, understanding: '' })).toEqual({
      understanding: '',
    });
  });

  it('produces an empty patch when nothing changed', () => {
    expect(buildNotePatch(target, { title: '旧概念名', understanding: '旧理解' })).toEqual({});
    expect(buildNotePatch(target, { title: null, understanding: null })).toEqual({});
  });

  it('patches both fields when both were edited', () => {
    expect(buildNotePatch(target, { title: '新概念名', understanding: '新的理解' })).toEqual({
      title: '新概念名',
      understanding: '新的理解',
    });
  });
});

describe('createDraftController - 300ms debounce persists the latest values (B2)', () => {
  let calls: Array<{ target: StoredNote; patch: NotePatch }>;
  let persist: (target: StoredNote, patch: NotePatch) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    persist = (target, patch) => {
      calls.push({ target, patch });
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the typed title after the debounce delay without any blur', () => {
    const controller = createDraftController({ delayMs: 300, persist });
    const target = note();

    controller.edit(target, 'title', 'Hello');
    expect(calls).toHaveLength(0);

    vi.advanceTimersByTime(300);
    expect(calls).toHaveLength(1);
    expect(calls[0].target).toBe(target);
    expect(calls[0].patch).toEqual({ title: 'Hello' });
  });

  it('persists only the understanding when only that field was typed', () => {
    const controller = createDraftController({ delayMs: 300, persist });
    const target = note();

    controller.edit(target, 'understanding', '新的理解');
    vi.advanceTimersByTime(300);

    expect(calls[0].patch).toEqual({ understanding: '新的理解' });
  });

  it('persists the newest value when the user keeps typing', () => {
    const controller = createDraftController({ delayMs: 300, persist });
    const target = note();

    controller.edit(target, 'title', 'Hel');
    vi.advanceTimersByTime(200);
    controller.edit(target, 'title', 'Hello');
    vi.advanceTimersByTime(200);
    expect(calls).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(calls).toHaveLength(1);
    expect(calls[0].patch).toEqual({ title: 'Hello' });
  });

  it('persists both fields when both were typed', () => {
    const controller = createDraftController({ delayMs: 300, persist });
    const target = note();

    controller.edit(target, 'title', '新概念名');
    controller.edit(target, 'understanding', '新的理解');
    vi.advanceTimersByTime(300);

    expect(calls[0].patch).toEqual({ title: '新概念名', understanding: '新的理解' });
  });

  it('flushes on demand and does not write twice', () => {
    const controller = createDraftController({ delayMs: 300, persist });
    const target = note();

    controller.edit(target, 'title', 'Hello');
    controller.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].patch).toEqual({ title: 'Hello' });

    vi.advanceTimersByTime(300);
    expect(calls).toHaveLength(1);
  });

  it('does not persist when nothing was edited', () => {
    const controller = createDraftController({ delayMs: 300, persist });
    expect(controller.flush()).toBeNull();
    vi.advanceTimersByTime(300);
    expect(calls).toHaveLength(0);
  });

  it('drops the pending draft on reset without writing it', () => {
    const controller = createDraftController({ delayMs: 300, persist });
    const target = note();

    controller.edit(target, 'title', 'Hello');
    controller.reset();
    vi.advanceTimersByTime(300);

    expect(calls).toHaveLength(0);
    expect(controller.values()).toEqual({ title: null, understanding: null });
  });

  it('persists to the note the draft belongs to', () => {
    const controller = createDraftController({ delayMs: 300, persist });
    const first = note({ id: 'a' });
    const second = note({ id: 'b' });

    controller.edit(first, 'title', '第一个');
    controller.edit(second, 'title', '第二个');
    vi.advanceTimersByTime(300);

    expect(calls).toHaveLength(1);
    expect(calls[0].target).toBe(second);
    expect(calls[0].patch).toEqual({ title: '第二个' });
  });
});
