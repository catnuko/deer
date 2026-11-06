/**
 * 划选标注的视觉配置：微信读书式五色 + 三档样式。
 * 色值取自真机截图采样，value 直接用作 overlayer 的绘制色
 * （highlight 0.3 透明度叠在正文上），持久化以 value 为准。
 */

export type HighlightColor = {
  key: string;
  label: string;
  value: string;
};

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { key: "blue", label: "浅蓝", value: "#82B2F9" },
  { key: "purple", label: "淡紫", value: "#B4A0F9" },
  { key: "green", label: "浅绿", value: "#89D18A" },
  { key: "pink", label: "粉", value: "#F0969E" },
  { key: "yellow", label: "浅黄", value: "#F7CD89" },
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

/** 划线样式三档：马克笔 / 直线 / 波浪线（foliate 现成 squiggly）。 */
export type AnnotationStyle = "marker" | "line" | "dash";

export const ANNOTATION_STYLES: Array<{ key: AnnotationStyle; label: string }> =
  [
    { key: "marker", label: "马克笔" },
    { key: "line", label: "直线" },
    { key: "dash", label: "波浪线" },
  ];

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = "marker";

/** 容错取样式：旧数据或未知值退回马克笔。 */
export function annotationStyleOf(
  value: string | null | undefined,
): AnnotationStyle {
  return ANNOTATION_STYLES.some((style) => style.key === value)
    ? (value as AnnotationStyle)
    : DEFAULT_ANNOTATION_STYLE;
}
