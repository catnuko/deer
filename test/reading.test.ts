import { describe, expect, it } from 'vitest';
import { readingProgress, remainingReadingMinutes } from '../src/lib/reading';

describe('readingProgress', () => {
  it('returns 0 at the beginning', () => {
    expect(readingProgress(0, 320)).toBe(0);
  });

  it('returns 100 at the last page', () => {
    expect(readingProgress(320, 320)).toBe(100);
  });

  it('clamps pages outside the book', () => {
    expect(readingProgress(-12, 320)).toBe(0);
    expect(readingProgress(900, 320)).toBe(100);
  });

  it('handles invalid totals without dividing by zero', () => {
    expect(readingProgress(12, 0)).toBe(0);
  });
});

describe('remainingReadingMinutes', () => {
  it('estimates the remaining time from the current page', () => {
    expect(remainingReadingMinutes(100, 150, 2)).toBe(100);
  });

  it('never returns a negative duration', () => {
    expect(remainingReadingMinutes(500, 150, 2)).toBe(0);
  });

  it('returns 0 for invalid input', () => {
    expect(remainingReadingMinutes(10, 0)).toBe(0);
    expect(remainingReadingMinutes(10, 20, 0)).toBe(0);
  });
});
