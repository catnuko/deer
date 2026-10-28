import { type StoredSession } from './chat-storage';

/**
 * 书籍独立空间的纯逻辑（P0，catnuko 2026-10-28 拍板）：
 * 空间标识与切书时的会话选择。这里不放任何存储访问，方便单测。
 */

/**
 * 一个面板实例所属空间的标识。阅读页传入书籍标识（bookId）时以书为准——
 * 同一本书的所有章节共享一个空间；没有书籍标识时退回阅读文本指纹，行为
 * 与旧版（每个文本一个会话位）一致。
 */
export function resolveSpaceId(bookId: string | undefined, contentId: string): string {
  if (typeof bookId === 'string' && bookId.trim().length > 0) return bookId.trim();
  return contentId;
}

/**
 * 切书自动切换（无弹窗、无确认）：落入目标书空间时，恢复该书**最近活跃**
 * 的那个会话；该书还没有会话则返回 null，面板呈现空会话。`bookId` 为空
 * （尚未进入任何书的空间）时不挑选。
 */
export function pickLatestSpaceSession(
  sessions: readonly StoredSession[],
  bookId: string | undefined,
): StoredSession | null {
  if (!bookId) return null;
  let latest: StoredSession | null = null;
  for (const session of sessions) {
    if (session.bookId !== bookId || session.messages.length === 0) continue;
    if (!latest || session.updatedAt > latest.updatedAt) latest = session;
  }
  return latest;
}
