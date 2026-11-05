import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Copy, Highlighter, NotebookPen, Sparkles, type LucideIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SelectionPlacement } from "@/lib/ai/selectionDraft";
import { fitPopover, type PopoverFit } from "@/lib/ai/selectionDraft";
import {
  ANNOTATION_STYLES,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  type AnnotationStyle,
} from "./highlightColors";

/**
 * 划选后的微信读书式菜单：一个浮层两行（行 1 动作、行 2 样式/颜色），
 * 绝对定位在正文容器内。落线后菜单不关：父级在落线后把它切成编辑态
 * （existing 传入），行 2 常驻、行 1 按钮变「删除划线」。
 * 浮层自量尺寸后在宿主内翻转/夹边（fitPopover），量不到尺寸的环境
 * （单测）退回父级传入的估算坐标。
 */
export function SelectionPopover({
  x,
  y,
  placement,
  selTop,
  selBottom,
  text = "",
  existing,
  onCopy,
  onHighlight,
  onNote,
  onAsk,
  onDelete,
}: SelectionPlacement & {
  text?: string;
  /** 编辑已有划线：行 1 显示「删除划线」并常驻行 2。 */
  existing?: { color: string; style: AnnotationStyle; note?: string };
  onCopy?: (text: string) => void;
  /** 点「划线」或行 2 改样式/颜色：style + color 一起回调。 */
  onHighlight: (style: AnnotationStyle, color: string) => void;
  onNote: (note: string) => void;
  onAsk?: (text: string) => void;
  onDelete?: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "note">("menu");
  const [note, setNote] = useState(existing?.note ?? "");
  const [fit, setFit] = useState<PopoverFit | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const expanded = existing != null;
  const style = existing?.style ?? DEFAULT_ANNOTATION_STYLE;
  const color = existing?.color ?? DEFAULT_HIGHLIGHT_COLOR;

  // 行 2 展开/收起会改浮层高度：按真实尺寸重测落位（翻转 + 夹边）。
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const popup = wrap?.firstElementChild as HTMLElement | null;
    const host = wrap?.offsetParent as HTMLElement | null;
    if (!wrap || !popup || !host) return;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    if (width === 0 && height === 0) return;
    setFit(
      fitPopover(
        { top: selTop, bottom: selBottom, centerX: x },
        { width: host.clientWidth, height: host.clientHeight },
        { width, height },
      ),
    );
  }, [expanded, mode, x, selTop, selBottom]);

  return (
    <div
      ref={wrapRef}
      className="absolute z-20"
      style={
        fit
          ? { left: fit.left, top: fit.top }
          : { left: x, top: y }
      }
    >
      <div
        className={cn(
          "bg-popover border-border rounded-lg border shadow-md",
          !fit && "-translate-x-1/2",
          !fit && placement === "above" && "-translate-y-full",
          mode === "note" && "w-72",
        )}
        onClick={(event) => {
          // 别让点击冒泡到正文的边缘翻页捕获层。
          event.stopPropagation();
        }}
      >
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
        ) : (
          <>
            <div className="divide-border flex divide-x">
              {onCopy ? (
                <MenuButton
                  icon={Copy}
                  label="复制"
                  onClick={() => onCopy(text)}
                />
              ) : null}
              {existing ? (
                <MenuButton
                  icon={Highlighter}
                  label="删除划线"
                  selected
                  onClick={() => onDelete?.()}
                />
              ) : (
                <MenuButton
                  icon={Highlighter}
                  label="划线"
                  onClick={() =>
                    onHighlight(DEFAULT_ANNOTATION_STYLE, DEFAULT_HIGHLIGHT_COLOR)
                  }
                />
              )}
              <MenuButton
                icon={NotebookPen}
                label="写想法"
                onClick={() => setMode("note")}
              />
              {onAsk ? (
                <MenuButton
                  icon={Sparkles}
                  label="问 Deer"
                  onClick={() => onAsk(text)}
                />
              ) : null}
            </div>
            {existing ? (
              <>
                <div className="bg-border h-px" role="separator" />
                <div className="flex items-center gap-2 px-2.5 py-2">
                  {ANNOTATION_STYLES.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      aria-label={`样式：${item.label}`}
                      aria-pressed={style === item.key}
                      className={cn(
                        "text-foreground hover:bg-muted/60 flex size-8 items-center justify-center rounded-full text-sm font-medium transition-colors duration-fast ease-enter",
                        style === item.key && "bg-muted",
                      )}
                      onClick={() => onHighlight(item.key, color)}
                    >
                      <span style={STYLE_MARK[item.key]}>A</span>
                    </button>
                  ))}
                  <div className="bg-border mx-1 h-6 w-px" role="separator" />
                  {HIGHLIGHT_COLORS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      aria-label={`颜色：${item.label}`}
                      aria-pressed={color === item.value}
                      className={cn(
                        "size-6 rounded-full border border-black/10 transition-shadow duration-fast ease-enter",
                        color === item.value &&
                          "ring-foreground ring-2 ring-offset-2 ring-offset-popover",
                      )}
                      style={{ backgroundColor: item.value }}
                      onClick={() => onHighlight(style, item.value)}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** 行 2 样式圆钮里的「A」：马克笔衬色块、直线/波浪用文本下划线。 */
const STYLE_MARK: Record<AnnotationStyle, CSSProperties> = {
  marker: {
    backgroundImage: "linear-gradient(currentColor, currentColor)",
    backgroundSize: "100% 38%",
    backgroundPosition: "0 82%",
    backgroundRepeat: "no-repeat",
  },
  line: {
    textDecorationLine: "underline",
    textDecorationThickness: "2px",
    textUnderlineOffset: "3px",
  },
  dash: {
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textUnderlineOffset: "2px",
  },
};

function MenuButton({
  icon: Icon,
  label,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "hover:bg-muted text-foreground flex flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors duration-fast ease-enter",
        selected && "bg-muted",
      )}
      onClick={onClick}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
