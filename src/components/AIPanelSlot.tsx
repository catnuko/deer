'use client';

import AIPanel from '@/src/components/AIPanel';

export interface AIPanelSlotProps {
  isOpen: boolean;
  onClose: () => void;
  readingContent: string;
  selectedText?: string;
  onClearSelection: () => void;
}

/**
 * 泳道 B 的 AI 面板挂载位（预留 slot）。当前透传到既有 AIPanel；
 * 后续 assistant-ui 面板在这里接管，阅读页外壳不再改动。
 */
export default function AIPanelSlot({
  isOpen,
  onClose,
  readingContent,
  selectedText,
  onClearSelection,
}: AIPanelSlotProps) {
  return (
    <AIPanel
      isOpen={isOpen}
      onClose={onClose}
      readingContent={readingContent}
      selectedText={selectedText}
      onClearSelection={onClearSelection}
    />
  );
}
