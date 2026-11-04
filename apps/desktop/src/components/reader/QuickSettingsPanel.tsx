import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReaderOverlay } from "@/components/reader/ReaderOverlay";
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
  /** 开合由父级持有，壳负责进出动画与 Esc / 点外关闭。 */
  open?: boolean;
  /** navigation 关闭（翻页、跳章）时立即摘除，不播 150ms 退场。 */
  immediate?: boolean;
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
  open = true,
  immediate = false,
  fontSize,
  paperColor,
  pageFlow,
  paperColorDisabled = false,
  onFontSizeChange,
  onPaperColorChange,
  onPageFlowChange,
  onClose,
}: QuickSettingsPanelProps) {
  return (
    <ReaderOverlay
      open={open}
      immediate={immediate}
      exit="panel"
      variant="drop"
      ariaLabel="阅读显示设置"
      className="border-border bg-background top-4 right-4 w-60 rounded-lg border p-3 shadow-md"
      closeOnOutside
      onClose={onClose}
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
                "border-border text-foreground h-8 rounded-md border text-xs transition-colors duration-fast ease-enter",
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
                  "size-7 rounded-full border border-black/10 transition-shadow duration-exit ease-exit",
                  "disabled:cursor-not-allowed disabled:opacity-40",
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
    </ReaderOverlay>
  );
}
