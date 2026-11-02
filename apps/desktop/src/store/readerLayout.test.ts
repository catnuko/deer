import { beforeEach, describe, expect, it } from "vitest";
import {
  clampTocWidth,
  TOC_DEFAULT_WIDTH,
  TOC_MAX_WIDTH,
  TOC_MIN_WIDTH,
  useReaderLayout,
} from "./readerLayout";

describe("clampTocWidth", () => {
  it("把超出区间的宽度收回到上下限", () => {
    expect(clampTocWidth(120)).toBe(TOC_MIN_WIDTH);
    expect(clampTocWidth(900)).toBe(TOC_MAX_WIDTH);
  });

  it("区间内取整保留", () => {
    expect(clampTocWidth(301.6)).toBe(302);
    expect(clampTocWidth(TOC_DEFAULT_WIDTH)).toBe(TOC_DEFAULT_WIDTH);
  });

  it("非法值回落到默认宽度", () => {
    expect(clampTocWidth(Number.NaN)).toBe(TOC_DEFAULT_WIDTH);
    expect(clampTocWidth(Number.POSITIVE_INFINITY)).toBe(TOC_DEFAULT_WIDTH);
  });
});

describe("useReaderLayout", () => {
  beforeEach(() => {
    useReaderLayout.getState().resetTocWidth();
  });

  it("默认宽度落在可调区间内", () => {
    expect(TOC_DEFAULT_WIDTH).toBeGreaterThanOrEqual(TOC_MIN_WIDTH);
    expect(TOC_DEFAULT_WIDTH).toBeLessThanOrEqual(TOC_MAX_WIDTH);
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_DEFAULT_WIDTH);
  });

  it("写入时按区间收拢", () => {
    useReaderLayout.getState().setTocWidth(500);
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_MAX_WIDTH);
    useReaderLayout.getState().setTocWidth(100);
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_MIN_WIDTH);
  });

  it("双击复位回到默认宽度", () => {
    useReaderLayout.getState().setTocWidth(360);
    expect(useReaderLayout.getState().tocWidth).toBe(360);
    useReaderLayout.getState().resetTocWidth();
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_DEFAULT_WIDTH);
  });
});
