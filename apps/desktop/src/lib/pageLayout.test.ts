// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  applyPaginatorLayout,
  paginatorAttributes,
  paginatorLayoutFor,
  PAGINATOR_GAP_MAX_PCT,
  PAGINATOR_GAP_MIN_PCT,
  PAGINATOR_MARGIN,
  PAGINATOR_MAX_INLINE_SIZE,
  type PaginatorLayout,
} from "./pageLayout";

const pct = (layout: PaginatorLayout) => parseFloat(layout.gap);

describe("paginatorLayoutFor", () => {
  it("侧留白换算成 gap：gap% × 阅读区宽 ≈ 页边距", () => {
    for (const marginPx of [12, 24, 40]) {
      const layout = paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: marginPx });
      // 外留白 = grid 半 gap + html padding 半 gap = 一个完整 gap。
      expect((pct(layout) / 100) * 1160).toBeCloseTo(marginPx, 0);
    }
  });

  it("页边距越大 gap 越大", () => {
    const narrow = paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: 12 });
    const medium = paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: 24 });
    const wide = paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: 40 });
    expect(pct(narrow)).toBeLessThan(pct(medium));
    expect(pct(medium)).toBeLessThan(pct(wide));
  });

  it("默认（适中 24px / 1160px 阅读区）落在 2% 附近", () => {
    expect(
      paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: 24 }).gap,
    ).toBe("2.07%");
  });

  it("gap 收在合理区间内，不会被极端宽度带飞", () => {
    const tiny = paginatorLayoutFor({ viewerWidth: 300, pageMarginPx: 40 });
    const huge = paginatorLayoutFor({ viewerWidth: 4000, pageMarginPx: 12 });
    expect(pct(tiny)).toBe(PAGINATOR_GAP_MAX_PCT);
    expect(pct(huge)).toBe(PAGINATOR_GAP_MIN_PCT);
  });

  it("比原厂值更收窄（7% / 48px / 720px）", () => {
    const layout = paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: 24 });
    expect(pct(layout)).toBeLessThan(7);
    expect(parseFloat(layout.margin)).toBe(16);
    expect(parseFloat(layout.margin)).toBeLessThan(48);
    expect(parseFloat(layout.maxInlineSize)).toBe(
      parseFloat(PAGINATOR_MAX_INLINE_SIZE),
    );
    expect(parseFloat(layout.maxInlineSize)).toBeGreaterThan(720);
  });

  it("宽度非法时回落到兜底宽度而不是算出 Infinity", () => {
    for (const viewerWidth of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const layout = paginatorLayoutFor({ viewerWidth, pageMarginPx: 24 });
      expect(Number.isFinite(pct(layout))).toBe(true);
      expect(pct(layout)).toBeGreaterThanOrEqual(PAGINATOR_GAP_MIN_PCT);
    }
  });

  it("页边距非法时按 0 处理", () => {
    const layout = paginatorLayoutFor({
      viewerWidth: 1160,
      pageMarginPx: Number.NaN,
    });
    expect(pct(layout)).toBe(PAGINATOR_GAP_MIN_PCT);
  });
});

describe("paginatorAttributes", () => {
  it("映射成 paginator 的 observedAttributes 原名", () => {
    const layout = paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: 24 });
    expect(paginatorAttributes(layout)).toEqual({
      gap: layout.gap,
      margin: PAGINATOR_MARGIN,
      "max-inline-size": PAGINATOR_MAX_INLINE_SIZE,
    });
  });
});

describe("applyPaginatorLayout", () => {
  it("把三个属性写到 renderer 上", () => {
    const layout = paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: 24 });
    const element = document.createElement("foliate-paginator");
    applyPaginatorLayout(element, layout);
    expect(element.getAttribute("gap")).toBe(layout.gap);
    expect(element.getAttribute("margin")).toBe(PAGINATOR_MARGIN);
    expect(element.getAttribute("max-inline-size")).toBe(
      PAGINATOR_MAX_INLINE_SIZE,
    );
  });

  it("renderer 未就绪时不抛错", () => {
    const layout = paginatorLayoutFor({ viewerWidth: 1160, pageMarginPx: 24 });
    expect(() => applyPaginatorLayout(null, layout)).not.toThrow();
    expect(() => applyPaginatorLayout(undefined, layout)).not.toThrow();
  });
});