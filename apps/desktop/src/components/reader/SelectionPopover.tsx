import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Copy,
  Highlighter,
  NotebookPen,
  Palette,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { SelectionPlacement } from "@/lib/ai/selectionDraft";
import { HIGHLIGHT_COLORS } from "./highlightColors";

/**
 * 划选后的微信读书式菜单：绝对定位在正文容器内，
 * x/y/placement 由 popoverPlacement 算好传入。
 * 「高亮」展开色条、「笔记」展开输入框，都是菜单内的二级面板；
 * 菜单何时关闭由父级（清掉 selection 状态）决定。
 * `existing` 传入时是编辑已有高亮的菜单：改色 / 笔记 / 删除。
 */
export function SelectionPopover({
  x,
  y,
  placement,
  text = "",
  existing,
  onCopy,
  onHighlight,
  onNote,
  onAsk,
  onDelete,
}: SelectionPlacement & {
  text?: string;
  /** 编辑已有高亮：预填颜色与笔记，菜单切为改色/笔记/删除。 */
  existing?: { color: string; note?: string };
  onCopy?: (text: string) => void;
  onHighlight: (color: string) => void;
  onNote: (note: string) => void;
  onAsk?: (text: string) => void;
  onDelete?: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "colors" | "note">("menu");
  const [note, setNote] = useState(existing?.note ?? "");

  return (
    <div className="absolute z-20" style={{ left: x, top: y }}>
      <div
        className={cn(
          "border-border bg-background -translate-x-1/2 rounded-lg border shadow-md",
          placement === "above" && "-translate-y-full",
          mode === "note" && "w-72",
        )}
        onClick={(event) => {
          // 别让点击冒泡到正文的边缘翻页捕获层。
          event.stopPropagation();
        }}
      >
        {mode === "menu" && existing ? (
          <div className="divide-border flex divide-x">
            <MenuButton
              icon={Palette}
              label="改色"
              onClick={() => setMode("colors")}
            />
            <MenuButton
              icon={NotebookPen}
              label="笔记"
              onClick={() => setMode("note")}
            />
            <MenuButton icon={Trash2} label="删除" onClick={() => onDelete?.()} />
          </div>
        ) : null}
        {mode === "menu" && !existing ? (
          <div className="divide-border flex divide-x">
            <MenuButton icon={Copy} label="复制" onClick={() => onCopy?.(text)} />
            <MenuButton
              icon={Highlighter}
              label="高亮"
              onClick={() => setMode("colors")}
            />
            <MenuButton
              icon={NotebookPen}
              label="笔记"
              onClick={() => setMode("note")}
            />
            <MenuButton
              icon={Sparkles}
              label="问 Deer"
              onClick={() => onAsk?.(text)}
            />
          </div>
        ) : null}
        {mode === "colors" ? (
          <div className="flex items-center gap-2.5 p-2.5">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.key}
                type="button"
                aria-label={`高亮：${color.label}`}
                className="size-6 rounded-full border border-black/10 transition-transform hover:scale-110"
                style={{ backgroundColor: color.value }}
                onClick={() => onHighlight(color.value)}
              />
            ))}
          </div>
        ) : null}
        {mode === "note" ? (
          <div className="flex flex-col gap-2 p-2.5">
            <Textarea
              autoFocus
              aria-label="笔记内容"
              placeholder="写下这一段的想法…"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setMode("menu")}>
                取消
              </Button>
              <Button
                size="sm"
                disabled={note.trim().length === 0}
                onClick={() => onNote(note.trim())}
              >
                保存
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hover:bg-muted text-foreground flex flex-col items-center gap-1 rounded-md px-3 py-2 text-xs"
      onClick={onClick}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
