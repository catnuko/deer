import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "@/components/settings/SettingRow";
import { useReadingSettings } from "@/store/readingSettings";
import {
  resolveTheme,
  systemPrefersDark,
  type ReadingTheme,
} from "@/lib/theme";

const THEME_LABELS: Record<"light" | "dark", string> = {
  light: "浅色",
  dark: "深色",
};

export function AppearanceSection() {
  const theme = useReadingSettings((state) => state.theme);
  const setTheme = useReadingSettings((state) => state.setTheme);

  const followSystem = theme === "system";
  // 跟随系统时显示实际生效的明暗，关掉开关就从当前观感继续。
  const currentTheme = resolveTheme(theme, systemPrefersDark());

  return (
    <div className="max-w-xl">
      <SettingRow
        title="跟随系统外观"
        description="开启后随系统浅色 / 深色设置自动切换，关闭则手动选择。"
      >
        <Switch
          checked={followSystem}
          onCheckedChange={(checked) =>
            setTheme(checked ? "system" : currentTheme)
          }
          aria-label="跟随系统外观"
        />
      </SettingRow>

      <Separator />

      <SettingRow title="主题" description="关闭「跟随系统」后可手动指定。">
        <Select
          items={THEME_LABELS}
          value={currentTheme}
          disabled={followSystem}
          onValueChange={(value) => setTheme(value as ReadingTheme)}
        >
          <SelectTrigger className="w-32" aria-label="主题">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">{THEME_LABELS.light}</SelectItem>
            <SelectItem value="dark">{THEME_LABELS.dark}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <p className="text-muted-foreground py-3 text-xs leading-relaxed">
        主题切换立即生效，并会作用于整个应用（侧栏、书架、阅读页）。
      </p>
    </div>
  );
}
