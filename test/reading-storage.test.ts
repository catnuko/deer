import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  READING_CONTENT_KEY,
  READING_TITLE_KEY,
  READING_TYPE_KEY,
  hasReadingContent,
} from '../src/lib/reading';

/**
 * The storage contract of the reading text.
 *
 * The text lives in the session storage of the tab that opened it, and the
 * key names are the contract between the page that writes the text and the
 * pages that read it. A rename on one side only would leave the reader
 * without a text, so the names are pinned here.
 */

function installWindow(options: { throwOnGet?: boolean } = {}) {
  const store: Record<string, string> = {};

  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: vi.fn((key: string) => {
        if (options.throwOnGet) throw new Error('storage disabled');
        return key in store ? store[key] : null;
      }),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
    },
  });

  return { store };
}

describe('the reading storage keys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins the key names the browser already holds', () => {
    expect(READING_CONTENT_KEY).toBe('deer-reading-content');
    expect(READING_TITLE_KEY).toBe('deer-reading-title');
    expect(READING_TYPE_KEY).toBe('deer-reading-type');
  });
});

describe('hasReadingContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the text of the tab when there is one', () => {
    const { store } = installWindow();
    store[READING_CONTENT_KEY] = '鹿在林间停下脚步。';

    expect(hasReadingContent()).toBe(true);
  });

  it('reports no text when the stored text is empty', () => {
    const { store } = installWindow();
    store[READING_CONTENT_KEY] = '';

    expect(hasReadingContent()).toBe(false);
  });

  it('reports no text when the tab holds nothing', () => {
    installWindow();

    expect(hasReadingContent()).toBe(false);
  });

  it('reports no text for a blank stored text', () => {
    const { store } = installWindow();
    store[READING_CONTENT_KEY] = '   \n  ';

    expect(hasReadingContent()).toBe(false);
  });

  it('reports no text when the storage cannot be read', () => {
    installWindow({ throwOnGet: true });

    expect(hasReadingContent()).toBe(false);
  });

  it('reports no text when there is no window', () => {
    vi.stubGlobal('window', undefined);

    expect(hasReadingContent()).toBe(false);
  });
});
