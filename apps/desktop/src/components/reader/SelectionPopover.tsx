import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Copy, Highlighter, NotebookPen, Sparkles, type LucideIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SelectionPlacement } from "@/lib/ai/selectionDraft";
import { fitPopover } from "@/lib/ai/selectionDraft";
import {
  ANNOTATION_STYLES,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  type AnnotationStyle,
} from "./highlightColors";

/** 主菜单与上方二级菜单之间的垂直间距。 */
const SUBMENU_GAP = 6;
/**
 * 行 2 卡片高度的预留值（py-2 + size-8 圆钮 + 上下边框 ≈ 50px）。
 * 整块浮层按「主菜单 + 二级菜单」的总高度决定放选区上方还是下方，
 * 行 2 尚未展开时也用这个预留值参与计算——否则点「划线」行 2 一出现，
 * 整块变高就会带着主菜单重新落位，也就是「主菜单被顶上去」。
 */
const SUBMENU_HEIGHT = 50;
const EDGE_MARGIN = 8;

type MenuFit = {
  /** 主菜单左上角（宿主坐标系）。 */
  left: number;
  top: number;
};

/** 二级菜单相对主菜单左上角的偏移。 */
type SubmenuOffset = { left: number; top: number };

function clampTo(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(max, min));
}

/**
 * 划选后的微信读书式菜单：行 1 是绝对定位的主菜单（复制 / 划线·删除划线 /
 * 写想法 / 问 Deer），行 2 是它的二级菜单（样式圆钮 + 颜色圆点），作为
 * 独立浮层悬在主菜单正上方（2026-11-06 12:55 口径）。
 *
 * 定位职责分开：主菜单只按选区落位，落位时把行 2 的预留高度算进整块，
 * 因此行 2 展开/收起前后主菜单坐标不变；行 2 只按主菜单最终矩形往上贴，
 * 不再回头重算主菜单。整块仍优先放选区上方、放不下整块翻下方，翻面后
 * 行 2 依旧在主菜单上方；四边夹在宿主内留 8px。
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
  /** 编辑已有划线：行 1 显示「删除划线」，上方展开行 2。 */
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
  const [menuFit, setMenuFit] = useState<MenuFit | null>(null);
  const [submenuOffset, setSubmenuOffset] = useState<SubmenuOffset | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const showSubmenu = existing != null && mode === "menu";
  const style = existing?.style ?? DEFAULT_ANNOTATION_STYLE;
  const color = existing?.color ?? DEFAULT_HIGHLIGHT_COLOR;

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const menu = menuRef.current;
    const host = wrap?.offsetParent as HTMLElement | null;
    if (!wrap || !menu || !host) return;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    if (width === 0 && height === 0) return;

    const hostWidth = host.clientWidth;
    const hostHeight = host.clientHeight;
    // 写想法时行 2 不出现，不预留；菜单态无论行 2 是否已展开都按整块预留，
    // 保证主菜单落位与行 2 展开状态无关。
    const reserved = mode === "menu" ? SUBMENU_GAP + SUBMENU_HEIGHT : 0;
    const block = fitPopover(
      { top: selTop, bottom: selBottom, centerX: x },
      { width: hostWidth, height: hostHeight },
      { width, height: height + reserved },
      EDGE_MARGIN,
    );
    // fitPopover 定位的是整块（上方二级菜单 + 主菜单），主菜单落在整块下部。
    const left = block.left;
    const top = block.top + reserved;
    setMenuFit({ left, top });

    const submenu = submenuRef.current;
    if (!submenu || reserved === 0) return;
    const submenuWidth = submenu.offsetWidth;
    const submenuHeight = submenu.offsetHeight;
    if (submenuWidth === 0 && submenuHeight === 0) return;
    // 二级菜单与主菜单水平居中对齐；比主菜单宽时按视口夹边。
    const submenuLeft = clampTo(
      left + (width - submenuWidth) / 2,
      EDGE_MARGIN,
      hostWidth - submenuWidth - EDGE_MARGIN,
    );
    const submenuTop = clampTo(
      top - SUBMENU_GAP - submenuHeight,
      EDGE_MARGIN,
      hostHeight - submenuHeight - EDGE_MARGIN,
    );
    setSubmenuOffset({ left: submenuLeft - left, top: submenuTop - top });
  }, [x, selTop, selBottom, mode]);

  // 行 2 展开/收起、写想法切换等已知的高度变化在这里重测；行 2 的预留
  // 高度不随它是否展开变化，所以这几次重测不会挪动主菜单。
  useLayoutEffect(() => {
    measure();
  }, [measure, existing]);

  // 尺寸的其余变化（字体加载完成、窄宿主内折行等）由 ResizeObserver 兜底，
  // 但只观察主菜单卡片：二级菜单尺寸变化不参与主菜单定位。
  const measureRef = useRef(measure);
  useEffect(() => {
    measureRef.current = measure;
  });
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(menu);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="absolute z-20"
      style={menuFit ? { left: menuFit.left, top: menuFit.top } : { left: x, top: y }}
      onClick={(event) => {
        // 别让菜单内的点击冒泡到正文的边缘翻页捕获层。
        event.stopPropagation();
      }}
    >
      {showSubmenu ? (
        <div
          ref={submenuRef}
          data-testid="selection-menu-submenu"
          role="group"
          aria-label="划线样式与颜色"
          className={cn(
            "bg-popover border-border absolute z-10 flex items-center gap-2 rounded-lg border px-2.5 py-2 shadow-md",
            // 量不到尺寸的环境（单测）退回相对主菜单的锚定定位。
            !submenuOffset && "left-1/2 -translate-x-1/2",
          )}
          style={
            submenuOffset
              ? { left: submenuOffset.left, top: submenuOffset.top }
              : { bottom: `calc(100% + ${SUBMENU_GAP}px)` }
          }
        >
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
      ) : null}

      <div
        ref={menuRef}
        data-testid="selection-menu-main"
        className={cn(
          "bg-popover border-border rounded-lg border shadow-md",
          !menuFit && "-translate-x-1/2",
          !menuFit && placement === "above" && "-translate-y-full",
          mode === "note" && "w-72",
        )}
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
                // 点划线后同一按钮变「删除划线」，标签变宽会把整条菜单挤偏。
                // 用更宽的那个标签撑住宽度，主菜单横向坐标才不随状态变。
                reserveLabel="删除划线"
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
  reserveLabel,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  /** 用这段（不可见的）文字撑住按钮宽度，切换标签时菜单整体不位移。 */
  reserveLabel?: string;
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
      {reserveLabel ? (
        <span className="grid">
          <span className="invisible col-start-1 row-start-1" aria-hidden="true">
            {reserveLabel}
          </span>
          <span className="col-start-1 row-start-1">{label}</span>
        </span>
      ) : (
        label
      )}
    </button>
  );
}