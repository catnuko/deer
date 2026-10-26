import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The contract of the ⌘K palette component.
 *
 * The palette is a React component, and the test stack of this repository is
 * vitest in a node environment without a DOM renderer: there is no
 * @testing-library here, and adding one is out of scope. The behaviour that
 * can be reached without a renderer is therefore pinned at the source level,
 * the same way the storage-key contract is pinned in `command-contract.test.ts`:
 * the names and the branches the component relies on must stay in place.
 *
 * The data the palette reads (the session list, the note list, the presence
 * of a reading text) is unit tested where it lives: `chat-storage`,
 * `notes` and `reading`.
 */
function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const palette = readSource('../src/components/CommandPalette.tsx');

describe('the palette reads the real stores', () => {
  it('lists the stored sessions and notes', () => {
    expect(palette).toContain('listSessions()');
    expect(palette).toContain('listNotes()');
  });

  it('asks whether the tab has a text open', () => {
    expect(palette).toContain('hasReadingContent()');
  });
});

describe('the palette raises the three kinds of command', () => {
  it('raises the settings command for the settings entry', () => {
    expect(palette).toContain("dispatchCommand('settings')");
  });

  it('raises a session command with the session content id', () => {
    expect(palette).toContain("dispatchCommand('session', contentId)");
  });

  it('raises a note command with the note id', () => {
    expect(palette).toContain("dispatchCommand('note', noteId)");
  });
});

describe('the palette is honest when the tab has no text', () => {
  it('disables the stored entries and the reading page when there is no text', () => {
    expect(palette).toContain('const needsText = !hasContent;');
    expect(palette).toContain('disabled={needsText}');
  });

  it('says why the entries cannot be opened', () => {
    expect(palette).toContain("const NEEDS_TEXT = '需先打开一篇文本'");
    expect(palette).toContain('{needsText ? NEEDS_TEXT');
  });
});

describe('the palette opens and closes on the keyboard', () => {
  it('listens for the ⌘K / Ctrl+K chord', () => {
    expect(palette).toContain("event.key.toLowerCase() !== 'k'");
    expect(palette).toContain('event.metaKey || event.ctrlKey');
  });
});
