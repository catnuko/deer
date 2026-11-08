import { Brain } from "lucide-react";
import { CloudEngineCard } from "@/components/settings/CloudEngineCard";
import { Separator } from "@/components/ui/separator";

export function AiSection() {
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <p className="text-sm font-medium">AI 云引擎</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          AI 伴读走云 API 模型，桌面与手机端都可用；书籍、对话与 Key 都留在本机。
        </p>
      </div>

      <CloudEngineCard />

      <Separator />

      <div className="flex items-start gap-3">
        <Brain className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-medium">深度思考</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            模型返回思考过程时，回复里会先显示可折叠的「深度思考」块；
            是否返回由所选模型决定，不提供开关。
          </p>
        </div>
      </div>
    </div>
  );
}
