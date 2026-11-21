import {
  ArrowLeft,
  BookOpen,
  Compass,
  Ellipsis,
  List,
  Map,
  Settings,
  Sparkles,
  StickyNote,
  Type,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";

type ReaderToolbarProps = {
  bookTitle: string;
  author: string;
  /** 目录开关当前态（宽窗 dock / 窄窗 Sheet 共用），按钮据此显示激活态。 */
  tocOpen: boolean;
  /** 无目录的书（图片书等）：目录按钮置灰。 */
  tocDisabled?: boolean;
  onToggleToc: () => void;
  notesOpen?: boolean;
  onToggleNotes?: () => void;
  quickSettingsOpen?: boolean;
  onToggleQuickSettings?: () => void;
  conceptMapOpen?: boolean;
  onToggleConceptMap?: () => void;
  briefingOpen?: boolean;
  onToggleBriefing?: () => void;
  /** 提供时显示「AI 伴读」入口：只打开面板，不发送任何消息。 */
  onOpenPanel?: () => void;
  panelOpen?: boolean;
};

const activeCls = "bg-accent text-accent-foreground";

/** 顶栏统一的图标按钮：tooltip 常驻 + aria-label，开关类带 aria-pressed 激活态。 */
function ToolbarButton({
  label,
  icon,
  pressed,
  disabled,
  id,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  /** 提供时是开关按钮：aria-pressed + 激活态。 */
  pressed?: boolean;
  disabled?: boolean;
  id?: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            id={id}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={cn(pressed && activeCls)}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ReaderToolbar({
  bookTitle,
  author,
  tocOpen,
  tocDisabled = false,
  onToggleToc,
  notesOpen,
  onToggleNotes,
  quickSettingsOpen,
  onToggleQuickSettings,
  conceptMapOpen,
  onToggleConceptMap,
  briefingOpen,
  onToggleBriefing,
  onOpenPanel,
  panelOpen,
}: ReaderToolbarProps) {
  const navigate = useNavigate();
  const openSettings = useSettingsDialogStore((state) => state.openDialog);
  // 窄窗（<md）概念地图收进「更多」，AI 伴读保持直按（规范 1.6）。
  const isWide = useMediaQuery("(min-width: 768px)");

  const moreEntries = [
    ...(onToggleBriefing
      ? [{ label: "开读简报", icon: <Compass />, onClick: onToggleBriefing }]
      : []),
    ...(onToggleConceptMap
      ? [{ label: "概念地图", icon: <Map />, onClick: onToggleConceptMap }]
      : []),
  ];

  // 「更多」区按钮的测试/焦点锚点 id（焦点归还用）。
  const moreEntryIds: Record<string, string> = {
    开读简报: "reader-toolbar-briefing",
    概念地图: "reader-toolbar-concept-map",
  };

  return (
    <TooltipProvider>
      <header className="border-border bg-background/95 flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex items-center gap-1">
          <ToolbarButton
            label="返回书架"
            icon={<ArrowLeft className="size-4" />}
            onClick={() => navigate("/bookshelf")}
          />
        </div>

        <div className="bg-border h-5 w-px" />

        {/* 书名弹性区封顶顶栏一半：长书名到上限即省略号，右侧按钮永不被挤走。 */}
        <div className="flex min-w-0 max-w-[50%] flex-1 items-center gap-2">
          <BookOpen className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 truncate text-sm font-medium">{bookTitle}</span>
          <span className="text-muted-foreground hidden min-w-0 truncate text-xs sm:inline">
            {author}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ToolbarButton
            id="reader-toolbar-toc"
            label="目录"
            icon={<List className="size-4" />}
            pressed={tocOpen}
            disabled={tocDisabled}
            onClick={onToggleToc}
          />
          {onToggleNotes ? (
            <ToolbarButton
              id="reader-toolbar-notes"
              label="笔记与高亮"
              icon={<StickyNote className="size-4" />}
              pressed={notesOpen}
              onClick={onToggleNotes}
            />
          ) : null}
          {onToggleQuickSettings ? (
            <ToolbarButton
              id="reader-toolbar-display"
              label="显示设置"
              icon={<Type className="size-4" />}
              pressed={quickSettingsOpen}
              onClick={onToggleQuickSettings}
            />
          ) : null}

          {onOpenPanel ? (
            <>
              <div className="bg-border mx-1 h-5 w-px" />
              <ToolbarButton
                label="AI 伴读"
                icon={<Sparkles className="size-4" />}
                pressed={panelOpen}
                onClick={onOpenPanel}
              />
            </>
          ) : null}

          {moreEntries.length > 0 ? (
            <>
              <div className="bg-border mx-1 h-5 w-px" />
              {isWide ? (
                <div className="flex items-center gap-1">
                  {moreEntries.map((entry) => (
                    <ToolbarButton
                      key={entry.label}
                      id={moreEntryIds[entry.label]}
                      label={entry.label}
                      icon={entry.icon}
                      pressed={
                        entry.label === "概念地图"
                          ? conceptMapOpen
                          : entry.label === "开读简报"
                            ? briefingOpen
                            : undefined
                      }
                      onClick={entry.onClick}
                    />
                  ))}
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="更多 AI 动作"
                      />
                    }
                  >
                    <Ellipsis className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {moreEntries.map((entry) => (
                      <DropdownMenuItem
                        key={entry.label}
                        onClick={entry.onClick}
                      >
                        {entry.icon}
                        {entry.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          ) : null}

          <div className="bg-border mx-1 h-5 w-px" />
          <ToolbarButton
            label="设置"
            icon={<Settings className="size-4" />}
            onClick={openSettings}
          />
        </div>
      </header>
    </TooltipProvider>
  );
}
