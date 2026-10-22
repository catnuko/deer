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
