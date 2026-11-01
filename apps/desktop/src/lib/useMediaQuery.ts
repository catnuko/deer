import { useCallback, useSyncExternalStore } from "react";

/**
 * 响应式断点判断（布局重排 v1）：目录/笔记在 <md 走 Sheet 浮层、顶栏窄窗收拢
 * 都靠它区分。无 matchMedia 的环境（旧测试环境/SSR）回落 false。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener("change", onChange);
      return () => mediaQueryList.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
    () => false,
  );
}
