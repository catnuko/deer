import { useMediaQuery } from "@/lib/useMediaQuery";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * 系统「减少动态效果」偏好（motion.md §4）。订阅 change，用户中途切换
 * 系统设置时设置页提示与翻页实际档位会跟着变。
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

/** 事件回调里用的一次性判断（不能在那里调用 hook）。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}