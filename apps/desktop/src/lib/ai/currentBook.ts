import { useSearchParams } from "react-router-dom";

export type CurrentBook = { id: string; title: string };

/**
 * 演示用书籍：书架还没有真实书目时，AI 面板按这本书开会话，
 * 便于在浏览器里验证界面。桌面端选中真实书后由 ?book= 覆盖。
 */
export const DEMO_BOOK: CurrentBook = {
  id: "demo-book",
  title: "一本没读完的书",
};

export function currentBookFromParams(
  book: string | null,
  title: string | null,
): CurrentBook {
  if (!book) return DEMO_BOOK;
  const trimmedTitle = title?.trim();
  return {
    id: book,
    title: trimmedTitle ? trimmedTitle : `书籍 ${book.slice(0, 6)}`,
  };
}

export function useCurrentBook(): CurrentBook {
  const [params] = useSearchParams();
  return currentBookFromParams(params.get("book"), params.get("title"));
}
