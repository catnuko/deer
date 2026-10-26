'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { type Theme, getStoredTheme, setStoredTheme, subscribeStoredTheme } from '@/src/lib/theme';

function subscribe(onChange: () => void): () => void {
  return subscribeStoredTheme(onChange);
}

// Server snapshot and the client's first hydration snapshot are identical
// (the light fallback), so the toggle cannot mismatch the SSR shell. The
// stored theme is picked up in the same tick via the external-store update.
function getServerSnapshot(): Theme {
  return 'light';
}

function getSnapshot(): Theme {
  return getStoredTheme();
}

// B1 regression fix: the effect runs on mount too, so a stored dark theme is
// applied to data-theme right after hydration (SSR hardcodes light). The
// render itself still hydrates with 'light' via getServerSnapshot, so the
// React #418 mismatch cannot come back — the dark swap is a post-hydration
// update, never a first-render difference.
export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function toggleTheme() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setStoredTheme(next);
    // Same-document writes do not fire a storage event; notify our own
    // subscription so the store (and this button) re-render from storage.
    window.dispatchEvent(new StorageEvent('storage', { key: 'deer-theme' }));
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
      type="button"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
