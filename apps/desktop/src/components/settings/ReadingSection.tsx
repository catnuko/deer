import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingRow } from "@/components/settings/SettingRow";
import {
  FONT_SIZES,
  LINE_HEIGHTS,
  PAPER_COLORS,
  PAGE_FLOWS,
  isFontSize,
  isLineHeight,
  isPageFlow,
  useReadingSettings,
  type PaperColor,
  type PageFlow,
} from "@/store/readingSettings";

const FONT_SIZE_LABELS = {
  14: "14px · 小",
  15: "15px · 标准",
  17: "17px · 大",
  19: "19px · 特大",
} as const;

const LINE_HEIGHT_LABELS = {
  "1.6": "1.6 · 紧凑",
  "1.8": "1.8 · 标准",
  "2": "2.0 · 宽松",
} as const;

const PAGE_FLOW_LABELS: Record<PageFlow, string> = {
  paginated: "翻页",
  scrolled: "滚动",
};

export function ReadingSection() {
  const fontSize = useReadingSettings((state) => state.fontSize);
  const lineHeight = useReadingSettings((state) => state.lineHeight);
  const paperColor = useReadingSettings((state) => state.paperColor);
  const pageFlow = useReadingSettings((state) => state.pageFlow);
  const setFontSize = useReadingSettings((state) => state.setFontSize);
  const setLineHeight = useReadingSettings((state) => state.setLineHeight);
  const setPaperColor = useReadingSettings((state) => state.setPaperColor);
  const setPageFlow = useReadingSettings((state) => state.setPageFlow);
  const reset = useReadingSettings((state) => state.reset);

  return (
    <div className="max-w-xl">
      <SettingRow title="正文字号" description="影响阅读页正文与预览。">
        <Select
          items={FONT_SIZE_LABELS}
          value={String(fontSize)}
          onValueChange={(value) => {
            const next = Number(value);
            if (isFontSize(next)) setFontSize(next);
          }}
        >
          <SelectTrigger className="w-32" aria-label="正文字号">
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
          <SelectTrigger className="w-32" aria-label="行距">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINE_HEIGHTS.map((height) => (
              <SelectItem key={height} value={String(height)}>
                {LINE_HEIGHT_LABELS[String(height) as keyof typeof LINE_HEIGHT_LABELS]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <SettingRow
        title="阅读背景色"
        description="正文纸色预设，仅在浅色主题下生效；深色主题维持深色背景。"
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
          <SelectTrigger className="w-32" aria-label="翻页方式">
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

      <div className="py-4">
        <p className="text-muted-foreground mb-2 text-xs">预览</p>
        <div
          className="border-border text-card-foreground rounded-[12px] border p-5 font-serif"
          style={{ backgroundColor: paperColor }}
        >
          <p style={{ fontSize: `${fontSize}px`, lineHeight }}>
            河道会变，岸不会。清晨五点，山口的雾还没有散，石阶被露水浸得发暗。
          </p>
        </div>
      </div>

      <Separator />

      <div className="py-3">
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="size-3.5" />
          恢复默认（15px · 1.8）
        </Button>
      </div>
    </div>
  );
}
