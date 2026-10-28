/**
 * The reading preferences of the settings page (阅读偏好): default font
 * size, line height and page width. They live in their own `deer-reading-prefs`
 * key, which is additive — none of the existing storage contracts
 * (`deer-notes`, `deer-chat-sessions`, `deer-ai-config`) is touched.
 *
 * The reading page keeps its own popup state for now; these are the defaults
 * a reader sets once and expects every text to start from.
 */

export interface ReadingPrefs {
  /** Default body font size, in px. */
  fontSize: number;
  /** Default line height, unitless. */
  lineHeight: number;
  /** Default reading column width, in px. */
  pageWidth: number;
}

export const READING_PREFS_KEY = 'deer-reading-prefs';

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  fontSize: 18,
  lineHeight: 1.6,
  pageWidth: 680,
};

export const READING_PREFS_LIMITS = {
  fontSize: { min: 14, max: 24, step: 1 },
  lineHeight: { min: 1.4, max: 2.2, step: 0.1 },
  pageWidth: { min: 480, max: 880, step: 10 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

export function getReadingPrefs(): ReadingPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_READING_PREFS };
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(READING_PREFS_KEY);
  } catch {
    return { ...DEFAULT_READING_PREFS };
  }
  if (!raw) return { ...DEFAULT_READING_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingPrefs>;
    const limits = READING_PREFS_LIMITS;
    return {
      fontSize: toNumber(parsed.fontSize, DEFAULT_READING_PREFS.fontSize, limits.fontSize.min, limits.fontSize.max),
      lineHeight: toNumber(parsed.lineHeight, DEFAULT_READING_PREFS.lineHeight, limits.lineHeight.min, limits.lineHeight.max),
      pageWidth: toNumber(parsed.pageWidth, DEFAULT_READING_PREFS.pageWidth, limits.pageWidth.min, limits.pageWidth.max),
    };
  } catch {
    return { ...DEFAULT_READING_PREFS };
  }
}

export function saveReadingPrefs(prefs: ReadingPrefs): void {
  if (typeof window === 'undefined') return;
  const limits = READING_PREFS_LIMITS;
  const safe: ReadingPrefs = {
    fontSize: clamp(prefs.fontSize, limits.fontSize.min, limits.fontSize.max),
    lineHeight: clamp(prefs.lineHeight, limits.lineHeight.min, limits.lineHeight.max),
    pageWidth: clamp(prefs.pageWidth, limits.pageWidth.min, limits.pageWidth.max),
  };
  try {
    window.localStorage.setItem(READING_PREFS_KEY, JSON.stringify(safe));
  } catch {
    // Storage disabled or quota exceeded: the sliders keep their on-screen
    // values, nothing is persisted — never a crash on a preference.
  }
}
