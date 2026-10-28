export type StoredChatRole = 'user' | 'assistant';

export interface StoredChatMessage {
  id: string;
  role: StoredChatRole;
  content: string;
}

export interface StoredSession {
  contentId: string;
  /**
   * 书籍独立空间标识（P0，catnuko 2026-10-28 拍板）。每本书的会话只落进
   * 自己的空间；空字符串是留给历史数据的「无归属」档位。
   */
  bookId: string;
  messages: StoredChatMessage[];
  updatedAt: number;
}

/**
 * 旧数据兼容归档策略：`deer-chat-sessions` 里没有 `bookId` 的条目（本字段
 * 引入之前写入的会话）一律归档为 `LEGACY_BOOK_ID`（空字符串）。它们**不会**
 * 出现在任何书籍空间的会话列表里——真实书籍标识永远非空，所以按书过滤天然
 * 把它们挡在外面；数据本身保留在存储中，只随 LRU 淘汰自然清出，不做破坏性
 * 迁移。面板在未传 `bookId` 时以阅读文本指纹作为空间标识，行为与旧版一致。
 */
export const LEGACY_BOOK_ID = '';

export const LEGACY_CHAT_STORAGE_KEY = 'deer-chat-history';
export const SESSIONS_STORAGE_KEY = 'deer-chat-sessions';
export const UNDO_STORAGE_KEY = 'deer-chat-undo';
export const MAX_STORED_MESSAGES = 100;
export const MAX_STORED_SESSIONS = 20;

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Stable, non-reversible identity for a reading text. Only a fingerprint of
 * the content is stored, never the text itself.
 */
export function getReadingContentId(content: string): string {
  const text = content.trim();
  if (!text) return '';

  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = (h2 >>> 0) * 4294967296 + (h1 >>> 0);
  return `c${text.length.toString(36)}-${hash.toString(36)}`;
}

export function isPersistableMessage(message: StoredChatMessage): boolean {
  return (message.role === 'user' || message.role === 'assistant') && message.content.trim().length > 0;
}

function toStoredMessage(value: unknown): StoredChatMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { id, role, content } = record as { id?: unknown; role?: unknown; content?: unknown };
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof content !== 'string') return null;
  if (role !== 'user' && role !== 'assistant') return null;
  if (content.trim().length === 0) return null;
  return { id, role, content };
}

/**
 * Normalise arbitrary stored data into a valid message list: unknown roles,
 * missing ids and blank contents are dropped, then only the newest messages
 * within the storage cap are kept. Rebuilding every message field by field is
 * also what keeps model configuration out of the persisted payload.
 */
export function sanitizeStoredMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value)) return [];
  const messages = value
    .map(toStoredMessage)
    .filter((m): m is StoredChatMessage => m !== null);
  return messages.slice(Math.max(0, messages.length - MAX_STORED_MESSAGES));
}

/**
 * Append a completed turn to the conversation. The turn is persisted only when
 * it ends with a finished assistant reply, so an interrupted stream never
 * leaves a trailing user message behind; it returns the previous list untouched.
 */
export function withCompletedTurn(
  conversation: readonly StoredChatMessage[],
  user: StoredChatMessage,
  assistant: StoredChatMessage,
): StoredChatMessage[] {
  const completed = assistant.role === 'assistant' && isPersistableMessage(assistant);
  return completed ? [...conversation, user, assistant] : [...conversation];
}

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded or storage disabled: the in-memory conversation survives.
    return false;
  }
}

function removeItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage disabled: nothing to remove.
  }
}

function toSession(value: unknown): StoredSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.contentId !== 'string' || record.contentId.length === 0) return null;
  const messages = sanitizeStoredMessages(record.messages);
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : 0;
  const bookId = typeof record.bookId === 'string' ? record.bookId : LEGACY_BOOK_ID;
  return { contentId: record.contentId, bookId, messages, updatedAt };
}

/**
 * 会话匹配在「文本指纹 + 书籍空间」上：给出 `bookId` 时只认该书空间里的
 * 会话，旧档位（`LEGACY_BOOK_ID`）与别的书都匹配不上；不传 `bookId` 保持
 * 旧调用方的全局语义。
 */
