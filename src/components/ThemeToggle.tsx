'use client';

import { useEffect, useState } from 'react';
import { type Theme, getStoredTheme, setStoredTheme } from '@/src/lib/theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function toggleTheme() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    setStoredTheme(next);
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
