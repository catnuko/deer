import { useRef } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/useReducedMotion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "@/components/settings/SettingRow";
import {
  FONT_FAMILIES,
  FONT_FAMILY_CSS,
  FONT_SIZES,
  LINE_HEIGHTS,
  PAGE_FLOWS,
  PAGE_MARGINS,
  PAGE_MARGIN_PX,
  PAGE_TURN_MODES,
  PAPER_COLORS,
  isFontFamily,
  isFontSize,
  isLineHeight,
  isPageFlow,
  isPageMargin,
  useReadingSettings,
  type FontFamily,
  type FontSize,
  type LineHeight,
  type PageFlow,
  type PageMargin,
  type PageTurnMode,
  type PaperColor,
} from "@/store/readingSettings";

const FONT_SIZE_LABELS: Record<FontSize, string> = {
  12: "12px · 最小",
  14: "14px · 小",
  15: "15px · 标准",
  17: "17px · 大",
  19: "19px · 特大",
  22: "22px · 超大",
};

const LINE_HEIGHT_LABELS: Record<LineHeight, string> = {
  1.4: "1.4 · 最紧",
  1.6: "1.6 · 紧凑",
  1.8: "1.8 · 标准",
  2.0: "2.0 · 宽松",
  2.2: "2.2 · 最松",
};

const FONT_FAMILY_LABELS: Record<FontFamily, string> = {
  book: "跟随书籍排版",
  serif: "衬线",
  sans: "无衬线",
};

const PAGE_MARGIN_LABELS: Record<PageMargin, string> = {
  narrow: "窄",
  medium: "适中",
  wide: "宽",
};

const PAGE_FLOW_LABELS: Record<PageFlow, string> = {
  paginated: "翻页",
  scrolled: "滚动",
};

const PAGE_TURN_LABELS: Record<PageTurnMode, string> = {
  off: "关闭",
  fade: "淡入",
  slide: "滑动",
};

