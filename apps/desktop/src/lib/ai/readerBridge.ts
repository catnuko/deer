/**
 * 阅读页 → AI 工具的桥：foliate 视图能力（目录/当前章文本/跳转/书内搜索）
 * 由 ReaderPage 挂载真实书后注册，书架页等宿主不注册，对应工具自行降级。
 * 全部走 ref 读取，注册一次即可，不随 React 渲染失效。
 */

export type ReaderBridge = {
  bookId: string;
  /** 扁平目录（index 即列表序号）。 */
  getToc(): { index: number; title: string; href: string }[];
  /** 当前 spine section 的章节标题；拿不到为 null。 */
  getCurrentChapterTitle(): Promise<string | null>;
  /** 当前 spine section 可读正文；图片书/空章节为 null。 */
  getCurrentChapterText(): Promise<string | null>;
  /** 跳到指定 CFI；成功 true。 */
  jumpTo(cfi: string): Promise<boolean>;
  /** 跳到目录条目（get_toc 返回的 index）；成功 true。 */
  jumpToTocIndex(index: number): Promise<boolean>;
  /** 书内全文搜索（不画高亮层），返回命中摘录。 */
  searchInBook(query: string): Promise<{ cfi: string; excerpt: string }[]>;
};

let bridge: ReaderBridge | null = null;

export function setReaderBridge(next: ReaderBridge | null): void {
  bridge = next;
}

export function getReaderBridge(): ReaderBridge | null {
  return bridge;
}
