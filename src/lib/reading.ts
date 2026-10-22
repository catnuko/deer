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
