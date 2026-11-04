import { useEffect, useRef, useState } from "react";
import {
  placeNoteCard,
  type AnchorRect,
  type NoteType,
} from "@/lib/bookNotes";
import { cn } from "@/lib/utils";

/** 卡片意图宽度；整体同时被容器宽度约束。 */
const NOTE_CARD_WIDTH = 340;
/** 未测量前的高度估计，只用于首帧定位。 */
const NOTE_CARD_EST_HEIGHT = 96;
/** 容器尺寸未量出前定位用的回落值（首帧隐形，不影响观感）。 */
const FALLBACK_BOUNDS = { width: 800, height: 600 };

const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  footnote: "脚注",
  endnote: "注释",
  note: "注释",
  biblioentry: "参考",
  definition: "释义",
};

/**
 * 悬浮注释卡片（脚注/尾注预览）。
 *
 * 挂在正文容器里绝对定位，锚点是引用在容器坐标系里的矩形；容器尺寸经
 * containerRef 在挂载 effect 里量（渲染期不读 ref），卡片自身高度绘制后
 * 测量一次再重放，长尾注在底部放不下时翻到引用上方。卡片可滚动（长
 * 注释在卡内滚），因此接受指针：进入卡片由父级取消延迟收卡，离开即收
 * ——与 luxlore 的 pointer-events:none 不同，那是刻意的差异。
 */
export function NotePeekCard({
  anchor,
  text,
  type,
  containerRef,
  onPointerEnter,
  onPointerLeave,
}: {
  anchor: AnchorRect;
  text: string;
  type: NoteType | null;
  containerRef: React.RefObject<HTMLElement | null>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{
    width: number;
    height: number;
    cardHeight: number;
  } | null>(null);

  useEffect(() => {
    const card = cardRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!card || !box) return;
    const cardRect = card.getBoundingClientRect();
    setMeasured({
      width: box.width,
      height: box.height,
      cardHeight: cardRect.height > 0 ? cardRect.height : NOTE_CARD_EST_HEIGHT,
    });
  }, [containerRef]);

  const bounds = measured ?? FALLBACK_BOUNDS;
  const cardWidth = Math.min(NOTE_CARD_WIDTH, Math.max(160, bounds.width - 20));
  const placed = placeNoteCard({
    anchor,
    width: cardWidth,
    height: measured?.cardHeight ?? NOTE_CARD_EST_HEIGHT,
    viewportWidth: bounds.width,
    viewportHeight: bounds.height,
  });
  // 箭头指向引用而不是卡片中心：卡片在边缘被夹住时两者不同。
  const caretX = Math.max(
    16,
    Math.min(anchor.left + anchor.width / 2 - placed.left, cardWidth - 16),
  );

  return (
    <div
      ref={cardRef}
      role="tooltip"
      data-testid="note-peek-card"
      className={cn(
        "border-border bg-background absolute z-20 rounded-lg border p-3 shadow-md",
        // 朝锚点方向 4px 进入（motion.md M2）；退出即时，不做 presence。
        placed.above ? "deer-pop-in-above" : "deer-pop-in-below",
      )}
      style={{
        left: placed.left,
        top: placed.top,
        width: cardWidth,
        // 容器尺寸量出前先隐形，避免闪现在回落定位上。
        opacity: measured ? 1 : 0,
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // 别让卡片上的点击/滚轮冒泡到正文容器的边缘翻页层。
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="text-muted-foreground mb-1 text-[10.5px] font-semibold tracking-wider uppercase">
        {type ? NOTE_TYPE_LABEL[type] : "注释"}
      </div>
      {/* 长注释是段落不是整页：限高在卡内滚动。 */}
      <div className="text-foreground/90 max-h-[40vh] overflow-y-auto text-[13.5px] leading-relaxed overscroll-contain">
        {text}
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "border-border bg-background absolute size-2 rotate-45 border",
          placed.above
            ? "-bottom-1 border-t-0 border-l-0"
            : "-top-1 border-r-0 border-b-0",
        )}
        style={{ left: caretX - 4 }}
      />
    </div>
  );
}
