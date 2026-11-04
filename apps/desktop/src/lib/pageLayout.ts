/**
 * 分页器（foliate paginator）的布局属性。
 *
 * vendor/foliate-js/paginator.js 把 `--_gap` / `--_margin` /
 * `--_max-inline-size` 写死为 7% / 48px / 720px：宽窗下正文被压成中间
 * 一条，四周堆出大片空白。VENDORED.md 禁止改 vendor，而 paginator 的
 * attributeChangedCallback 支持在元素上设同名属性覆盖这三个值
 * （paginator.js:625-641），所以从这里下发属性。
 *
 * gap 的几何：paginator 的外侧留白由两处半 gap 叠加 —— #top 网格两侧
 * 各 `--_half-gap` 的占位（paginator.js:479-483），加上 iframe 内
 * `html` 的 `padding: 0 gap/2`（paginator.js:311-315）。两者相加恰好
 * 等于一个完整 gap，所以外侧留白 ≈ gap × 阅读区宽。既然「页边距」
 * 设置要的就是这圈留白，就直接把它换算成 gap，不再额外注入 body
 * 内边距（否则两处叠加，怎么调都缩不到 4%）。
 */

export type PaginatorLayout = {
  /** 栏间距与外侧留白（百分数，相对阅读区宽）。 */
  gap: string;
  /** 上下页眉/页脚的留白高度。 */
  margin: string;
  /** 单栏最大宽度；两栏时总宽是它的两倍。 */
  maxInlineSize: string;
};

/** 上下留白：比原厂 48px 收到 16px，正文更贴容器边缘。 */
export const PAGINATOR_MARGIN = "16px";
/** 单栏最大宽：原厂 720px 在宽窗下把正文压成中间一条。 */
export const PAGINATOR_MAX_INLINE_SIZE = "860px";
/** gap 的合理区间：太小栏间粘连，太大又会把正文挤瘦。 */
export const PAGINATOR_GAP_MIN_PCT = 1;
export const PAGINATOR_GAP_MAX_PCT = 6;
/** 量不到阅读区宽时的兜底宽度（常见桌面窗口）。 */
const FALLBACK_VIEWER_WIDTH = 1200;

/**
 * 把「页边距设置」换算成分页器布局属性。
 *
 * 外侧留白 = gap% × 阅读区宽（见文件头），所以 gap% = 页边距 / 阅读区宽。
 * 1400px 窗口、目录展开时阅读区约 1160px：适中 24px → 2.07%，
 * 留白与栏间距都是 24px 上下，两栏看起来才协调。
 */
export function paginatorLayoutFor({
  viewerWidth,
  pageMarginPx,
}: {
  viewerWidth: number;
  pageMarginPx: number;
}): PaginatorLayout {
  const width =
    Number.isFinite(viewerWidth) && viewerWidth > 0
      ? viewerWidth
      : FALLBACK_VIEWER_WIDTH;
  const marginPx =
    Number.isFinite(pageMarginPx) && pageMarginPx >= 0 ? pageMarginPx : 0;
  const rawPct = (marginPx / width) * 100;
  const pct = Math.min(
    PAGINATOR_GAP_MAX_PCT,
    Math.max(PAGINATOR_GAP_MIN_PCT, rawPct),
  );
  return {
    gap: `${Math.round(pct * 100) / 100}%`,
    margin: PAGINATOR_MARGIN,
    maxInlineSize: PAGINATOR_MAX_INLINE_SIZE,
  };
}

/** 属性名沿用 paginator 的 observedAttributes（带连字符）。 */
export function paginatorAttributes(
  layout: PaginatorLayout,
): Record<string, string> {
  return {
    gap: layout.gap,
    margin: layout.margin,
    "max-inline-size": layout.maxInlineSize,
  };
}

/**
 * 把布局属性写到 renderer 元素上。`max-inline-size` 会让 paginator 主动
 * render()，但它保留 #anchor（paginator.js:754-760），所以要在 view.init
 * 之后调用，位置不会跳。
 */
export function applyPaginatorLayout(
  renderer: Element | null | undefined,
  layout: PaginatorLayout,
): void {
  if (!renderer) return;
  for (const [name, value] of Object.entries(paginatorAttributes(layout))) {
    // max-inline-size 每次 setAttribute 都会触发 render()，值没变就别重排。
    if (renderer.getAttribute(name) === value) continue;
    renderer.setAttribute(name, value);
  }
}