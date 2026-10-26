import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_EVENT,
  COMMAND_PENDING_KEY,
  COMMAND_TARGET_TTL_MS,
  clearPendingCommand,
  dispatchCommand,
  emitCommand,
  readPendingCommand,
} from '../src/lib/command-events';

/**
 * The ⌘K command channel, branch by branch.
 *
 * Every branch of `src/lib/command-events.ts` has a case here, so the file
 * and the production module can be read side by side:
 *
 * - `emitCommand`     — no window / the event is raised
 * - `dispatchCommand` — no window / settings writes no pending copy /
 *                       session and note do / storage disabled
 * - `readPendingCommand` — no window / no value / storage disabled /
 *                       broken JSON / unknown kind / unusable `at` / too old
 * - `clearPendingCommand` — no window / the copy is gone / storage disabled
 */

type Store = Record<string, string>;

/**
 * A window whose session storage is a plain object, so a case can say what
 * the browser holds without a real browser.
 */
function installWindow(options: { throwOnGet?: boolean; throwOnSet?: boolean; throwOnRemove?: boolean } = {}) {
  const store: Store = {};
  const events: Array<{ type: string; detail: unknown }> = [];

  const sessionStorage = {
    getItem: vi.fn((key: string) => {
      if (options.throwOnGet) throw new Error('storage disabled');
      return key in store ? store[key] : null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (options.throwOnSet) throw new Error('storage disabled');
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      if (options.throwOnRemove) throw new Error('storage disabled');
      delete store[key];
    }),
  };

  vi.stubGlobal('window', {
    sessionStorage,
    dispatchEvent: vi.fn((event: { type: string; detail: unknown }) => {
      events.push({ type: event.type, detail: event.detail });
      return true;
    }),
  });

  return { store, events, sessionStorage };
}

function readPending(store: Store): { kind: string; id?: string; at: number } | null {
  const raw = store[COMMAND_PENDING_KEY];
  return raw ? (JSON.parse(raw) as { kind: string; id?: string; at: number }) : null;
}

describe('emitCommand', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('raises the command as a window event', () => {
    const { events } = installWindow();

    emitCommand({ kind: 'session', id: 'c1', at: 1 });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(COMMAND_EVENT);
    expect(events[0].detail).toMatchObject({ kind: 'session', id: 'c1' });
  });

  it('raises nothing when there is no window', () => {
    vi.stubGlobal('window', undefined);

    expect(() => emitCommand({ kind: 'settings', at: 1 })).not.toThrow();
  });
});

describe('dispatchCommand', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes no pending copy for the settings command', () => {
    const { store, events } = installWindow();

    dispatchCommand('settings');

    expect(store[COMMAND_PENDING_KEY]).toBeUndefined();
    // The event still goes out: the settings panel is on the open page.
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({ kind: 'settings' });
  });

  it('writes a pending copy for a session command', () => {
    const { store, events } = installWindow();

    dispatchCommand('session', 'c1');

    const pending = readPending(store);
    expect(pending?.kind).toBe('session');
    expect(pending?.id).toBe('c1');
    expect(typeof pending?.at).toBe('number');
    expect(events).toHaveLength(1);
  });

  it('writes a pending copy for a note command', () => {
    const { store, events } = installWindow();

    dispatchCommand('note', 'n1');

    const pending = readPending(store);
    expect(pending?.kind).toBe('note');
    expect(pending?.id).toBe('n1');
    expect(typeof pending?.at).toBe('number');
    expect(events).toHaveLength(1);
  });

  it('still raises the event when the storage refuses the copy', () => {
    const { events } = installWindow({ throwOnSet: true });

    expect(() => dispatchCommand('session', 'c1')).not.toThrow();
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({ kind: 'session', id: 'c1' });
  });

  it('does nothing when there is no window', () => {
    vi.stubGlobal('window', undefined);

    expect(() => dispatchCommand('session', 'c1')).not.toThrow();
  });
});

describe('readPendingCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns the stored command while it is fresh', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({ kind: 'session', id: 'c1', at: Date.now() });

    expect(readPendingCommand()).toMatchObject({ kind: 'session', id: 'c1' });
  });

  it('returns nothing when the browser holds no copy', () => {
    installWindow();

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the browser holds an empty copy', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = '';

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the copy cannot be read', () => {
    installWindow({ throwOnGet: true });

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the copy is not valid JSON', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = '{not json';

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the kind is not one the app knows', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({ kind: 'delete-everything', id: 'c1', at: Date.now() });

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the copy carries no kind at all', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({ id: 'c1', at: Date.now() });

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the timestamp is missing', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({ kind: 'session', id: 'c1' });

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the timestamp is not a number', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({ kind: 'session', id: 'c1', at: 'yesterday' });

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the timestamp is not a finite number', () => {
    const { store } = installWindow();
    // 1e999 is a JSON number that reads back as Infinity.
    store[COMMAND_PENDING_KEY] = '{"kind":"session","id":"c1","at":1e999}';

    expect(readPendingCommand()).toBeNull();
  });

  it('returns nothing when the copy is older than the time to live', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({
      kind: 'session',
      id: 'c1',
      at: Date.now() - COMMAND_TARGET_TTL_MS - 1,
    });

    expect(readPendingCommand()).toBeNull();
  });

  it('honours a copy that is exactly at the time to live', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({
      kind: 'note',
      id: 'n1',
      at: Date.now() - COMMAND_TARGET_TTL_MS,
    });

    expect(readPendingCommand()).toMatchObject({ kind: 'note', id: 'n1' });
  });

  it('returns nothing when there is no window', () => {
    vi.stubGlobal('window', undefined);

    expect(readPendingCommand()).toBeNull();
  });
});

describe('clearPendingCommand', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops the stored copy, so a second read finds nothing', () => {
    const { store } = installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({ kind: 'session', id: 'c1', at: Date.now() });

    clearPendingCommand();

    expect(store[COMMAND_PENDING_KEY]).toBeUndefined();
    expect(readPendingCommand()).toBeNull();
  });

  it('does not fail when the storage refuses the removal', () => {
    installWindow({ throwOnRemove: true });

    expect(() => clearPendingCommand()).not.toThrow();
  });

  it('does nothing when there is no window', () => {
    vi.stubGlobal('window', undefined);

    expect(() => clearPendingCommand()).not.toThrow();
  });
});
