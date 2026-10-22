import { describe, expect, it } from 'vitest';
import { readingProgress, remainingReadingMinutes, scrollProgress } from '../src/lib/reading';

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

describe('scrollProgress', () => {
  it('returns 0 at the top of the page', () => {
    expect(scrollProgress(0, 2000, 800)).toBe(0);
  });

  it('returns 100 at the bottom of the page', () => {
    expect(scrollProgress(1200, 2000, 800)).toBe(100);
  });

  it('returns the correct percentage in the middle', () => {
    expect(scrollProgress(600, 2000, 800)).toBe(50);
  });

  it('clamps negative scroll to 0', () => {
    expect(scrollProgress(-100, 2000, 800)).toBe(0);
  });

  it('clamps scroll beyond max to 100', () => {
    expect(scrollProgress(5000, 2000, 800)).toBe(100);
  });

  it('returns 0 when content fits in viewport', () => {
    expect(scrollProgress(0, 800, 800)).toBe(0);
    expect(scrollProgress(0, 400, 800)).toBe(0);
  });

  it('returns 0 for invalid dimensions', () => {
    expect(scrollProgress(100, 0, 800)).toBe(0);
    expect(scrollProgress(100, 800, 0)).toBe(0);
    expect(scrollProgress(NaN, 2000, 800)).toBe(0);
  });
});
