/**
 * The reading text lives in the session storage of the tab that opened it:
 * the text itself is never persisted, only its fingerprint (the content id
 * a stored session is keyed by). The keys are shared so the reading page and
 * the command palette can never drift apart on the contract.
 */
export const READING_CONTENT_KEY = 'deer-reading-content';
export const READING_TITLE_KEY = 'deer-reading-title';
export const READING_TYPE_KEY = 'deer-reading-type';

function readSessionItem(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Whether this tab has a text open. A stored session or note can only be
 * shown next to the text it belongs to, so the command palette uses this to
 * decide whether those entries can be acted on at all.
 */
export function hasReadingContent(): boolean {
  if (typeof window === 'undefined') return false;
  return (readSessionItem(READING_CONTENT_KEY) ?? '').trim().length > 0;
}

export function readingProgress(currentPage: number, totalPages: number): number {
  if (!Number.isFinite(currentPage) || !Number.isFinite(totalPages) || totalPages <= 0) {
    return 0;
  }

  const clampedPage = Math.min(Math.max(currentPage, 0), totalPages);
  return Math.round((clampedPage / totalPages) * 100);
}

export function scrollProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) {
    return 0;
  }
  if (scrollHeight <= 0 || clientHeight <= 0 || scrollHeight <= clientHeight) {
    return 0;
  }
  const maxScroll = scrollHeight - clientHeight;
  const clamped = Math.min(Math.max(scrollTop, 0), maxScroll);
  return Math.round((clamped / maxScroll) * 100);
}

export function remainingReadingMinutes(
  currentPage: number,
  totalPages: number,
  minutesPerPage = 2,
): number {
  if (!Number.isFinite(totalPages) || totalPages <= 0 || minutesPerPage <= 0) {
    return 0;
  }

  const remainingPages = Math.max(totalPages - Math.max(currentPage, 0), 0);
  return Math.ceil(remainingPages * minutesPerPage);
}
