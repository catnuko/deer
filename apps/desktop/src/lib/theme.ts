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

/** 把主题落到 <html> 上：切换 .dark 类 + color-scheme（影响原生滚动条/表单控件）。 */
export function applyTheme(theme: ReadingTheme): ResolvedTheme {
  const resolved = resolveTheme(theme, systemPrefersDark());
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }
  return resolved;
}
