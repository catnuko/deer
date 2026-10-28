'use client';

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ThemeToggle from '@/src/components/ThemeToggle';
import {
  createDraftController,
  type DraftController,
} from '@/src/lib/note-drafts';
import {
  NOTES_STORAGE_KEY,
  createNote,
  deleteNote,
  parseNotes,
  updateNote,
  type StoredNote,
} from '@/src/lib/notes';
import { createSeedNotes } from '@/src/lib/notes-seed';
import {
  NOTE_TABS,
  type NoteTab,
  type NotesFilter,
  bookListOf,
  deriveHighlightColor,
  deriveNoteKind,
  extractBookName,
  filterNotes,
  formatRelativeTime,
  HIGHLIGHT_COLORS,
} from '@/src/lib/notes-view';

type AssistantChip = 'explain' | 'expand' | 'ask';

interface AssistantTurn {
  role: 'user' | 'ai';
  text: string;
}

/**
 * The canned assistant answers. No external AI call: the chips demonstrate the
 * interaction and the「保存为笔记」path, which goes through the real
 * `createNote` contract from src/lib/notes.ts.
 */
function buildAssistantReply(chip: AssistantChip, note: StoredNote): string {
  const book = extractBookName(note.sourceLabel);
  if (chip === 'explain') {
    return `围绕「${note.title}」可以从三个层次展开：\n1. 字面：它陈述了什么——「${note.excerpt.slice(0, 32)}${note.excerpt.length > 32 ? '…' : ''}」\n2. 语境：放在${book}的章节脉络里，它在回应什么问题；\n3. 延伸：结合你的批注，还值得追问的是哪一步。`;
  }
  if (chip === 'expand') {
    return `完整笔记草稿：\n\n${note.title}\n\n原文：${note.excerpt}\n\n我的理解：${note.understanding.trim() !== '' ? note.understanding : '（待补充）'}\n\n补充：这条摘录值得和${book}后文的呼应处对照着读，再落一个自己的例子。`;
  }
  return `基于这条笔记，可以继续问：\n· 这句话在全书的论证里扮演什么角色？\n· 它和前后章节的哪些推论相呼应？\n· 如果放到今天的语境里，它还成立吗？`;
}

const ASSISTANT_CHIPS: readonly { id: AssistantChip; label: string }[] = [
  { id: 'explain', label: '解释这段摘录' },
  { id: 'expand', label: '帮我扩写成完整笔记' },
  { id: 'ask', label: '基于这条笔记提问' },
];

// The storage snapshot is read through useSyncExternalStore (the same
// post-hydration pattern ThemeToggle uses for the theme), so the SSR shell and
// the hydration render agree on an empty list and stored notes appear on the
// follow-up render instead of a first-render mismatch.
const EMPTY_NOTES: readonly StoredNote[] = [];
let snapshotRaw: string | null = null;
let snapshotNotes: readonly StoredNote[] = EMPTY_NOTES;

function getNotesSnapshot(): readonly StoredNote[] {
  const raw = window.localStorage.getItem(NOTES_STORAGE_KEY);
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshotNotes = parseNotes(raw);
  }
  return snapshotNotes;
}

