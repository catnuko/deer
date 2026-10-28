import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_READING_PREFS,
  READING_PREFS_KEY,
  getReadingPrefs,
  saveReadingPrefs,
} from '../src/lib/reading-prefs';

/**
 * The reading preferences are an additive store (`deer-reading-prefs`): the
 * settings page writes them, nothing else reads them yet. The contract pinned
 * here is the key name and the clamping — a corrupt or out-of-range payload
 * must never reach the reading page as a broken default.
 */
function setupWindow() {
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
  return local;
}

describe('reading preferences', () => {
  let local: Record<string, string>;

  beforeEach(() => {
    local = setupWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults when nothing is stored', () => {
    expect(getReadingPrefs()).toEqual(DEFAULT_READING_PREFS);
  });

  it('round-trips a saved payload', () => {
    saveReadingPrefs({ fontSize: 20, lineHeight: 1.8, pageWidth: 720 });
    expect(local[READING_PREFS_KEY]).toBeDefined();
    expect(getReadingPrefs()).toEqual({ fontSize: 20, lineHeight: 1.8, pageWidth: 720 });
  });

  it('clamps stored values back into range', () => {
    local[READING_PREFS_KEY] = JSON.stringify({ fontSize: 99, lineHeight: 0.1, pageWidth: 100 });
    expect(getReadingPrefs()).toEqual({ fontSize: 24, lineHeight: 1.4, pageWidth: 480 });
  });

  it('falls back on a corrupt payload', () => {
    local[READING_PREFS_KEY] = '{not json';
    expect(getReadingPrefs()).toEqual(DEFAULT_READING_PREFS);
  });

  it('falls back field by field on wrong types', () => {
    local[READING_PREFS_KEY] = JSON.stringify({ fontSize: 'big', lineHeight: 2 });
    expect(getReadingPrefs()).toEqual({ ...DEFAULT_READING_PREFS, lineHeight: 2 });
  });
});
