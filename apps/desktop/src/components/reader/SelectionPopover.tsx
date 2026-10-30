import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import type { SelectionPlacement } from "@/lib/ai/selectionDraft";

/**
 * 划选后的浮动「问 Deer」按钮：绝对定位在正文容器内，
 * x/y/placement 由 popoverPlacement 算好传入。
 */
export function SelectionPopover({
  x,
  y,
  placement,
  onAsk,
}: SelectionPlacement & {
  onAsk: () => void;
}) {
  return (
    <div className="absolute z-20" style={{ left: x, top: y }}>
      <Button
        size="sm"
        variant="secondary"
        className={cn(
          "border-border bg-background text-foreground shadow-md",
          "-translate-x-1/2",
          placement === "above" && "-translate-y-full",
        )}
        aria-label="问 Deer"
        onClick={(event) => {
          // 别让点击冒泡到正文的边缘翻页捕获层。
          event.stopPropagation();
          onAsk();
        }}
      >
        <Sparkles className="size-3.5" />
        问 Deer
      </Button>
    </div>
  );
}