function subscribeNotes(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** Same-document lib writes do not fire a storage event; notify our own store. */
function notifyNotesChanged(): void {
  window.dispatchEvent(new StorageEvent('storage', { key: NOTES_STORAGE_KEY }));
}

export default function NotesPage() {
  const storedNotes = useSyncExternalStore(subscribeNotes, getNotesSnapshot, () => EMPTY_NOTES);
  const [seedNotes, setSeedNotes] = useState<readonly StoredNote[] | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, { title?: string; understanding?: string }>>({});
  const [tab, setTab] = useState<NoteTab>('all');
  const [book, setBook] = useState<string | null>(null);
  const [colorId, setColorId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredNote | null>(null);
  const [railView, setRailView] = useState<'assistant' | 'detail'>('assistant');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [colorOverride, setColorOverride] = useState<Record<string, string>>({});
  const [assistantContextIndex, setAssistantContextIndex] = useState(0);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [composerText, setComposerText] = useState('');
  const draftRef = useRef<DraftController | null>(null);

  const seedActive = seedNotes !== null;
  const notes: readonly StoredNote[] = useMemo(() => {
    const base = seedNotes ?? storedNotes;
    const ids = Object.keys(pendingEdits);
    if (ids.length === 0) return base;
    return base.map((n) => (pendingEdits[n.id] ? { ...n, ...pendingEdits[n.id] } : n));
  }, [seedNotes, storedNotes, pendingEdits]);

  function refreshFromStorage(): void {
    setSeedNotes(null);
    setPendingEdits({});
    notifyNotesChanged();
  }

  function getDraft(): DraftController {
    if (draftRef.current === null) {
      draftRef.current = createDraftController({
        delayMs: 800,
        persist: (target, patch) => {
          if (!seedActive) updateNote(target.id, patch);
        },
      });
    }
    return draftRef.current;
  }

  const books = useMemo(() => bookListOf(notes), [notes]);
  const filter: NotesFilter = useMemo(
    () => ({ tab, book, colorId, query }),
    [tab, book, colorId, query],
  );
  const visibleNotes = useMemo(() => filterNotes(notes, filter), [notes, filter]);

  const selectedNote =
    visibleNotes.find((n) => n.id === selectedId) ??
    notes.find((n) => n.id === selectedId) ??
    null;

  const assistantNote =
    visibleNotes[assistantContextIndex % Math.max(visibleNotes.length, 1)] ?? null;

  function selectNote(id: string | null): void {
    getDraft().flush();
    setSelectedId(id);
    setEditingTitle(false);
    if (id !== null) setRailView('detail');
  }

  function handleCopy(note: StoredNote): void {
    void navigator.clipboard?.writeText(note.excerpt).catch(() => undefined);
    setMenuNoteId(null);
  }

  function handleDelete(): void {
    if (deleteTarget === null) return;
    getDraft().flush();
    if (seedActive) {
      setSeedNotes((prev) => (prev ?? []).filter((n) => n.id !== deleteTarget.id));
    } else {
      deleteNote(deleteTarget.id);
      notifyNotesChanged();
    }
    if (selectedId === deleteTarget.id) {
      setSelectedId(null);
      setRailView('assistant');
    }
    setDeleteTarget(null);
    setMenuNoteId(null);
  }

  function handleSaveReplyAsNote(): void {
    const lastAi = [...turns].reverse().find((t) => t.role === 'ai');
    if (lastAi === undefined) return;
    const context = assistantNote ?? selectedNote;
    if (context === null) return;
    const selection = lastAi.text.trim();
    if (selection === '') return;
    const result = createNote({
      selection,
      sourceContentId: `ai:${context.id}`,
      sourceLabel: context.sourceLabel,
    });
    if (result.ok) {
      setTurns((prev) => [...prev, { role: 'user', text: '已保存为笔记 ✓' }]);
      refreshFromStorage();
    } else {
      setTurns((prev) => [
        ...prev,
        { role: 'user', text: `保存失败（${result.reason === 'cap' ? '已达 200 条上限' : '存储不可用'}）` },
      ]);
    }
  }

  function sendComposer(): void {
    const text = composerText.trim();
    if (text === '' || assistantNote === null) return;
    setTurns((prev) => [
      ...prev,
      { role: 'user', text },
      { role: 'ai', text: `（本地演示回答）关于「${assistantNote.title}」：这段内容可以结合原书上下文继续展开，扩写与提问 chips 会给出结构化的笔记草稿。` },
    ]);
    setComposerText('');
  }

  function runChip(chip: AssistantChip): void {
    if (assistantNote === null) return;
    setTurns((prev) => [
      ...prev,
      { role: 'user', text: ASSISTANT_CHIPS.find((c) => c.id === chip)?.label ?? '' },
      { role: 'ai', text: buildAssistantReply(chip, assistantNote) },
    ]);
  }

  function switchAssistantContext(): void {
    if (visibleNotes.length > 0) {
      setAssistantContextIndex((i) => (i + 1) % visibleNotes.length);
      setTurns([]);
    }
  }

  const shownColor = (note: StoredNote) =>
    HIGHLIGHT_COLORS.find((c) => c.id === colorOverride[note.id]) ??
    deriveHighlightColor(note.id);

  const hasAnyNotes = notes.length > 0;

  return (
    <main className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <h1 className="text-xl font-semibold">笔记与摘录</h1>

          <select
            className="h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)]"
            value={book ?? ''}
            onChange={(e) => setBook(e.target.value === '' ? null : e.target.value)}
            aria-label="按书籍筛选"
          >
            <option value="">全部书籍</option>
            {books.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <nav className="flex items-stretch self-stretch" aria-label="笔记类型筛选">
            {NOTE_TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={active}
                  className={`relative px-3 text-sm transition-colors duration-150 ${
                    active
                      ? 'font-medium text-[var(--primary-deep)]'
                      : 'text-[var(--text-2)] hover:text-[var(--text)]'
                  } focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--primary)]`}
                >
                  {t.label}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-[var(--primary)]"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1" role="group" aria-label="按高亮色筛选">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={`高亮色·${c.name}`}
                  aria-pressed={colorId === c.id}
                  onClick={() => setColorId((prev) => (prev === c.id ? null : c.id))}
                  className={`size-5 rounded-full transition-shadow duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${
                    colorId === c.id
                      ? 'ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--surface)]'
                      : 'hover:ring-2 hover:ring-[var(--border)]'
                  }`}
                  style={{ backgroundColor: c.value }}
                >
                  <span className="sr-only">{`高亮色·${c.name}`}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索笔记内容"
              aria-label="搜索笔记内容"
              className="h-10 w-56 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--text-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]"
            />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex flex-1 items-stretch">
        <section className="min-w-0 flex-1 p-6" aria-label="笔记列表">
          {!hasAnyNotes ? (
            <NotesEmptyState onLoadSeed={() => { setSeedNotes(createSeedNotes()); setPendingEdits({}); }} />
          ) : visibleNotes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-base text-[var(--text)]">没有匹配的笔记</p>
              <p className="text-sm text-[var(--text-2)]">试试更换筛选条件或搜索关键词</p>
              <button
                type="button"
                onClick={() => { setTab('all'); setBook(null); setColorId(null); setQuery(''); }}
                className="h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                清除筛选
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {visibleNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  color={shownColor(note)}
                  kind={deriveNoteKind(note)}
                  selected={selectedId === note.id}
                  menuOpen={menuNoteId === note.id}
                  onOpenMenu={() => setMenuNoteId(menuNoteId === note.id ? null : note.id)}
                  onCloseMenu={() => setMenuNoteId(null)}
                  onSelect={() => selectNote(note.id)}
                  onCopy={() => handleCopy(note)}
                  onDelete={() => { setDeleteTarget(note); setMenuNoteId(null); }}
                  onAskAi={() => { selectNote(note.id); setRailView('assistant'); }}
                />
              ))}
            </div>
          )}
        </section>

        {!railCollapsed && (
          <aside className="hidden w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] lg:flex">
            {railView === 'detail' && selectedNote !== null ? (
              <NoteDetail
                key={selectedNote.id}
                note={selectedNote}
                color={shownColor(selectedNote)}
                onBack={() => { setRailView('assistant'); setSelectedId(null); }}
                onColor={(id) => setColorOverride((prev) => ({ ...prev, [selectedNote.id]: id }))}
                editingTitle={editingTitle}
                onToggleEditTitle={() => setEditingTitle((v) => !v)}
                onTitleChange={(title) => {
                  getDraft().edit(selectedNote, 'title', title);
                  setPendingEdits((prev) => ({ ...prev, [selectedNote.id]: { ...prev[selectedNote.id], title } }));
                }}
                onUnderstandingChange={(understanding) => {
                  getDraft().edit(selectedNote, 'understanding', understanding);
                  setPendingEdits((prev) => ({ ...prev, [selectedNote.id]: { ...prev[selectedNote.id], understanding } }));
                }}
                onDelete={() => setDeleteTarget(selectedNote)}
              />
            ) : (
              <AssistantRail
                note={assistantNote}
                turns={turns}
                composerText={composerText}
                onComposerText={setComposerText}
                onSend={sendComposer}
                onChip={runChip}
                onSwitchContext={switchAssistantContext}
                onSaveReply={handleSaveReplyAsNote}
                onCollapse={() => setRailCollapsed(true)}
              />
            )}
          </aside>
        )}
        {railCollapsed && (
          <button
            type="button"
            onClick={() => setRailCollapsed(false)}
            className="w-10 shrink-0 border-l border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text-2)] transition-colors duration-150 hover:text-[var(--text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]"
            aria-label="展开 AI 笔记助手"
          >
            ‹
          </button>
        )}
      </div>

      {deleteTarget !== null && (
        <ConfirmDeleteDialog
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </main>
  );
}

function NoteCard(props: {
  note: StoredNote;
  color: (typeof HIGHLIGHT_COLORS)[number];
  kind: ReturnType<typeof deriveNoteKind>;
  selected: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onSelect: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onAskAi: () => void;
}) {
  const { note, color, kind } = props;
  return (
    <article
      className="group relative cursor-pointer overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-none transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)] data-[selected=true]:border-[var(--primary)]"
      data-selected={props.selected}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={props.selected}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color.value }} />
      <div className="flex flex-col gap-3 p-5 pt-6">
        <p className="line-clamp-4 text-[15px] leading-relaxed text-[var(--text)]">
          “{note.excerpt}”
        </p>
        {note.understanding.trim() !== '' && (
          <p className="text-sm text-[var(--text-2)]">批注：{note.understanding}</p>
        )}
        <footer className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-[var(--text-2)]">
          <span className="truncate">
            {note.sourceLabel !== '' ? `${note.sourceLabel} · ` : ''}
            {formatRelativeTime(note.updatedAt)}
          </span>
          {kind === 'ai' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); props.onAskAi(); }}
              className="shrink-0 rounded-full bg-[var(--primary-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--primary-deep)] transition-colors duration-150 hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              ✦ AI 问答
            </button>
          )}
        </footer>
      </div>

      <button
        type="button"
        aria-label="更多操作"
        aria-expanded={props.menuOpen}
        onClick={(e) => { e.stopPropagation(); props.onOpenMenu(); }}
        className="absolute right-3 top-3 size-8 rounded-lg text-base text-[var(--text-2)] opacity-0 transition-opacity duration-150 hover:bg-[var(--hover-bg)] hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] group-hover:opacity-100"
      >
        ⋯
      </button>

      {props.menuOpen && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-30 cursor-default"
            onClick={(e) => { e.stopPropagation(); props.onCloseMenu(); }}
          />
          <div
            role="menu"
            className="absolute right-3 top-11 z-40 w-40 rounded-[var(--radius-menu)] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={props.onSelect}
              className="block w-full px-4 py-2 text-left text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--hover-bg)] focus-visible:bg-[var(--hover-bg)] focus-visible:outline-none"
            >
              在书中查看
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={props.onCopy}
              className="block w-full px-4 py-2 text-left text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--hover-bg)] focus-visible:bg-[var(--hover-bg)] focus-visible:outline-none"
            >
              复制
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={props.onDelete}
              className="block w-full px-4 py-2 text-left text-sm text-[var(--danger)] transition-colors duration-150 hover:bg-[var(--hover-bg)] focus-visible:bg-[var(--hover-bg)] focus-visible:outline-none"
            >
              删除
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function NoteDetail(props: {
  note: StoredNote;
  color: (typeof HIGHLIGHT_COLORS)[number];
  onBack: () => void;
  onColor: (colorId: string) => void;
  editingTitle: boolean;
  onToggleEditTitle: () => void;
  onTitleChange: (title: string) => void;
  onUnderstandingChange: (text: string) => void;
  onDelete: () => void;
}) {
  const { note } = props;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-base font-semibold">笔记详情</h2>
        <button
          type="button"
          onClick={props.onBack}
          className="rounded-md px-2 py-1 text-sm text-[var(--text-2)] transition-colors duration-150 hover:bg-[var(--hover-bg)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          返回助手
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <section>
          <h3 className="mb-2 text-xs text-[var(--text-2)]">原文</h3>
          <blockquote
            className="rounded-r-lg border-l-[3px] bg-[var(--bg)] px-4 py-3 text-[15px] leading-relaxed text-[var(--text)]"
            style={{ borderLeftColor: 'var(--primary)' }}
          >
            “{note.excerpt}”
            {note.excerptTruncated && <span className="text-[var(--text-2)]">（节选）</span>}
          </blockquote>
        </section>

        <section>
          <h3 className="mb-2 text-xs text-[var(--text-2)]">高亮色</h3>
          <div className="flex items-center gap-2">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.name}
                aria-pressed={props.color.id === c.id}
                onClick={() => props.onColor(c.id)}
                className={`size-5 rounded-full transition-shadow duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${
                  props.color.id === c.id
                    ? 'ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--surface)]'
                    : 'hover:ring-2 hover:ring-[var(--border)]'
                }`}
                style={{ backgroundColor: c.value }}
              >
                <span className="sr-only">{`高亮色·${c.name}`}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs text-[var(--text-2)]">我的批注（可编辑）</h3>
          <textarea
            value={note.understanding}
            onChange={(e) => props.onUnderstandingChange(e.target.value)}
            placeholder="写下你对这段摘录的理解…"
            aria-label="我的批注"
            rows={4}
            className="w-full resize-y rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-relaxed text-[var(--text)] placeholder:text-[var(--text-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]"
          />
        </section>

        <p className="text-xs text-[var(--text-2)]">
          {note.sourceLabel !== '' ? `${note.sourceLabel} · ` : ''}
          {formatRelativeTime(note.updatedAt)}
        </p>
      </div>

      <footer className="flex items-center gap-2 border-t border-[var(--border)] px-5 py-4">
        <button
          type="button"
          onClick={props.onBack}
          className="h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          📖 在书中查看
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={props.onToggleEditTitle}
            aria-expanded={props.editingTitle}
            className="h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={props.onDelete}
            className="h-10 rounded-[var(--radius-control)] border border-[var(--danger)] bg-[var(--danger-bg)] px-4 text-sm text-[var(--danger)] transition-colors duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]"
          >
            删除
          </button>
        </div>
      </footer>

      {props.editingTitle && (
        <div className="border-t border-[var(--border)] px-5 py-4">
          <label className="mb-2 block text-xs text-[var(--text-2)]" htmlFor="note-title-input">
            笔记标题（保存即生效）
          </label>
          <input
            id="note-title-input"
            value={note.title}
            onChange={(e) => props.onTitleChange(e.target.value)}
            className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]"
          />
        </div>
      )}
    </div>
  );
}

