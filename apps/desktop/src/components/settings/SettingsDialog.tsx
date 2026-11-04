import { useRef, useState } from "react";
import {
  BookOpenText,
  Database,
  Info,
  Keyboard,
  Palette,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";
import { AboutSection } from "./AboutSection";
import { AiSection } from "./AiSection";
import { AppearanceSection } from "./AppearanceSection";
import { DataSection } from "./DataSection";
import { GeneralSection } from "./GeneralSection";
import { ReadingSection } from "./ReadingSection";
import { ShortcutsSection } from "./ShortcutsSection";

type SettingsSection =
  | "general"
  | "appearance"
  | "reading"
  | "ai"
  | "data"
  | "shortcuts"
  | "about";

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "reading", label: "阅读", icon: BookOpenText },
  { id: "ai", label: "AI 伴读", icon: Sparkles },
  { id: "data", label: "数据", icon: Database },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "about", label: "关于", icon: Info },
];

const NARROW_MEDIA_QUERY = "(min-width: 820px)";
/** 视口不够放 900×640 时退回 94vw×86vh，避免小窗溢出。 */
const ROOMY_MEDIA_QUERY = "(min-width: 960px)";

/**
 * 设置弹窗：固定尺寸左右布局，当前分组只影响右栏内容。
 * 外框、标题与尺寸在切换分组时完全不变；窄窗（<820px）退化为顶部分段 + 单栏。
 */
export function SettingsDialog() {
  const open = useSettingsDialogStore((state) => state.open);
  const setOpen = useSettingsDialogStore((state) => state.setOpen);
  const [section, setSection] = useState<SettingsSection>("general");
  const [animateSection, setAnimateSection] = useState(false);
  const sectionScrollRef = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery(NARROW_MEDIA_QUERY);
  const roomy = useMediaQuery(ROOMY_MEDIA_QUERY);

  // 弹窗每次重新打开时回到首屏状态：只播弹窗自入场，右栏内容不重复播（motion.md M8）。
  // 关闭时在渲染期校正，避免在 effect 里同步 setState 触发级联渲染。
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (!open) setAnimateSection(false);
  }

  const selectSection = (next: SettingsSection) => {
    if (next === section) return;
    // 切组滚动位置立即归零，不做平滑滚动。
    sectionScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setAnimateSection(true);
    setSection(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={cn(
          "flex h-[86vh] w-[94vw] max-w-[94vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]",
          roomy && "h-[640px] w-[900px] max-w-[900px]",
        )}
      >
        <DialogHeader className="border-border shrink-0 border-b px-6 py-4 pr-14">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            外观、阅读偏好与本地数据，全部保存在本机。
          </DialogDescription>
        </DialogHeader>

        <div className={cn("flex min-h-0 flex-1", !wide && "flex-col")}>
          <nav
            aria-label="设置分组"
            className={cn(
              "shrink-0",
              wide
                ? "border-border w-52 overflow-y-auto border-r p-3"
                : "border-border flex gap-1 overflow-x-auto border-b px-3 py-2",
            )}
          >
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => selectSection(item.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md text-sm transition-colors duration-fast ease-enter",
                    wide
                      ? "mb-0.5 w-full px-3 py-2 text-left"
                      : "shrink-0 px-3 py-1.5",
                    active
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div
            ref={sectionScrollRef}
            className="min-h-0 flex-1 overflow-y-auto p-6"
          >
            <div
              key={section}
              className={cn(
                "border-border bg-card text-card-foreground rounded-xl border p-4",
                animateSection && "deer-section-in",
              )}
            >
              {section === "general" ? <GeneralSection /> : null}
              {section === "appearance" ? <AppearanceSection /> : null}
              {section === "reading" ? <ReadingSection /> : null}
              {section === "ai" ? <AiSection /> : null}
              {section === "data" ? <DataSection /> : null}
              {section === "shortcuts" ? <ShortcutsSection /> : null}
              {section === "about" ? <AboutSection /> : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}