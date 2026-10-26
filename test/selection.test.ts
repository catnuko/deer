import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSelectionText, isCaptureAvailable } from '../src/lib/selection';

describe('isCaptureAvailable - 按钮态=f(实时选区) (Bug #30 回归)', () => {
  it('enables on a non-empty selection', () => {
    expect(isCaptureAvailable('一段选中文本')).toBe(true);
  });

  it('disables on null, undefined, empty and whitespace-only selections', () => {
    expect(isCaptureAvailable(null)).toBe(false);
    expect(isCaptureAvailable(undefined)).toBe(false);
    expect(isCaptureAvailable('')).toBe(false);
    expect(isCaptureAvailable('   ')).toBe(false);
  });
});

describe('getSelectionText - 实时读取浏览器选区 (Bug #30 回归)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the live selection text from window.getSelection', () => {
    vi.stubGlobal('window', {
      getSelection: () => ({ toString: () => '选中的原文' }),
    });
    expect(getSelectionText()).toBe('选中的原文');
  });

  it('returns empty string when getSelection returns null', () => {
    vi.stubGlobal('window', {
      getSelection: () => null,
    });
    expect(getSelectionText()).toBe('');
  });

  it('returns empty string outside the browser (SSR safety)', () => {
    vi.stubGlobal('window', undefined);
    expect(getSelectionText()).toBe('');
  });

  it('capture availability follows the live selection, not a consumed prop', () => {
    // Simulate the Bug #30 sequence: a selection exists in the browser while
    // the panel's selectedText prop has already been consumed and cleared by
    // 「问 Deer」. Availability must come from the live selection.
    vi.stubGlobal('window', {
      getSelection: () => ({ toString: () => '仍是实时选区' }),
    });
    const consumedPropSelectedText = undefined;
    expect(isCaptureAvailable(getSelectionText())).toBe(true);
    expect(isCaptureAvailable(consumedPropSelectedText)).toBe(false);
  });
});
