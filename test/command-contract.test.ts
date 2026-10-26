import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_PENDING_KEY,
  COMMAND_TARGET_TTL_MS,
  clearPendingCommand,
  dispatchCommand,
  readPendingCommand,
} from '../src/lib/command-events';
import {
  READING_CONTENT_KEY,
  READING_TITLE_KEY,
  READING_TYPE_KEY,
} from '../src/lib/reading';

/**
 * The contract between the page that writes the reading text and the pages
 * that read it. The keys live in `src/lib/reading.ts`; both sides must use
 * them, or the text is written under one name and looked for under another.
 */
function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('the reading storage keys', () => {
  it('pins the key names the browser already holds', () => {
    expect(READING_CONTENT_KEY).toBe('deer-reading-content');
    expect(READING_TITLE_KEY).toBe('deer-reading-title');
    expect(READING_TYPE_KEY).toBe('deer-reading-type');
  });

  it('writes the reading text through the shared constants on the start page', () => {
    const source = readSource('../app/page.tsx');

    expect(source).toContain('READING_CONTENT_KEY');
    expect(source).toContain('READING_TITLE_KEY');
    expect(source).toContain('READING_TYPE_KEY');
    // A literal key on the writing side is the drift this guards against:
    // renaming the constant would leave the start page writing under the old
    // name while the reading page reads the new one.
    expect(source).not.toContain("'deer-reading-content'");
    expect(source).not.toContain("'deer-reading-title'");
    expect(source).not.toContain("'deer-reading-type'");
  });

  it('reads the reading text through the shared constants on the reading page', () => {
    const source = readSource('../app/read/page.tsx');

    expect(source).toContain('READING_CONTENT_KEY');
    expect(source).toContain('READING_TITLE_KEY');
    expect(source).toContain('READING_TYPE_KEY');
    expect(source).not.toContain("'deer-reading-content'");
  });
});

describe('the freshness of a pending command', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function installWindow() {
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
      },
      dispatchEvent: vi.fn(() => true),
    });
  }

  it('honours a command that is exactly at the age limit', () => {
    // The clock is frozen for this case only. The stored copy is written at
    // `Date.now() - TTL` and read a moment later; with a running clock the
    // read can cross a millisecond, which turns the age from exactly the
    // limit into one millisecond past it and fails the case at random.
    // Freezing the clock keeps the age at exactly the limit, which is the
    // boundary the case is about.
    vi.useFakeTimers();
    try {
      installWindow();
      store[COMMAND_PENDING_KEY] = JSON.stringify({
        kind: 'session',
        id: 'c1',
        at: Date.now() - COMMAND_TARGET_TTL_MS,
      });

      expect(readPendingCommand()).toMatchObject({ kind: 'session', id: 'c1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a command that is one millisecond past the age limit', () => {
    installWindow();
    store[COMMAND_PENDING_KEY] = JSON.stringify({
      kind: 'session',
      id: 'c1',
      at: Date.now() - COMMAND_TARGET_TTL_MS - 1,
    });

    expect(readPendingCommand()).toBeNull();
  });

  it('does not fire an unconsumed command on a later visit', () => {
    installWindow();
    // A command raised while another page was open, never consumed.
    dispatchCommand('session', 'c1');

    // The reader comes back much later: the stored copy is too old to fire.
    store[COMMAND_PENDING_KEY] = JSON.stringify({
      kind: 'session',
      id: 'c1',
      at: Date.now() - COMMAND_TARGET_TTL_MS - 1,
    });

    expect(readPendingCommand()).toBeNull();
  });

  it('leaves nothing behind after the command was handed over', () => {
    installWindow();
    dispatchCommand('note', 'n1');

    expect(readPendingCommand()).toMatchObject({ kind: 'note', id: 'n1' });
    clearPendingCommand();
    // A second visit finds no command: the stored copy was dropped.
    expect(store[COMMAND_PENDING_KEY]).toBeUndefined();
    expect(readPendingCommand()).toBeNull();
  });
});
