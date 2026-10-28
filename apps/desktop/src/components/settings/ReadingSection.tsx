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
  isFontSize,
  isLineHeight,
  useReadingSettings,
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

export function ReadingSection() {
  const fontSize = useReadingSettings((state) => state.fontSize);
  const lineHeight = useReadingSettings((state) => state.lineHeight);
  const setFontSize = useReadingSettings((state) => state.setFontSize);
  const setLineHeight = useReadingSettings((state) => state.setLineHeight);
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

      <div className="py-4">
        <p className="text-muted-foreground mb-2 text-xs">预览</p>
        <div className="bg-card text-card-foreground border-border rounded-[12px] border p-5 font-serif">
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
