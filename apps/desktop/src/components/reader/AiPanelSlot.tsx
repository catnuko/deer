import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 右侧 AI 伴读面板的预留位。
 * 泳道 C 负责实现（assistant-ui 聊天 + 按书隔离会话）；本泳道只留位置，不做对话。
 */
export function AiPanelSlot({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "border-border bg-card flex w-80 shrink-0 flex-col border-l",
        className,
      )}
    >
      <div className="border-border flex h-10 items-center gap-2 border-b px-4">
        <Sparkles className="text-brand size-3.5" />
        <span className="text-xs font-medium">AI 伴读</span>
        <Badge variant="outline" className="ml-auto">
          预留
        </Badge>
      </div>
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs leading-relaxed">
        <p>此区域预留给 AI 伴读面板。</p>
        <p>对话功能由后续泳道接入，当前版本不提供。</p>
      </div>
    </aside>
  );
}
