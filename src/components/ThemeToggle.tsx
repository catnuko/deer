'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
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

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme, touched]);

  function toggleTheme() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTouched(true);
    setStoredTheme(next);
    document.documentElement.setAttribute('data-theme', next);
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
