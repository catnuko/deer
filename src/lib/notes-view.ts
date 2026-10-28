import type { StoredNote } from './notes';

/**
 * View-model helpers for the notes page. Everything here is pure so the
 * filtering and the highlight-colour mapping stay testable outside a browser.
 *
 * The `deer-notes` storage contract has no highlight-colour or kind field, so
 * both are derived: the colour from a stable hash of the note id, the kind
 * from the fields the contract already has. Deriving keeps this page a strict
 * read-only consumer of src/lib/notes.ts.
 */

export type NoteKind = 'highlight' | 'note' | 'ai';

export interface HighlightColor {
  id: string;
  name: string;
  /** The swatch value from the design board (04-notes-highlights.png). */
  value: string;
}

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  { id: 'yellow', name: '黄', value: '#FDE68A' },
  { id: 'green', name: '绿', value: '#A7F3D0' },
  { id: 'blue', name: '蓝', value: '#BFDBFE' },
  { id: 'pink', name: '粉', value: '#FBCFE8' },
  { id: 'purple', name: '紫', value: '#DDD6FE' },
];

export function deriveHighlightColor(noteId: string): HighlightColor {
  let hash = 0;
  for (let i = 0; i < noteId.length; i += 1) {
    hash = (hash * 31 + noteId.charCodeAt(i)) >>> 0;
  }
  return HIGHLIGHT_COLORS[hash % HIGHLIGHT_COLORS.length];
}

export function deriveNoteKind(
  note: Pick<StoredNote, 'understanding' | 'sourceContentId'>,
): NoteKind {
  if (note.sourceContentId.startsWith('ai:')) return 'ai';
  if (note.understanding.trim() !== '') return 'note';
  return 'highlight';
}

/**
 * The book a note belongs to. `sourceLabel` is the free-form「《书》· 章节」
 * string the capture flow stored; the book is the leading 《…》 segment when
 * present, the whole label otherwise.
 */
export function extractBookName(sourceLabel: string): string {
  const match = sourceLabel.match(/《[^》]+》/);
  return match ? match[0] : sourceLabel.trim();
}

export function bookListOf(notes: readonly StoredNote[]): string[] {
  const books = new Set<string>();
  for (const note of notes) {
    const book = extractBookName(note.sourceLabel);
    if (book !== '') books.add(book);
  }
  return [...books].sort((a, b) => a.localeCompare(b, 'zh-Hans'));
}

export type NoteTab = 'all' | 'highlight' | 'note' | 'ai';

export const NOTE_TABS: readonly { id: NoteTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'highlight', label: '高亮' },
  { id: 'note', label: '笔记' },
  { id: 'ai', label: 'AI 问答' },
];

export interface NotesFilter {
  tab: NoteTab;
  /** `null` means 全部书籍. */
  book: string | null;
  /** `null` means no highlight-colour filter. */
  colorId: string | null;
  query: string;
}

export function filterNotes(notes: readonly StoredNote[], filter: NotesFilter): StoredNote[] {
  const query = filter.query.trim().toLowerCase();
  return notes.filter((note) => {
    if (filter.tab !== 'all' && deriveNoteKind(note) !== filter.tab) return false;
    if (filter.book !== null && extractBookName(note.sourceLabel) !== filter.book) return false;
    if (filter.colorId !== null && deriveHighlightColor(note.id).id !== filter.colorId) {
      return false;
    }
    if (query !== '') {
      const haystack = `${note.title}\n${note.excerpt}\n${note.understanding}\n${note.sourceLabel}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/**
 * The card/rail time label: 刚刚 → X 分钟前 → X 小时前 → 昨天 → X 天前 →
 * 上周 → X 周前 → a date once the relative forms run out.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 14) return '上周';
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}
