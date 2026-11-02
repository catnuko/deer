import { useEffect, useState } from "react";
import { appDataDir } from "@tauri-apps/api/path";
import { isTauri } from "@/lib/platform";

/**
 * 本机应用数据目录：桌面端动态取（macOS 为
 * ~/Library/Application Support/<identifier>），浏览器预览返回 null。
 */
export function useDataDir(): string | null {
  const [dir, setDir] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    appDataDir()
      .then((path) => {
        if (alive) setDir(path);
      })
      .catch(() => {
        if (alive) setDir(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return dir;
}