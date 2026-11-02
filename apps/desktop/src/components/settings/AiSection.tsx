import { Brain } from "lucide-react";
import { AcpxStatusCard } from "@/components/ai/AcpxStatusCard";
import { Separator } from "@/components/ui/separator";

export function AiSection() {
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <p className="text-sm font-medium">AI 伴读引擎</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          使用本机的 acpx 连接 Claude Code CLI，书籍与对话都留在本机。
        </p>
      </div>

      <AcpxStatusCard />

      <Separator />

      <div className="flex items-start gap-3">
        <Brain className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-medium">深度思考</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            始终开启：每轮对话都会注入 10000 token 的思考预算，让模型先推理再回答。
            这是一个固定行为，不提供关闭开关。
          </p>
        </div>
      </div>
    </div>
  );
}