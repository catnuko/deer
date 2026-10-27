'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** 粘贴文本导入：交给书架页走既有 sessionStorage 写入。 */
  onStartFromText: (text: string, fileName: string | null) => void;
  /** 选择文件后交给书架页读取（读取过程在书架显示骨架屏/失败卡）。 */
  onFileSelected: (file: File) => void;
}

/**
 * 导入书籍弹层（弹层圆角 16）。文本粘贴走既有开始阅读流程；文件选择后
 * 关闭弹层，由书架页显示「导入中骨架屏」或「导入失败卡」。
 */
export default function ImportDialog({ open, onClose, onStartFromText, onFileSelected }: ImportDialogProps) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onFileSelected(file);
  }

  function handleStartReading() {
    if (!text.trim()) {
      window.alert('请先输入文本或上传文件');
      return;
    }
    onStartFromText(text, null);
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="导入书籍"
        className="w-[90%] max-w-[520px] rounded-[var(--radius-overlay)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text)]">导入书籍</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭导入弹层"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-2)] hover:bg-[var(--hover-bg)] hover:text-[var(--text)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <textarea
          className="min-h-[200px] w-full resize-y rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--input-bg)] p-4 text-sm text-[var(--text)] focus:outline-2 focus:outline-[var(--primary)]"
          placeholder="在此粘贴你要阅读的内容…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="阅读内容输入框"
        />

        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-10 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] transition-colors duration-[var(--dur-micro)] hover:bg-[var(--hover-bg)]"
            >
              上传文件
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              onChange={handleFileUpload}
              className="hidden"
              aria-label="文件上传"
            />
          </div>
          <button
            type="button"
            onClick={handleStartReading}
            className="h-10 shrink-0 rounded-[var(--radius-control)] bg-[var(--primary)] px-6 text-sm font-medium text-white transition-colors duration-[var(--dur-micro)] hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]"
          >
            开始阅读
          </button>
        </div>
      </div>
    </div>
  );
}
