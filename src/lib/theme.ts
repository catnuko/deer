export type Theme = 'light' | 'dark';

const THEME_KEY = 'deer-theme';

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

export function setStoredTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_KEY, theme);
}

/**
 * Hydration-safe store for the theme: server render and the client's first
 * render both see the fallback, then the component subscribes and re-renders
 * with the real stored value. Without this, a dark-theme user's first client
 * render (☀️) would differ from the SSR shell (🌙) and trip React #418.
 */
export function subscribeStoredTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (): void => onChange();
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
