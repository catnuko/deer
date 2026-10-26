/**
 * The bridge between the global ⌘K palette and the pages it drives.
 *
 * A palette item either acts on the page that is already open (the settings
 * panel) or on the reading page, which may not be mounted yet (a stored
 * session, a stored note). The window event covers the first case, the
 * sessionStorage copy covers the second one: the target survives the
 * navigation that follows the selection.
 *
 * The stored copy is only honoured while it is fresh, so a target that was
 * never consumed — the reader closed the tab, or the reading page bounced
 * back to the start page — can never fire on some later visit.
 */

export type CommandKind = 'settings' | 'session' | 'note';

export interface CommandTarget {
  kind: CommandKind;
  /** The session content id or the note id; unused for 'settings'. */
  id?: string;
  /** When the target was raised, in epoch milliseconds. */
  at: number;
}

export const COMMAND_EVENT = 'deer:command';
export const COMMAND_PENDING_KEY = 'deer-command-pending';

/** A stored target older than this is ignored. */
export const COMMAND_TARGET_TTL_MS = 10_000;

/**
 * Hand a command to whoever is listening right now. The window event is the
 * only live channel; the stored copy is the fallback for a page that is still
 * on its way.
 */
export function emitCommand(target: CommandTarget): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<CommandTarget>(COMMAND_EVENT, { detail: target }));
}

/**
 * Raise a command. The window event reaches a listener that is already
 * mounted; the stored copy is the fallback for a page that is still on its
 * way. The settings panel lives on the page that is already open, so it never
 * needs the stored copy.
 */
export function dispatchCommand(kind: CommandKind, id?: string): void {
  if (typeof window === 'undefined') return;

  const target: CommandTarget = { kind, id, at: Date.now() };

  if (kind !== 'settings') {
    try {
      window.sessionStorage.setItem(COMMAND_PENDING_KEY, JSON.stringify(target));
    } catch {
      // Storage disabled: only the event below can reach the listener.
    }
  }

  emitCommand(target);
}

/**
 * The command that was raised just before a navigation, if it is still fresh.
 */
export function readPendingCommand(): CommandTarget | null {
  if (typeof window === 'undefined') return null;

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(COMMAND_PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CommandTarget>;
    if (parsed.kind !== 'settings' && parsed.kind !== 'session' && parsed.kind !== 'note') return null;
    if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null;
    if (Date.now() - parsed.at > COMMAND_TARGET_TTL_MS) return null;
    return { kind: parsed.kind, id: parsed.id, at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * Drop the stored command once it has been handed over, so it is applied
 * exactly once.
 */
export function clearPendingCommand(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(COMMAND_PENDING_KEY);
  } catch {
    // Storage disabled: there was nothing stored to begin with.
  }
}
