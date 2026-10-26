export interface StoredNote {
  id: string;
  title: string;
  excerpt: string;
  excerptTruncated: boolean;
  understanding: string;
  sourceContentId: string;
  sourceLabel: string;
  createdAt: number;
  updatedAt: number;
  links: string[];
}

export const NOTES_STORAGE_KEY = 'deer-notes';
export const MAX_NOTES = 200;
export const MAX_EXCERPT_CHARS = 500;
export const NOTE_TITLE_MAX_CHARS = 20;

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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
    // Quota exceeded or storage disabled: the caller reports the failure.
    return false;
  }
}

function toNote(value: unknown): StoredNote | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { id, title, excerpt, links } = record as {
    id?: unknown;
    title?: unknown;
    excerpt?: unknown;
    links?: unknown;
  };
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof title !== 'string' || typeof excerpt !== 'string') return null;
  const linkList = Array.isArray(links)
    ? links.filter((l): l is string => typeof l === 'string' && l.length > 0)
    : [];
  const now = 0;
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    ? record.createdAt
    : now;
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : createdAt;
  return {
    id,
    title,
    excerpt,
    excerptTruncated: record.excerptTruncated === true,
    understanding: typeof record.understanding === 'string' ? record.understanding : '',
    sourceContentId: typeof record.sourceContentId === 'string' ? record.sourceContentId : '',
    sourceLabel: typeof record.sourceLabel === 'string' ? record.sourceLabel : '',
    createdAt,
    updatedAt,
    links: [...new Set(linkList.filter((l) => l !== id))],
  };
}

/**
 * Parse the stored note list. A payload of the wrong shape or any entry that
 * cannot be validated fails open: the library degrades to empty with a console
 * warn instead of throwing, and the rest of the app (chat storage) is never
 * touched by a corrupt `deer-notes` payload.
 */
export function parseNotes(raw: string | null): StoredNote[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[deer-notes] 笔记存储数据损坏，已重置为空');
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn('[deer-notes] 笔记存储数据损坏，已重置为空');
    return [];
  }
  return parsed
    .map(toNote)
    .filter((n): n is StoredNote => n !== null);
}

function readNotes(): StoredNote[] {
  if (!hasLocalStorage()) return [];
  return parseNotes(readItem(NOTES_STORAGE_KEY));
}

function writeNotes(notes: readonly StoredNote[]): boolean {
  if (!hasLocalStorage()) return false;
  if (notes.length === 0) {
    try {
      window.localStorage.removeItem(NOTES_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }
  return writeItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
}

/**
 * The concept-name fallback: the first sentence of the selection, capped at
 * 20 characters with an ellipsis so no card title can stretch a row.
 */
export function deriveNoteTitle(selection: string): string {
  const text = selection.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return '';
  const match = text.match(/^[^。！？!?.\n]+[。！？!?]/);
  const first = match ? match[0] : text;
  if (first.length <= NOTE_TITLE_MAX_CHARS) return first;
  return `${first.slice(0, NOTE_TITLE_MAX_CHARS)}…`;
}

function nextNoteId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `n${Date.now().toString(36)}-${random}`;
}

/**
 * Capture one concept card from the current reading selection. Returns null
 * (without touching stored data) on an empty selection, when the 200-note cap
 * is reached — no silent LRU eviction — or when the write fails on quota.
 */
export function createNote(input: {
  selection: string;
  sourceContentId: string;
  sourceLabel: string;
}): StoredNote | null {
  const selection = input.selection.trim();
  if (selection.length === 0) return null;
  if (!hasLocalStorage()) return null;

  const notes = readNotes();
  if (notes.length >= MAX_NOTES) return null;

  const now = Date.now();
  const excerpt = selection.slice(0, MAX_EXCERPT_CHARS);
  const created: StoredNote = {
    id: nextNoteId(),
    title: deriveNoteTitle(selection) || '未命名概念',
    excerpt,
    excerptTruncated: selection.length > MAX_EXCERPT_CHARS,
    understanding: '',
    sourceContentId: input.sourceContentId,
    sourceLabel: input.sourceLabel,
    createdAt: now,
    updatedAt: now,
    links: [],
  };
  if (!writeNotes([...notes, created])) return null;
  return created;
}

export function getNote(id: string): StoredNote | null {
  return readNotes().find((n) => n.id === id) ?? null;
}

/**
 * All notes, most recently active first, for the notes panel list.
 */
export function listNotes(): StoredNote[] {
  return [...readNotes()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Persist edits to the note's own fields. `updatedAt` moves to now so the
 * list order and eviction reflect the latest activity; links are preserved.
 */
export function updateNote(
  id: string,
  patch: { title?: string; understanding?: string },
): StoredNote | null {
  if (!hasLocalStorage()) return null;
  const notes = readNotes();
  const index = notes.findIndex((n) => n.id === id);
  if (index === -1) return null;
  const target = notes[index];
  const updated: StoredNote = {
    ...target,
    title: typeof patch.title === 'string' ? patch.title : target.title,
    understanding: typeof patch.understanding === 'string' ? patch.understanding : target.understanding,
    updatedAt: Date.now(),
  };
  notes[index] = updated;
  return writeNotes(notes) ? updated : null;
}

/**
 * Link two notes bidirectionally. Repeated connects are idempotent, a self
 * link or a missing side is silently refused, and both sides are persisted in
 * one write so an interrupted write can never leave a one-sided edge.
 */
export function connectNotes(aId: string, bId: string): boolean {
  if (aId === bId) return false;
  if (!hasLocalStorage()) return false;
  const notes = readNotes();
  const a = notes.find((n) => n.id === aId);
  const b = notes.find((n) => n.id === bId);
  if (!a || !b) return false;
  if (a.links.includes(bId) && b.links.includes(aId)) return true;
  const linked = notes.map((n) => {
    if (n.id === aId && !n.links.includes(bId)) return { ...n, links: [...n.links, bId], updatedAt: Date.now() };
    if (n.id === bId && !n.links.includes(aId)) return { ...n, links: [...n.links, aId], updatedAt: Date.now() };
    return n;
  });
  return writeNotes(linked);
}

/**
 * Remove the link from both sides. Returns false when there was no edge to
 * remove, so a double disconnect degrades to "nothing happened".
 */
export function disconnectNotes(aId: string, bId: string): boolean {
  if (aId === bId) return false;
  if (!hasLocalStorage()) return false;
  const notes = readNotes();
  const a = notes.find((n) => n.id === aId);
  const b = notes.find((n) => n.id === bId);
  if (!a || !b) return false;
  if (!a.links.includes(bId) && !b.links.includes(aId)) return false;
  const unlinked = notes.map((n) => {
    if (n.id === aId) return { ...n, links: n.links.filter((l) => l !== bId), updatedAt: Date.now() };
    if (n.id === bId) return { ...n, links: n.links.filter((l) => l !== aId), updatedAt: Date.now() };
    return n;
  });
  return writeNotes(unlinked);
}

/**
 * Delete a note and cascade-clear every edge that referenced it, so no
 * orphan link survives; the other notes' own fields are untouched.
 */
export function deleteNote(id: string): boolean {
  if (!hasLocalStorage()) return false;
  const notes = readNotes();
  if (!notes.some((n) => n.id === id)) return false;
  const remaining = notes
    .filter((n) => n.id !== id)
    .map((n) => (n.links.includes(id) ? { ...n, links: n.links.filter((l) => l !== id) } : n));
  return writeNotes(remaining);
}
