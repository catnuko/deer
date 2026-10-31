import {
  ArrowLeft,
  BookOpen,
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
  /** 提供时显示「总结本章」入口（章节总结 N3）。 */
  onSummarizeChapter?: () => void;
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
  onSummarizeChapter,
}: ReaderToolbarProps) {
  const navigate = useNavigate();
  // 窄窗（<md）AI 组收进「更多」，避免顶栏溢出（规范 1.6）。
  const isWide = useMediaQuery("(min-width: 768px)");

  const aiEntries = [
    ...(onSummarizeChapter
      ? [{ label: "总结本章", icon: <Sparkles />, onClick: onSummarizeChapter }]
      : []),
    ...(onToggleConceptMap
      ? [
          {
            label: "概念地图",
            icon: <Map />,
            onClick: onToggleConceptMap,
          },
        ]
      : []),
  ];

  return (
    <TooltipProvider>
      <header className="border-border bg-background/95 flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex items-center gap-1">
          <ToolbarButton
            label="返回书架"
            icon={<ArrowLeft className="size-4" />}
            onClick={() => navigate("/bookshelf")}
          />
          <ToolbarButton
            id="reader-toolbar-toc"
            label="目录"
            icon={<List className="size-4" />}
            pressed={tocOpen}
            disabled={tocDisabled}
            onClick={onToggleToc}
          />
        </div>

        <div className="bg-border h-5 w-px" />

        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{bookTitle}</span>
          <span className="text-muted-foreground hidden truncate text-xs sm:inline">
            {author}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
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

          {aiEntries.length > 0 ? (
            <>
              <div className="bg-border mx-1 h-5 w-px" />
              {isWide ? (
                <div className="flex items-center gap-1">
                  {aiEntries.map((entry) => (
                    <ToolbarButton
                      key={entry.label}
                      id={
                        entry.label === "概念地图"
                          ? "reader-toolbar-concept-map"
                          : undefined
                      }
                      label={entry.label}
                      icon={entry.icon}
                      pressed={
                        entry.label === "概念地图" ? conceptMapOpen : undefined
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
                    {aiEntries.map((entry) => (
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
            onClick={() => navigate("/settings")}
          />
        </div>
      </header>
    </TooltipProvider>
  );
}