export function ReadingSection() {
  const fontSize = useReadingSettings((state) => state.fontSize);
  const lineHeight = useReadingSettings((state) => state.lineHeight);
  const paperColor = useReadingSettings((state) => state.paperColor);
  const pageFlow = useReadingSettings((state) => state.pageFlow);
  const fontFamily = useReadingSettings((state) => state.fontFamily);
  const pageMargin = useReadingSettings((state) => state.pageMargin);
  const pageTurn = useReadingSettings((state) => state.pageTurn);
  const reducedMotion = useReducedMotion();
  const pageTurnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const footnotePreview = useReadingSettings((state) => state.footnotePreview);
  const setFontSize = useReadingSettings((state) => state.setFontSize);
  const setLineHeight = useReadingSettings((state) => state.setLineHeight);
  const setPaperColor = useReadingSettings((state) => state.setPaperColor);
  const setPageFlow = useReadingSettings((state) => state.setPageFlow);
  const setFontFamily = useReadingSettings((state) => state.setFontFamily);
  const setPageMargin = useReadingSettings((state) => state.setPageMargin);
  const setPageTurn = useReadingSettings((state) => state.setPageTurn);
  const setFootnotePreview = useReadingSettings(
    (state) => state.setFootnotePreview,
  );
  const reset = useReadingSettings((state) => state.reset);

  return (
    <div className="max-w-2xl">
      <SettingRow title="正文字号" description="阅读页正文与预览同步变化。">
        <Select
          items={FONT_SIZE_LABELS}
          value={String(fontSize)}
          onValueChange={(value) => {
            const next = Number(value);
            if (isFontSize(next)) setFontSize(next);
          }}
        >
          <SelectTrigger className="w-36" aria-label="正文字号">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {FONT_SIZE_LABELS[size]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <SettingRow title="行距" description="正文行与行之间的间距倍数。">
        <Select
          items={LINE_HEIGHT_LABELS}
          value={String(lineHeight)}
          onValueChange={(value) => {
            const next = Number(value);
            if (isLineHeight(next)) setLineHeight(next);
          }}
        >
          <SelectTrigger className="w-36" aria-label="行距">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINE_HEIGHTS.map((height) => (
              <SelectItem key={height} value={String(height)}>
                {LINE_HEIGHT_LABELS[height]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <SettingRow
        title="字体"
        description="使用系统字体，不额外下载字体文件；「跟随书籍排版」保留书自带字体。"
      >
        <Select
          items={FONT_FAMILY_LABELS}
          value={fontFamily}
          onValueChange={(value) => {
            if (typeof value === "string" && isFontFamily(value)) {
              setFontFamily(value);
            }
          }}
        >
          <SelectTrigger className="w-40" aria-label="字体">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((value) => (
              <SelectItem key={value} value={value}>
                {FONT_FAMILY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <SettingRow title="页边距" description="正文左右留白，翻页与滚动模式都生效。">
        <Select
          items={PAGE_MARGIN_LABELS}
          value={pageMargin}
          onValueChange={(value) => {
            if (typeof value === "string" && isPageMargin(value)) {
              setPageMargin(value);
            }
          }}
        >
          <SelectTrigger className="w-28" aria-label="页边距">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_MARGINS.map((value) => (
              <SelectItem key={value} value={value}>
                {PAGE_MARGIN_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <SettingRow
        title="阅读背景色"
        description="仅浅色主题下生效；深色主题维持深色背景。"
      >
        <div
          className="flex items-center gap-2"
          role="radiogroup"
          aria-label="阅读背景色"
        >
          {(Object.keys(PAPER_COLORS) as PaperColor[]).map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={paperColor === color}
              aria-label={PAPER_COLORS[color]}
              title={PAPER_COLORS[color]}
              onClick={() => setPaperColor(color)}
              className={`border-border ring-ring size-7 rounded-full border-2 transition-[box-shadow] ${
                paperColor === color ? "ring-2 ring-offset-2" : ""
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </SettingRow>

      <Separator />

      <SettingRow title="翻页方式" description="翻页为仿真书页，滚动为连续滚动。">
        <Select
          items={PAGE_FLOW_LABELS}
          value={pageFlow}
          onValueChange={(value) => {
            if (typeof value === "string" && isPageFlow(value)) setPageFlow(value);
          }}
        >
          <SelectTrigger className="w-28" aria-label="翻页方式">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_FLOWS.map((flow) => (
              <SelectItem key={flow} value={flow}>
                {PAGE_FLOW_LABELS[flow]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <div className="py-3">
        <SettingRow
          title="翻页动效"
          description="滑动最接近纸书手感；淡入更克制。"
          className="py-0"
        >
          <div
            role="radiogroup"
            aria-label="翻页动效"
            aria-disabled={pageFlow === "scrolled"}
            onKeyDown={(event) => {
              if (pageFlow === "scrolled") return;
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
              }
              event.preventDefault();
              const index = PAGE_TURN_MODES.indexOf(pageTurn);
              const step = event.key === "ArrowRight" ? 1 : -1;
              const next =
                PAGE_TURN_MODES[
                  (index + step + PAGE_TURN_MODES.length) %
                    PAGE_TURN_MODES.length
                ];
              setPageTurn(next);
              pageTurnRefs.current[PAGE_TURN_MODES.indexOf(next)]?.focus();
            }}
            className={cn(
              "bg-muted flex h-7 w-40 items-center gap-0.5 rounded-lg p-0.5",
              pageFlow === "scrolled" && "opacity-50",
            )}
          >
            {PAGE_TURN_MODES.map((mode) => {
              const active = pageTurn === mode;
              return (
                <button
                  key={mode}
                  ref={(node) => {
                    pageTurnRefs.current[PAGE_TURN_MODES.indexOf(mode)] = node;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  disabled={pageFlow === "scrolled"}
                  onClick={() => setPageTurn(mode)}
                  className={cn(
                    "h-full flex-1 rounded-md text-xs transition-colors duration-fast ease-enter",
                    active
                      ? "bg-background text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PAGE_TURN_LABELS[mode]}
                </button>
              );
            })}
          </div>
        </SettingRow>
        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
          漫画、PDF 与固定版式书籍不支持翻页动画
        </p>
        {pageFlow === "scrolled" ? (
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            仅翻页模式生效，滚动模式不受影响。
          </p>
        ) : null}
        {reducedMotion ? (
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            系统已开启「减少动态效果」，翻页会直接跳转。
          </p>
        ) : null}
      </div>

      <Separator />

      <SettingRow
        title="脚注悬浮预览"
        description="鼠标停在脚注/尾注引用上时弹出预览卡片，仅 EPUB 生效。"
      >
        <Switch
          checked={footnotePreview}
          onCheckedChange={setFootnotePreview}
          aria-label="脚注悬浮预览"
        />
      </SettingRow>

      <Separator />

      <div className="py-4">
        <p className="text-muted-foreground mb-2 text-xs">预览</p>
        <div
          className="border-border text-card-foreground rounded-[12px] border"
          style={{
            backgroundColor: paperColor,
            paddingLeft: PAGE_MARGIN_PX[pageMargin],
            paddingRight: PAGE_MARGIN_PX[pageMargin],
            paddingTop: 20,
            paddingBottom: 20,
          }}
        >
          <p
            style={{
              fontSize: `${fontSize}px`,
              lineHeight,
              fontFamily: FONT_FAMILY_CSS[fontFamily],
            }}
          >
            河道会变，岸不会。清晨五点，山口的雾还没有散，石阶被露水浸得发暗。
          </p>
        </div>
      </div>

      <Separator />

      <div className="py-3">
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="size-3.5" />
          恢复默认
        </Button>
      </div>
    </div>
  );
}