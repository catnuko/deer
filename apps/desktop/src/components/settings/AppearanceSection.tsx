import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReadingSettings } from "@/store/readingSettings";
import type { ReadingTheme } from "@/lib/theme";

const THEME_OPTIONS: Array<{
  value: ReadingTheme;
  label: string;
  description: string;
  icon: typeof Monitor;
}> = [
  {
    value: "system",
    label: "跟随系统",
    description: "随系统浅色 / 深色自动切换",
    icon: Monitor,
  },
  { value: "light", label: "浅色", description: "始终使用浅色界面", icon: Sun },
  { value: "dark", label: "深色", description: "始终使用深色界面", icon: Moon },
];

export function AppearanceSection() {
  const theme = useReadingSettings((state) => state.theme);
  const setTheme = useReadingSettings((state) => state.setTheme);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">主题</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          立即作用于整个应用（侧栏、书架、阅读页）。
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="主题"
        className="grid max-w-xl grid-cols-3 gap-2"
      >
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(option.value)}
              className={cn(
                "border-border bg-background flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors duration-fast ease-enter",
                "hover:bg-muted/60",
                active && "border-primary bg-primary/5 ring-primary/30 ring-1",
              )}
            >
              <Icon
                className={cn(
                  "size-4",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-muted-foreground text-xs leading-relaxed">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}