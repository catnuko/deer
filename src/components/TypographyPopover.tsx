'use client';

import { useEffect, useRef } from 'react';

export const FONT_SIZE_OPTIONS = [14, 16, 18, 20, 22, 24];
export const LINE_HEIGHT_OPTIONS = [1.5, 1.8, 2.2];
export const PAGE_WIDTH_OPTIONS = [36, 42, 48];

export interface TypographyState {
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
}

export const DEFAULT_TYPOGRAPHY: TypographyState = {
  fontSize: 16,
  lineHeight: 1.8,
  pageWidth: 42,
};

interface TypographyPopoverProps {
  open: boolean;
  value: TypographyState;
  onChange: (next: TypographyState) => void;
  onClose: () => void;
}

function SliderRow({
  label,
  display,
  index,
  count,
  onChangeIndex,
  minLabel,
  maxLabel,
}: {
  label: string;
  display: string;
  index: number;
  count: number;
  onChangeIndex: (i: number) => void;
  minLabel: string;
  maxLabel: string;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm text-[var(--text)]">{label}</span>
        <span className="text-xs tabular-nums text-[var(--text-2)]">{display}</span>
      </div>
      <input
        type="range"
        min={0}
        max={count - 1}
        step={1}
        value={index}
        onChange={(e) => onChangeIndex(Number(e.target.value))}
        aria-label={label}
        className="deer-slider w-full"
      />
      <div className="mt-0.5 flex justify-between text-xs text-[var(--text-2)]">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

/**
 * 排版弹层（spec §3.3 / 任务范围：字号 / 行距 / 页宽三条滑杆，改动即时
 * 生效；底部「恢复默认」文字按钮）。挂在顶栏按钮下，点外部或 Esc 关闭。
 */
export default function TypographyPopover({ open, value, onChange, onClose }: TypographyPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const fontIndex = Math.max(0, FONT_SIZE_OPTIONS.indexOf(value.fontSize));
  const lineHeightIndex = Math.max(0, LINE_HEIGHT_OPTIONS.indexOf(value.lineHeight));
  const pageWidthIndex = Math.max(0, PAGE_WIDTH_OPTIONS.indexOf(value.pageWidth));

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="排版设置"
      className="absolute right-0 top-full z-[800] mt-2 w-[300px] rounded-[var(--radius-overlay)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
    >
      <SliderRow
        label="字号"
        display={`${value.fontSize}px`}
        index={fontIndex}
        count={FONT_SIZE_OPTIONS.length}
        onChangeIndex={(i) => onChange({ ...value, fontSize: FONT_SIZE_OPTIONS[i] })}
        minLabel="14px"
        maxLabel="24px"
      />
      <SliderRow
        label="行距"
        display={value.lineHeight.toFixed(1)}
        index={lineHeightIndex}
        count={LINE_HEIGHT_OPTIONS.length}
        onChangeIndex={(i) => onChange({ ...value, lineHeight: LINE_HEIGHT_OPTIONS[i] })}
        minLabel="紧凑 1.5"
        maxLabel="宽松 2.2"
      />
      <SliderRow
        label="页宽"
        display={`${value.pageWidth}em`}
        index={pageWidthIndex}
        count={PAGE_WIDTH_OPTIONS.length}
        onChangeIndex={(i) => onChange({ ...value, pageWidth: PAGE_WIDTH_OPTIONS[i] })}
        minLabel="窄 36em"
        maxLabel="宽 48em"
      />
      <div className="mt-2 border-t border-[var(--border)] pt-3 text-center">
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TYPOGRAPHY)}
          className="text-sm text-[var(--primary-deep)] hover:underline"
        >
          恢复默认
        </button>
      </div>
    </div>
  );
}
