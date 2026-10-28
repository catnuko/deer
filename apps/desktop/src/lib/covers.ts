import { readFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "@/lib/platform";
import type { Book } from "@/lib/types";

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** 封面 objectURL 缓存，避免每次渲染都读盘。 */
const coverUrlCache = new Map<string, string>();

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** 读取封面为可渲染的 objectURL；没有封面或读取失败返回 null。 */
export async function getCoverUrl(book: Book): Promise<string | null> {
  if (!isTauri() || !book.coverPath) return null;

  const cached = coverUrlCache.get(book.coverPath);
  if (cached) return cached;

  try {
    const bytes = await readFile(book.coverPath);
    const extension = book.coverPath.split(".").pop()?.toLowerCase() ?? "jpg";
    const blob = new Blob([toBlobPart(bytes)], {
      type: MIME_BY_EXTENSION[extension] ?? "image/jpeg",
    });
    const url = URL.createObjectURL(blob);
    coverUrlCache.set(book.coverPath, url);
    return url;
  } catch {
    return null;
  }
}

/** 删除书籍时释放对应 objectURL。 */
export function releaseCover(coverPath?: string) {
  if (!coverPath) return;
  const url = coverUrlCache.get(coverPath);
  if (!url) return;
  URL.revokeObjectURL(url);
  coverUrlCache.delete(coverPath);
}
