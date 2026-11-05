import { Brain } from "lucide-react";
import { AcpxStatusCard } from "@/components/ai/AcpxStatusCard";
import { AiEngineList } from "@/components/ai/AiEngineList";
import { Separator } from "@/components/ui/separator";

export function AiSection() {
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <p className="text-sm font-medium">AI 伴读引擎</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          经本机 acpx 连接各编码引擎 CLI，选中哪个用哪个，书籍与对话都留在本机。
        </p>
      </div>

      <AcpxStatusCard />

      <AiEngineList />

      <Separator />

      <div className="flex items-start gap-3">
        <Brain className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-medium">深度思考</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            始终开启：Claude Code 每轮注入 10000 token 的思考预算，先推理再回答；
            其他引擎按各自 CLI 的深度思考能力决定。不提供关闭开关。
          </p>
        </div>
      </div>
    </div>
  );
}