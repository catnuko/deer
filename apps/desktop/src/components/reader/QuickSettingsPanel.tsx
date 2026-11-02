import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FONT_SIZES,
  PAGE_FLOWS,
  PAPER_COLORS,
  type FontSize,
  type PageFlow,
  type PaperColor,
} from "@/store/readingSettings";

const PAGE_FLOW_LABELS: Record<PageFlow, string> = {
  paginated: "翻页",
  scrolled: "滚动",
};

type QuickSettingsPanelProps = {
  fontSize: FontSize;
  paperColor: PaperColor;
  pageFlow: PageFlow;
  /** 深色主题下纸色预设不生效，色块禁用并提示。 */
  paperColorDisabled?: boolean;
  onFontSizeChange: (fontSize: FontSize) => void;
  onPaperColorChange: (paperColor: PaperColor) => void;
  onPageFlowChange: (pageFlow: PageFlow) => void;
  onClose: () => void;
};

/**
 * 阅读页内的快捷显示设置：字号 / 背景色 / 翻页方式，改完即时生效。
 * 绝对定位由父级容器决定；点击冒泡到正文的边缘翻页捕获层，
 * 与 SelectionPopover 一样在根上拦截。
 */
export function QuickSettingsPanel({
  fontSize,
  paperColor,
  pageFlow,
  paperColorDisabled = false,
  onFontSizeChange,
  onPaperColorChange,
  onPageFlowChange,
  onClose,
}: QuickSettingsPanelProps) {
  // Esc 关闭（布局重排 P8）：与其他阅读页浮层行为对齐。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="group"
      aria-label="阅读显示设置"
      className="border-border bg-background absolute top-4 right-4 z-20 w-60 rounded-lg border p-3 shadow-md"
      onClick={(event) => {
        // 别让点击冒泡到正文的边缘翻页捕获层。
        event.stopPropagation();
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">显示设置</span>
        <button
          type="button"
          aria-label="关闭显示设置"
          className="text-muted-foreground hover:text-foreground rounded p-0.5"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <section aria-label="字号" className="mb-3">
        <p className="text-muted-foreground mb-1.5 text-xs">字号</p>
        <div className="grid grid-cols-3 gap-1.5">
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={size === fontSize}
              className={cn(
                "border-border text-foreground h-8 rounded-md border text-xs",
                size === fontSize && "bg-primary text-primary-foreground border-primary",
              )}
              onClick={() => onFontSizeChange(size)}
            >
              {size}
            </button>
          ))}
        </div>
      </section>

      <section aria-label="阅读背景色" className="mb-3">
        <p className="text-muted-foreground mb-1.5 text-xs">
          背景色{paperColorDisabled ? "（深色主题下不生效）" : ""}
        </p>
        <div className="flex gap-2">
          {(Object.entries(PAPER_COLORS) as [PaperColor, string][]).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                aria-label={`背景色：${label}`}
                aria-pressed={value === paperColor}
                disabled={paperColorDisabled}
                className={cn(
                  "size-7 rounded-full border border-black/10 transition-transform hover:scale-110",
                  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100",
                  value === paperColor && "ring-primary ring-offset-background ring-2 ring-offset-1",
                )}
                style={{ backgroundColor: value }}
                onClick={() => onPaperColorChange(value)}
              />
            ),
          )}
        </div>
      </section>

      <section aria-label="翻页方式">
        <p className="text-muted-foreground mb-1.5 text-xs">翻页方式</p>
        <div className="flex gap-1.5">
          {PAGE_FLOWS.map((flow) => (
            <button
              key={flow}
              type="button"
              aria-pressed={flow === pageFlow}
              className={cn(
                "border-border text-foreground h-8 flex-1 rounded-md border text-xs",
                flow === pageFlow && "bg-primary text-primary-foreground border-primary",
              )}
              onClick={() => onPageFlowChange(flow)}
            >
              {PAGE_FLOW_LABELS[flow]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
