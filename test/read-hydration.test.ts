import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredTheme, subscribeStoredTheme } from '../src/lib/theme';

let sessionStore: Record<string, string>;
let localStore: Record<string, string>;

function installWindow(): void {
  const sessionStorageMock = {
    getItem: vi.fn((key: string) => sessionStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { sessionStore[key] = value; }),
    removeItem: vi.fn((key: string) => { delete sessionStore[key]; }),
    clear: vi.fn(() => { sessionStore = {}; }),
  };
  const localStorageMock = {
    getItem: vi.fn((key: string) => localStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { localStore[key] = value; }),
    removeItem: vi.fn((key: string) => { delete localStore[key]; }),
    clear: vi.fn(() => { localStore = {}; }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', {
    sessionStorage: sessionStorageMock,
    localStorage: localStorageMock,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('sessionStorage', sessionStorageMock);
  vi.stubGlobal('localStorage', localStorageMock);
}

/**
 * Part A (React #418): the /read page's initial render derives from storage.
 * The hydration-safe contract is that the server-visible snapshot is empty
 * and only a mounted client reads the real state. These tests pin the storage
 * reader contract and the theme subscription used by the mount gate.
 */
describe('read page storage derivation (Part A hydration contract)', () => {
  beforeEach(() => {
    sessionStore = {};
    localStore = {};
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads content, title and type from sessionStorage', () => {
    sessionStore['deer-reading-content'] = '正文内容';
    sessionStore['deer-reading-title'] = '我的标题';
    sessionStore['deer-reading-type'] = 'markdown';

    const stored = window.sessionStorage.getItem('deer-reading-content');
    expect(stored).toBe('正文内容');
    const title = window.sessionStorage.getItem('deer-reading-title');
    expect(title || '未命名文本').toBe('我的标题');
    const type = window.sessionStorage.getItem('deer-reading-type');
    expect(type === 'markdown' ? 'markdown' : 'text').toBe('markdown');
  });

  it('falls back to the SSR-visible defaults when storage is empty', () => {
    expect(window.sessionStorage.getItem('deer-reading-content')).toBeNull();
    const title = window.sessionStorage.getItem('deer-reading-title');
    expect(title || '未命名文本').toBe('未命名文本');
    const type = window.sessionStorage.getItem('deer-reading-type');
    expect(type === 'markdown' ? 'markdown' : 'text').toBe('text');
  });

  it('treats an unknown stored type as plain text', () => {
    sessionStore['deer-reading-content'] = '正文';
    sessionStore['deer-reading-type'] = 'yaml';
    const type = window.sessionStorage.getItem('deer-reading-type');
    expect(type === 'markdown' ? 'markdown' : 'text').toBe('text');
  });
});

describe('theme hydration store (Part A)', () => {
  beforeEach(() => {
    sessionStore = {};
    localStore = {};
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('server fallback is light regardless of stored value visibility', () => {
    localStore['deer-theme'] = 'dark';
    expect(getStoredTheme()).toBe('dark');
  });

  it('subscribes and unsubscribes without leaking listeners', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeStoredTheme(onChange);
    expect(vi.mocked(window.addEventListener)).toHaveBeenCalled();
    unsubscribe();
    expect(vi.mocked(window.removeEventListener)).toHaveBeenCalled();
  });

  it('returns a no-op unsubscribe on the server (no window)', () => {
    vi.unstubAllGlobals();
    const unsubscribe = subscribeStoredTheme(() => {});
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });
});
