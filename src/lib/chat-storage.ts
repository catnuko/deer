export type StoredChatRole = 'user' | 'assistant';

export interface StoredChatMessage {
  id: string;
  role: StoredChatRole;
  content: string;
}

export interface StoredChatHistory {
  contentId: string;
  messages: StoredChatMessage[];
}

export const CHAT_STORAGE_KEY = 'deer-chat-history';
export const MAX_STORED_MESSAGES = 100;

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
 * within the storage cap are kept.
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

/**
 * Persist the current conversation. Messages are sanitised and capped, and
 * writing degrades silently when storage is unavailable or the quota is full.
 */
export function saveChatHistory(contentId: string, messages: readonly StoredChatMessage[]): void {
  if (!hasLocalStorage()) return;

  const sanitized = sanitizeStoredMessages(messages);
  try {
    if (sanitized.length === 0) {
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
      return;
    }
    const session: StoredChatHistory = { contentId, messages: sanitized };
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota exceeded or storage disabled: keep the in-memory conversation.
  }
}

function parseSession(raw: string | null): StoredChatHistory | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.contentId !== 'string') return null;
    return { contentId: record.contentId, messages: sanitizeStoredMessages(record.messages) };
  } catch {
    return null;
  }
}

/**
 * Restore the conversation for the given reading content. Corrupt payloads or
 * a different content id yield an empty session instead of an error.
 */
export function loadChatHistory(contentId: string): StoredChatMessage[] {
  if (!hasLocalStorage()) return [];
  try {
    const session = parseSession(window.localStorage.getItem(CHAT_STORAGE_KEY));
    if (!session || session.contentId !== contentId) return [];
    return session.messages;
  } catch {
    return [];
  }
}

export function clearChatHistory(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // Storage disabled: nothing to clear.
  }
}