function AssistantRail(props: {
  note: StoredNote | null;
  turns: AssistantTurn[];
  composerText: string;
  onComposerText: (text: string) => void;
  onSend: () => void;
  onChip: (chip: AssistantChip) => void;
  onSwitchContext: () => void;
  onSaveReply: () => void;
  onCollapse: () => void;
}) {
  const { note, turns } = props;
  const canSave = turns.some((t) => t.role === 'ai');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <h2 className="text-base font-semibold">AI 笔记助手</h2>
        <button
          type="button"
          onClick={props.onCollapse}
          aria-label="收起助手栏"
          className="rounded-md px-2 py-1 text-sm text-[var(--text-2)] transition-colors duration-150 hover:bg-[var(--hover-bg)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          ›
        </button>
      </header>

      <div className="px-5">
        {note !== null ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--primary-light)] px-3 py-2">
            <p className="min-w-0 truncate text-xs text-[var(--primary-deep)]">
              正在讨论：{extractBookName(note.sourceLabel)}笔记 · {note.title}
            </p>
            <button
              type="button"
              onClick={props.onSwitchContext}
              className="shrink-0 text-xs font-medium text-[var(--primary-deep)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              切换
            </button>
          </div>
        ) : (
          <p className="rounded-lg bg-[var(--hover-bg)] px-3 py-2 text-xs text-[var(--text-2)]">
            暂无笔记可作为上下文
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {ASSISTANT_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              disabled={note === null}
              onClick={() => props.onChip(chip.id)}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)] transition-colors duration-150 hover:bg-[var(--hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <p
              key={i}
              className="ml-auto w-fit max-w-[85%] rounded-xl bg-[var(--hover-bg)] px-3 py-2 text-sm text-[var(--text)]"
            >
              {turn.text}
            </p>
          ) : (
            <div key={i} className="max-w-[92%] rounded-xl bg-[var(--bg)] p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
                {turn.text}
              </p>
              {i === turns.length - 1 && (
                <button
                  type="button"
                  onClick={props.onSaveReply}
                  className="mt-3 h-9 rounded-[var(--radius-control)] bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  保存为笔记
                </button>
              )}
            </div>
          ),
        )}
        {turns.length === 0 && note !== null && (
          <p className="pt-6 text-center text-xs text-[var(--text-2)]">
            点击上方 chips，让 Deer 基于这条笔记继续工作
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border)] p-4">
        <input
          value={props.composerText}
          onChange={(e) => props.onComposerText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') props.onSend(); }}
          placeholder="针对这条笔记继续提问…"
          aria-label="针对这条笔记继续提问"
          className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--text-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]"
        />
        <button
          type="button"
          onClick={props.onSend}
          disabled={props.composerText.trim() === '' || note === null}
          aria-label="发送"
          className="size-10 shrink-0 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↑
        </button>
      </div>
      {!canSave && <span className="sr-only">尚无可保存的 AI 回答</span>}
    </div>
  );
}

