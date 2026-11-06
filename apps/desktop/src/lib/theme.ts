export type ReadingTheme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** 把「浅色 / 深色 / 跟随系统」收敛成实际生效的主题。 */
export function resolveTheme(
  theme: ReadingTheme,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

/** 读取系统外观偏好；没有 matchMedia 的环境（如测试）按浅色处理。 */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

function prefersReducedMotionNow(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 把主题落到 <html> 上：切换 .dark 类 + color-scheme（影响原生滚动条/表单控件）。
 * 用户切换时（animate）走 View Transition 200ms 交叉淡入，不可用则只过渡
 * body 底色与文字；启动落地与减少动态效果下直接切换（motion.md M3）。
 */
export function applyTheme(
  theme: ReadingTheme,
  options: { animate?: boolean } = {},
): ResolvedTheme {
  const resolved = resolveTheme(theme, systemPrefersDark());
  if (typeof document === "undefined") return resolved;

  const root = document.documentElement;
  const paint = () => {
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  };

  if (!options.animate || prefersReducedMotionNow()) {
    paint();
    return resolved;
  }

  const doc = document as ViewTransitionDocument;
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(paint);
    return resolved;
  }

  // 降级：过渡必须先在改色前建立，否则同一帧内的变化不会动画。
  root.classList.add("deer-theme-fading");
  void root.offsetWidth;
  paint();
  window.setTimeout(() => root.classList.remove("deer-theme-fading"), 220);
  return resolved;
}
