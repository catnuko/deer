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

/**
 * The theme as the settings page offers it: an explicit light/dark, or the
 * system preference. The stored value keeps living in the same `deer-theme`
 * key — a 'system' entry simply falls back to light for readers of the old
 * two-value contract, so nothing else has to change.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  return 'light';
}

export function setStoredThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_KEY, preference);
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

/** Write the resolved theme straight onto the document. */
export function applyThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(preference));
}
