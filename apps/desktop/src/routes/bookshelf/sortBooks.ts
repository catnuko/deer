import type { Book } from "@/lib/types";
import type { BookshelfSort } from "@/store/appSettings";

const collator = new Intl.Collator("zh-Hans-CN");

/** 空书名/作者一律排在最后，非空之间按中文习惯比较。 */
function compareText(a: string | undefined, b: string | undefined): number {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return collator.compare(left, right);
}

/**
 * 书架展示排序（不改存储顺序）：先按书架筛选再由调用方传入。
 * recent 是默认值：最近打开优先，没打开过的按导入时间靠后。
 */
export function sortBooks(books: Book[], sort: BookshelfSort): Book[] {
  const copy = [...books];
  switch (sort) {
    case "recent":
      return copy.sort(
        (a, b) =>
          (b.lastOpenedAt ?? -1) - (a.lastOpenedAt ?? -1) ||
          b.addedAt - a.addedAt ||
          compareText(a.title, b.title),
      );
    case "title":
      return copy.sort(
        (a, b) => compareText(a.title, b.title) || b.addedAt - a.addedAt,
      );
    case "author":
      return copy.sort(
        (a, b) => compareText(a.author, b.author) || compareText(a.title, b.title),
      );
    case "added":
      return copy.sort(
        (a, b) => b.addedAt - a.addedAt || compareText(a.title, b.title),
      );
  }
}