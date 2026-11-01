/**
 * epub.js navigation（NCX/Nav）与阅读页目录 UI 之间的桥接辅助。
 * 纯函数，方便单测；epub.js 的 toc 项结构按 NavItem {label, href, subitems} 处理。
 */

export type TocItem = {
  index: number;
  title: string;
  /** spine 内的相对路径（可含 #fragment），用于 rendition.display() 跳转。 */
  href: string;
};

/** epub.js navigation.toc 的最小结构（subitems 递归）。 */
export type RawTocNode = {
  label?: { trim: () => string } | string;
  href?: string;
  subitems?: { length: number; [index: number]: RawTocNode } | RawTocNode[];
};

/** 去掉 "./" 前缀与查询串，保留路径和 fragment，便于两侧互相匹配。 */
export function normalizeHref(href: string): string {
  return href.trim().replace(/^\.\//, "").replace(/\?.*$/, "");
}

/** 去掉 #fragment，只留文件路径。 */
export function hrefWithoutFragment(href: string): string {
  return normalizeHref(href).split("#")[0] ?? normalizeHref(href);
}

/** 把嵌套 toc 展平成一维列表，index 即列表序号。 */
export function flattenToc(nodes: RawTocNode[]): TocItem[] {
  const items: TocItem[] = [];
  const walk = (list: RawTocNode[]) => {
    for (const node of list) {
      const title =
        typeof node.label === "string"
          ? node.label.trim()
          : (node.label?.trim() ?? "");
      if (node.href) {
        items.push({ index: items.length, title, href: normalizeHref(node.href) });
      }
      if (node.subitems?.length) walk(node.subitems as RawTocNode[]);
    }
  };
  walk(nodes);
  return items;
}

/**
 * 按 relocated 返回的当前 href 找目录高亮序号：
 * 先精确匹配（含 fragment），再退化为文件路径匹配，都取最长命中。
 */
export function matchTocIndex(
  currentHref: string | undefined,
  items: TocItem[],
): number | undefined {
  if (!currentHref || items.length === 0) return undefined;
  const current = normalizeHref(currentHref);
  let best: number | undefined;
  let bestLength = -1;
  for (const item of items) {
    const href = item.href;
    if (href === current || hrefWithoutFragment(href) === hrefWithoutFragment(current)) {
      if (href.length > bestLength) {
        best = item.index;
        bestLength = href.length;
      }
    }
  }
  return best;
}
