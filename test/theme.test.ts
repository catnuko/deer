import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { getStoredTheme, setStoredTheme } from '../src/lib/theme';

describe('theme utilities', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
      clear: vi.fn(() => { Object.keys(store).forEach(key => delete store[key]); }),
    };

    // Mock window and localStorage
    vi.stubGlobal('window', { localStorage: mockLocalStorage });
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getStoredTheme', () => {
    it('returns light when nothing is stored', () => {
      expect(getStoredTheme()).toBe('light');
    });

    it('returns the stored theme when valid', () => {
      store['deer-theme'] = 'dark';
      expect(getStoredTheme()).toBe('dark');
    });

    it('returns light when stored value is invalid', () => {
      store['deer-theme'] = 'blue';
      expect(getStoredTheme()).toBe('light');
    });
  });

  describe('setStoredTheme', () => {
    it('stores dark theme', () => {
      setStoredTheme('dark');
      expect(store['deer-theme']).toBe('dark');
    });

    it('stores light theme', () => {
      setStoredTheme('light');
      expect(store['deer-theme']).toBe('light');
    });
  });
});