function sameSpace(session: StoredSession, bookId: string | undefined): boolean {
  return bookId === undefined || session.bookId === bookId;
}

/**
 * Parse the stored session list. A payload of the wrong shape or any entry that
 * cannot be validated fails open: unusable entries are dropped instead of
 * thrown on, so corrupt storage never crashes the panel.
 */
function parseSessions(raw: string | null): StoredSession[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(toSession)
    .filter((s): s is StoredSession => s !== null);
}

/**
 * Sessions are held oldest-first so that the newest write simply appends and
 * eviction can always drop from the front. `Array.prototype.sort` is stable, so
 * entries sharing one `updatedAt` keep that array order: the caller moves the
 * affected session to the end before sorting, which makes the most recent
 * activity win a same-millisecond tie against a stale neighbour.
 */
function sortAscending(sessions: readonly StoredSession[]): StoredSession[] {
  return [...sessions].sort((a, b) => a.updatedAt - b.updatedAt);
}

function keepNewest(sessions: readonly StoredSession[]): StoredSession[] {
  return sessions.slice(Math.max(0, sessions.length - MAX_STORED_SESSIONS));
}

function writeSessions(sessions: readonly StoredSession[]): boolean {
  if (sessions.length === 0) {
    removeItem(SESSIONS_STORAGE_KEY);
    return true;
  }
  return writeItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

/**
 * One-time migration from the Deer-06 single-slot key. Whatever the legacy
 * payload holds, the old key is deleted so a later downgrade cannot resurrect
 * stale data; a usable session is carried over into the new list.
 */
export function migrateLegacyHistory(): boolean {
  if (!hasLocalStorage()) return false;

  const raw = readItem(LEGACY_CHAT_STORAGE_KEY);
  if (raw === null) return false;
  removeItem(LEGACY_CHAT_STORAGE_KEY);

  let legacy: StoredSession | null = null;
  try {
    legacy = toSession(JSON.parse(raw) as unknown);
  } catch {
    legacy = null;
  }
  if (!legacy) return false;

  if (legacy.messages.length === 0) {
    // Nothing persistable to carry over: the legacy slot is gone and the new
    // storage is left exactly as it was.
    return true;
  }

  const sessions = parseSessions(readItem(SESSIONS_STORAGE_KEY));
  if (sessions.some((s) => s.contentId === legacy.contentId)) {
    // A session for the same text already exists in the new key; the migrated
    // copy is older, so the existing one wins and only the old key is removed.
    return true;
  }
  sessions.push({
    ...legacy,
    bookId: legacy.bookId || LEGACY_BOOK_ID,
    updatedAt: legacy.updatedAt > 0 ? legacy.updatedAt : Date.now(),
  });
  writeSessions(keepNewest(sortAscending(sessions)));
  return true;
}

function ensureMigration(): void {
  migrateLegacyHistory();
}

/**
 * Persist the conversation of one reading text without touching the others:
 * the session is upserted, capped, and the list is trimmed to the newest
 * `MAX_STORED_SESSIONS` entries by `updatedAt`.
 *
 * `bookId` tags the session into one book's independent space; when given, the
 * upsert only replaces a session of the same text *in the same space*, so two
 * books that happen to share a text fingerprint never overwrite each other.
 */
export function saveChatHistory(
  contentId: string,
  messages: readonly StoredChatMessage[],
  bookId: string = LEGACY_BOOK_ID,
): void {
  if (!hasLocalStorage()) return;
  ensureMigration();

  const sanitized = sanitizeStoredMessages(messages);
  const others = parseSessions(readItem(SESSIONS_STORAGE_KEY))
    .filter((s) => !(s.contentId === contentId && s.bookId === bookId));
  if (sanitized.length === 0) {
    writeSessions(others);
    return;
  }
  // The written session goes last so it is the newest when timestamps collide.
  writeSessions(
    keepNewest(sortAscending([...others, { contentId, bookId, messages: sanitized, updatedAt: Date.now() }])),
  );
}

/**
 * Restore the conversation that belongs to the given reading text. When
 * `bookId` is given, only a session inside that book's space matches — the
 * conversation of another book (or a legacy unattributed one) is never
 * returned. Any other session is left in place, and an unknown or corrupt id
 * yields an empty session instead of an error.
 */
export function loadChatHistory(contentId: string, bookId?: string): StoredChatMessage[] {
  if (!hasLocalStorage()) return [];
  ensureMigration();

  const session = parseSessions(readItem(SESSIONS_STORAGE_KEY))
    .find((s) => s.contentId === contentId && sameSpace(s, bookId));
  return session ? session.messages : [];
}

/**
 * List the stored sessions with messages, newest activity first, for the
 * 「历史会话」 view. With `bookId`, only that book's sessions come back —
 * the list of one book's space can never contain another book's session, and
 * legacy unattributed entries stay archived out of every book's list.
 */
export function listSessions(bookId?: string): StoredSession[] {
  if (!hasLocalStorage()) return [];
  ensureMigration();

  return sortAscending(parseSessions(readItem(SESSIONS_STORAGE_KEY)))
    .filter((s) => s.messages.length > 0 && sameSpace(s, bookId))
    .reverse();
}

/**
 * Mark a session as most recently used, keeping its messages. Used when the
 * reader switches to a session, so viewing it protects it from eviction.
 * With `bookId`, only a session of that space is touched.
 */
export function touchSession(contentId: string, bookId?: string): void {
  if (!hasLocalStorage()) return;
  ensureMigration();

  const sessions = parseSessions(readItem(SESSIONS_STORAGE_KEY));
  const target = sessions.find((s) => s.contentId === contentId && sameSpace(s, bookId));
  if (!target) return;
  const touched: StoredSession = { ...target, updatedAt: Date.now() };
  const others = sessions.filter((s) => s !== target);
  writeSessions(keepNewest(sortAscending([...others, touched])));
}

function parseUndo(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    return toSession(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function readUndo(): StoredSession | null {
  if (!hasLocalStorage()) return null;
  try {
    return parseUndo(readItem(UNDO_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Clear one conversation into the single undo slot. The slot is written first
 * and the session only leaves the list once that write succeeded, so a failed
 * slot write degrades to "the clear did not happen" instead of losing the
 * conversation; a later clear replaces the slot, which is the documented
 * one-step undo. With `bookId`, only a session of that space is cleared, so a
 * book's conversation can never be wiped from inside another book's space.
 */
export function clearSessionToUndo(contentId: string, bookId?: string): StoredSession | null {
  if (!hasLocalStorage()) return null;
  ensureMigration();

  const sessions = parseSessions(readItem(SESSIONS_STORAGE_KEY));
  const target = sessions.find((s) => s.contentId === contentId && sameSpace(s, bookId));
  if (!target) return null;

  const cleared: StoredSession = {
    contentId: target.contentId,
    bookId: target.bookId,
    messages: target.messages,
    updatedAt: target.updatedAt > 0 ? target.updatedAt : Date.now(),
  };
  if (!writeItem(UNDO_STORAGE_KEY, JSON.stringify(cleared))) return null;
  writeSessions(sessions.filter((s) => !(s.contentId === contentId && s.bookId === target.bookId)));
  return cleared;
}

export function peekUndo(): StoredSession | null {
  return readUndo();
}

/**
 * Put the cleared conversation back and free the slot. Restore counts as use:
 * the session's `updatedAt` moves to now in the same write, so a recovered
 * conversation is never the next LRU eviction victim and reappears at the top
 * of the 「历史会话」 list. Only the metadata field changes; the messages are
 * reinserted verbatim. The slot is freed only after the list write succeeded,
 * so a failed restore degrades to "nothing happened" and can be retried
 * instead of losing both the session and the undo slot.
 */
export function restoreUndo(): StoredSession | null {
  const pending = readUndo();
  if (!pending) return null;
  if (!hasLocalStorage()) return null;

  const restored: StoredSession = { ...pending, updatedAt: Date.now() };
  // The restore replaces the cleared session inside its own space only; the
  // same text fingerprint in another book's space is left untouched.
  const sessions = sortAscending(parseSessions(readItem(SESSIONS_STORAGE_KEY)))
    .filter((s) => !(s.contentId === pending.contentId && s.bookId === pending.bookId));
  sessions.push(restored);
  if (!writeSessions(keepNewest(sessions))) return null;
  removeItem(UNDO_STORAGE_KEY);
  return restored;
}
