import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  COMMAND_EVENT,
  COMMAND_PENDING_KEY,
  COMMAND_TARGET_TTL_MS,
  clearPendingCommand,
  dispatchCommand,
  readPendingCommand,
} from '../src/lib/command-events';
import { NOTES_STORAGE_KEY, listNotes } from '../src/lib/notes';
import { SESSIONS_STORAGE_KEY, listSessions } from '../src/lib/chat-storage';
import { READING_CONTENT_KEY, hasReadingContent } from '../src/lib/reading';

/**
 * The ⌘K palette reads two stores and one session slot. The keys are the
 * contract with the data that is already in the user's browser, so they are
 * pinned here: a rename would silently empty the palette.
 */
function setupWindow() {
  const sessionStore: Record<string, string> = {};
  const events: Array<{ type: string; detail: unknown }> = [];

  const mockSessionStorage = {
    getItem: vi.fn((key: string) => sessionStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      sessionStore[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete sessionStore[key];
    }),
  };

  vi.stubGlobal('window', {
    sessionStorage: mockSessionStorage,
    dispatchEvent: vi.fn((event: { type: string; detail: unknown }) => {
      events.push({ type: event.type, detail: event.detail });
      return true;
    }),
  });

  return { sessionStore, events, mockSessionStorage };
}

describe('the storage the command palette reads', () => {
  beforeEach(() => {
    const local: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => local[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        local[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete local[key];
      }),
    };
    vi.stubGlobal('window', { localStorage: mockLocalStorage });
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the storage keys the app really writes', () => {
    expect(SESSIONS_STORAGE_KEY).toBe('deer-chat-sessions');
    expect(NOTES_STORAGE_KEY).toBe('deer-notes');
    expect(READING_CONTENT_KEY).toBe('deer-reading-content');
  });

  it('lists the stored sessions of deer-chat-sessions', () => {
    window.localStorage.setItem(
      SESSIONS_STORAGE_KEY,
      JSON.stringify([
        { contentId: 'c1', messages: [{ id: 'm1', role: 'user', content: '你好' }], updatedAt: 2 },
      ]),
    );

    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].contentId).toBe('c1');
  });

  it('lists the stored notes of deer-notes', () => {
    window.localStorage.setItem(
      NOTES_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'n1',
          title: '概念',
          excerpt: '片段',
          excerptTruncated: false,
          understanding: '',
          sourceContentId: 'c1',
          sourceLabel: '来源',
          createdAt: 1,
          updatedAt: 1,
          links: [],
        },
      ]),
    );

    const notes = listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('n1');
  });
});

describe('the command bridge of the palette', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('raises the command as a window event', () => {
    const { events } = setupWindow();
    dispatchCommand('settings');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(COMMAND_EVENT);
    expect(events[0].detail).toMatchObject({ kind: 'settings' });
  });

  it('stores a session target so it survives the navigation that follows', () => {
    const { sessionStore } = setupWindow();
    dispatchCommand('session', 'c1');

    const stored = JSON.parse(sessionStore[COMMAND_PENDING_KEY]) as {
      kind: string;
      id: string;
      at: number;
    };
    expect(stored.kind).toBe('session');
    expect(stored.id).toBe('c1');
    expect(typeof stored.at).toBe('number');
  });

  it('does not store the settings command, which needs no navigation', () => {
    const { sessionStore } = setupWindow();
    dispatchCommand('settings');

    expect(sessionStore[COMMAND_PENDING_KEY]).toBeUndefined();
  });

  it('hands the stored command over exactly once', () => {
    setupWindow();
    dispatchCommand('note', 'n1');

    expect(readPendingCommand()).toMatchObject({ kind: 'note', id: 'n1' });
    clearPendingCommand();
    expect(readPendingCommand()).toBeNull();
  });

  it('ignores a command that was never consumed', () => {
    const { sessionStore } = setupWindow();
    sessionStore[COMMAND_PENDING_KEY] = JSON.stringify({
      kind: 'session',
      id: 'c1',
      at: Date.now() - COMMAND_TARGET_TTL_MS - 1,
    });

    expect(readPendingCommand()).toBeNull();
  });

  it('ignores a stored command of an unknown kind', () => {
    const { sessionStore } = setupWindow();
    sessionStore[COMMAND_PENDING_KEY] = JSON.stringify({
      kind: 'delete-everything',
      id: 'c1',
      at: Date.now(),
    });

    expect(readPendingCommand()).toBeNull();
  });

  it('ignores a corrupt stored command', () => {
    const { sessionStore } = setupWindow();
    sessionStore[COMMAND_PENDING_KEY] = '{not json';

    expect(readPendingCommand()).toBeNull();
  });

  it('still raises the command when the storage is disabled', () => {
    const { events } = setupWindow();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: vi.fn(() => {
          throw new Error('disabled');
        }),
        setItem: vi.fn(() => {
          throw new Error('disabled');
        }),
        removeItem: vi.fn(() => {
          throw new Error('disabled');
        }),
      },
      dispatchEvent: vi.fn((event: { type: string; detail: unknown }) => {
        events.push({ type: event.type, detail: event.detail });
        return true;
      }),
    });

    expect(() => dispatchCommand('session', 'c1')).not.toThrow();
    expect(events).toHaveLength(1);
    expect(readPendingCommand()).toBeNull();
  });
});

describe('the reading text the palette needs', () => {
  beforeEach(() => {
    setupWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports no text while the tab has none open', () => {
    expect(hasReadingContent()).toBe(false);
  });

  it('reports the text of the tab', () => {
    window.sessionStorage.setItem(READING_CONTENT_KEY, '  一段文字  ');
    expect(hasReadingContent()).toBe(true);
  });

  it('reports no text for a blank stored text', () => {
    window.sessionStorage.setItem(READING_CONTENT_KEY, '   ');
    expect(hasReadingContent()).toBe(false);
  });
});
