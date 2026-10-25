import { type StoredChatMessage } from './chat-storage';

const SELECTION_PREFIX = '请解释这段内容：';
const UNNAMED_SESSION = '（未命名会话）';
const SUMMARY_MAX_CHARS = 20;

const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * Turn the first user message into the one-line session summary: the fixed
 * selection prompt wording is removed so a quoted selection reads as the
 * quotation, whitespace is collapsed, and the result is capped so no DOM text
 * node can stretch a row (CSS ellipsis is the visible bound).
 */
export function sessionSummary(messages: readonly StoredChatMessage[]): string {
  return truncateSummary(collapseWhitespace(stripSelectionPrompt(firstUserContent(messages))));
}

/**
 * The same text without the character cap, for `title` and `aria-label`, so a
 * truncated summary never loses information for the reader or a screen reader.
 */
export function fullSessionSummary(messages: readonly StoredChatMessage[]): string {
  const text = collapseWhitespace(stripSelectionPrompt(firstUserContent(messages)));
  return text.length > 0 ? text : UNNAMED_SESSION;
}

function firstUserContent(messages: readonly StoredChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  return first ? first.content : '';
}

function stripSelectionPrompt(content: string): string {
  const index = content.indexOf(SELECTION_PREFIX);
  if (index === -1) return content;
  const quoted = content.slice(index + SELECTION_PREFIX.length).trim();
  return quoted.replace(/^["“]([\s\S]*)["”]$/, '$1').trim();
}

function collapseWhitespace(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function truncateSummary(text: string): string {
  if (text.length === 0) return UNNAMED_SESSION;
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  return `${text.slice(0, SUMMARY_MAX_CHARS)}…`;
}

function padMinutes(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Relative-then-calendar time label for a session row. Buckets are checked in
 * the order fixed by the interaction spec, and the full local time is exposed
 * separately so a relative label stays verifiable.
 */
export function formatSessionTime(updatedAt: number, now: number = Date.now()): string {
  const elapsed = now - updatedAt;
  if (elapsed < MINUTE) return '刚刚';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`;
  if (elapsed < 24 * HOUR) return `${Math.floor(elapsed / HOUR)} 小时前`;

  const then = new Date(updatedAt);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameCalendarDay(then, yesterday)) return `昨天 ${padMinutes(then)}`;

  if (then.getFullYear() === today.getFullYear()) return `${then.getMonth() + 1}月${then.getDate()}日`;
  return `${then.getFullYear()}/${then.getMonth() + 1}/${then.getDate()}`;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Exact local timestamp for the `datetime` attribute, `title` and `aria-label`.
 */
export function fullSessionTime(updatedAt: number): string {
  return new Date(updatedAt).toLocaleString();
}

export function isoSessionTime(updatedAt: number): string {
  return new Date(updatedAt).toISOString();
}

/**
 * The undo entry names the conversation it restores, because with several
 * sessions stored a generic label would not tell the reader which one comes
 * back. Wording stays singular and never hints at a count or a deadline.
 */
export function undoButtonLabel(messages: readonly StoredChatMessage[]): string {
  return `↩️ 撤销恢复「${sessionSummary(messages)}」`;
}
