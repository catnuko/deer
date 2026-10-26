/**
 * Live text-selection access for the capture entry. The 「🔖 收藏笔记」
 * button availability is a pure function of the browser's current selection,
 * independent of the 「问 Deer」 conversation flow that consumes its own
 * selectedText copy.
 */
export function getSelectionText(): string {
  if (typeof window === 'undefined') return '';
  return window.getSelection()?.toString() ?? '';
}

export function isCaptureAvailable(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trim().length > 0;
}
