/** 是否运行在 Tauri 容器里。浏览器直开时为 false，本地文件/持久化能力不可用。 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}