function NotesEmptyState(props: { onLoadSeed: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div
        aria-hidden
        className="flex w-64 flex-col items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <span className="h-2 w-40 rounded-full bg-[var(--primary-light)]" />
        <span className="h-2 w-48 rounded-full bg-[var(--border)]" />
        <span className="h-2 w-32 rounded-full bg-[var(--border)]" />
        <span className="mt-2 inline-block rounded-full bg-[var(--primary)] px-3 py-1 text-xs text-[var(--primary-foreground)]">
          问 Deer
        </span>
      </div>
      <p className="text-base text-[var(--text)]">还没有笔记</p>
      <p className="max-w-sm text-sm text-[var(--text-2)]">
        还没有笔记。阅读时划选文字即可创建高亮和笔记。
      </p>
      <button
        type="button"
        onClick={props.onLoadSeed}
        className="h-10 rounded-[var(--radius-control)] bg-[var(--primary)] px-5 text-sm font-medium text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        载入演示数据
      </button>
    </div>
  );
}

function ConfirmDeleteDialog(props: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="确认删除笔记"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 duration-200 animate-in fade-in-0"
      onClick={props.onCancel}
    >
      <div
        className="w-[300px] rounded-[var(--radius-overlay)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.2)] duration-200 animate-in zoom-in-95 fade-in-0"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-base font-semibold text-[var(--text)]">删除这条笔记？</h2>
        <p className="mb-5 text-sm text-[var(--text-2)]">删除后无法撤销，与它关联的笔记链接也会一并清除。</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            className="h-10 rounded-[var(--radius-control)] border border-[var(--danger)] bg-[var(--danger-bg)] px-4 text-sm text-[var(--danger)] transition-colors duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
