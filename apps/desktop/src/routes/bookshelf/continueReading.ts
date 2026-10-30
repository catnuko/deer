import type { Book } from "@/lib/types";

/**
 * 「继续阅读」选书逻辑：只在存过位置（CFI）的书里挑最近打开的那本，
 * 没有任何阅读痕迹就返回 null（书架不显示卡片）。
 */
export function continueReadingBookOf(books: Book[]): Book | null {
  let best: Book | null = null;
  let bestTime = -1;
  for (const book of books) {
    if (!book.lastLocationCfi) continue;
    const time = book.lastOpenedAt ?? book.addedAt;
    if (time > bestTime) {
      best = book;
      bestTime = time;
    }
  }
  return best;
}
