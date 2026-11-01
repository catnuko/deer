/**
 * 划选高亮色板：微信读书式四色。
 * value 直接用作 overlayer 的填充色（0.3 透明度叠在正文上），
 * M2 的持久化存取也以 value 为准。
 */

export type HighlightColor = {
  key: string;
  label: string;
  value: string;
};

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { key: "yellow", label: "黄色", value: "#FFD60A" },
  { key: "green", label: "绿色", value: "#5AD45A" },
  { key: "blue", label: "蓝色", value: "#6FB6FF" },
  { key: "pink", label: "粉色", value: "#FF8FA3" },
];

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0]!.value;

/** 容错取色：未知或缺失的值退回默认色，渲染层永远拿得到合法颜色。 */
export function highlightColorOf(
  value: string | null | undefined,
): HighlightColor {
  return (
    HIGHLIGHT_COLORS.find((color) => color.value === value) ??
    HIGHLIGHT_COLORS[0]!
  );
}
