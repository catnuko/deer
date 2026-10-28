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

export function useCurrentBook(): CurrentBook {
  const [params] = useSearchParams();
  const id = params.get("book");
  if (!id) return DEMO_BOOK;
  const title = params.get("title");
  return { id, title: title?.trim() ? title : `书籍 ${id.slice(0, 6)}` };
}
