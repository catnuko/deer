import type { StoredNote } from './notes';

export type DraftField = 'title' | 'understanding';

/**
 * The pending edit of one note. A null field means "not edited yet", which is
 * what keeps an untouched field out of the persistence patch.
 */
export interface DraftValues {
  title: string | null;
  understanding: string | null;
}

export interface NotePatch {
  title?: string;
  understanding?: string;
}

/**
 * Build the persistence patch of a note from the current draft values.
 * A blank title is dropped (the note keeps the title it had) while the
 * understanding may be cleared to an empty string on purpose.
 */
export function buildNotePatch(
  target: Pick<StoredNote, 'title' | 'understanding'>,
  draft: DraftValues,
): NotePatch {
  const patch: NotePatch = {};
  const title = draft.title;
  const understanding = draft.understanding;
  if (title !== null && title.trim() !== '' && title !== target.title) patch.title = title;
  if (understanding !== null && understanding !== target.understanding) {
    patch.understanding = understanding;
  }
  return patch;
}

export interface DraftController {
  /** Record a typed value and (re)arm the debounce timer for that note. */
  edit(target: StoredNote, field: DraftField, value: string): void;
  /** Persist the pending draft now and cancel the timer. */
  flush(): NotePatch | null;
  /** Drop the pending draft without persisting it. */
  reset(): void;
  /** The values typed but not yet persisted. */
  values(): DraftValues;
}

export interface DraftControllerOptions {
  delayMs: number;
  persist: (target: StoredNote, patch: NotePatch) => void;
}

/**
 * Own the pending note draft outside React state. The debounce timer has to
 * persist the values typed most recently, not the ones captured by the render
 * that armed it, so the draft lives here and the timer reads it when it fires.
 */
export function createDraftController(options: DraftControllerOptions): DraftController {
  let draft: DraftValues = { title: null, understanding: null };
  let target: StoredNote | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function apply(): NotePatch | null {
    cancelTimer();
    if (target === null) return null;
    const current = target;
    target = null;
    const patch = buildNotePatch(current, draft);
    draft = { title: null, understanding: null };
    if (Object.keys(patch).length === 0) return null;
    options.persist(current, patch);
    return patch;
  }

  return {
    edit(nextTarget, field, value) {
      draft = { ...draft, [field]: value };
      target = nextTarget;
      cancelTimer();
      timer = setTimeout(() => {
        apply();
      }, options.delayMs);
    },
    flush() {
      return apply();
    },
    reset() {
      cancelTimer();
      draft = { title: null, understanding: null };
      target = null;
    },
    values() {
      return draft;
    },
  };
}
