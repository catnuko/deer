/**
 * 划选问 Deer（N2）：把读者划选的原文整理成 composer 预填草稿。
 * 纯函数，不触 React / DOM 事件，便于表驱动单测。
 */

/** 划选原文带入 prompt 的长度上限（超出截断并注明）。 */
export const SELECTION_MAX_CHARS = 500;

export type SelectionDraft = {
  draft: string;
  truncated: boolean;
};

/**
 * 从 Selection 对象安全取文本：没有活动选区或选区折叠时返回空串。
 * 只依赖 rangeCount / toString，测试与真实 Selection 都能传入。
 */
export function selectionTextOf(
  sel: { rangeCount: number; toString(): string } | null | undefined,
): string {
  if (!sel || sel.rangeCount === 0) return "";
  return sel.toString();
}

/**
 * 整理成预填草稿：引用块 + 提问引导。选区按 Unicode 码点截断到 limit 字，
 * 多余部分以「……」示意并附说明；纯空白选区返回 null（不发）。
 */
export function formatSelectionDraft(
  raw: string,
  limit: number = SELECTION_MAX_CHARS,
): SelectionDraft | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const chars = Array.from(text);
  const truncated = chars.length > limit;
  const quote = truncated ? chars.slice(0, limit).join("") + "……" : text;
  const note = truncated ? `（选区过长，只带前 ${limit} 字）` : "";
  return {
    draft: `我划选了这段：\n\n「${quote}」${note}\n\n想问：`,
    truncated,
  };
}

export type SelectionPlacement = {
  x: number;
  y: number;
  placement: "above" | "below";
  /** 选区上下缘（宿主坐标系）：浮层自量尺寸后翻转与夹边用。 */
  selTop: number;
  selBottom: number;
};

/**
 * 由选区矩形和宿主容器矩形算浮层定位（两者同一坐标系）：
 * 水平居中并夹在容器两侧留白内；选区上方放得下就放上方，否则放下方，
 * 上下各留 8px 间距。纯几何计算，iframe 内外坐标系都先折算好再传入。
 */
export function popoverPlacement(
  rect: { top: number; left: number; width: number; height: number },
  hostRect: { top: number; left: number; width: number },
  edgePadding = 48,
): SelectionPlacement {
  const centerX = rect.left + rect.width / 2 - hostRect.left;
  const selTop = rect.top - hostRect.top;
  const selBottom = selTop + rect.height;
  const placement = selTop > 40 ? "above" : "below";
  return {
    x: Math.min(
      Math.max(centerX, edgePadding),
      Math.max(hostRect.width - edgePadding, edgePadding),
    ),
    y: placement === "above" ? selTop - 8 : selBottom + 8,
    placement,
    selTop,
    selBottom,
  };
}

export type PopoverFit = {
  left: number;
  top: number;
  placement: "above" | "below";
};

/**
 * 浮层量出真实尺寸后的最终落位（全部宿主坐标系）：优先选区上方，
 * 放不下翻下方，两边都放不下取空间更大的一侧；四边夹在宿主内留
 * 8px 边距，任何情况下不越出宿主（宿主 overflow-hidden，越出即被裁）。
 * 纯几何计算，宿主高宽由调用方实测传入。
 */
export function fitPopover(
  sel: { top: number; bottom: number; centerX: number },
  host: { width: number; height: number },
  popup: { width: number; height: number },
  margin = 8,
  gap = 8,
): PopoverFit {
  const spaceAbove = sel.top - margin;
  const spaceBelow = host.height - margin - sel.bottom;
  const need = popup.height + gap;
  const placement =
    spaceAbove >= need
      ? "above"
      : spaceBelow >= need
        ? "below"
        : spaceAbove >= spaceBelow
          ? "above"
          : "below";
  const top =
    placement === "above" ? sel.top - gap - popup.height : sel.bottom + gap;
  return {
    left: Math.min(
      Math.max(sel.centerX - popup.width / 2, margin),
      Math.max(host.width - popup.width - margin, margin),
    ),
    top: Math.min(
      Math.max(top, margin),
      Math.max(host.height - popup.height - margin, margin),
    ),
    placement,
  };
}
