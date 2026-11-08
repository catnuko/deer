import { Brain } from "lucide-react";
import { AcpxStatusCard } from "@/components/ai/AcpxStatusCard";
import { AiEngineList } from "@/components/ai/AiEngineList";
import { CloudEngineCard } from "@/components/settings/CloudEngineCard";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isTauri } from "@/lib/platform";
import {
  AI_ENGINE_MODES,
  useAppSettings,
  type AiEngineMode,
} from "@/store/appSettings";

const ENGINE_MODE_LABELS: Record<AiEngineMode, string> = {
  auto: "自动（推荐）",
  local: "仅本地引擎",
  cloud: "仅云引擎",
};

const ENGINE_MODE_HINTS: Record<AiEngineMode, string> = {
  auto: "本机有可用的本地引擎（acpx + CLI）就走本地，没有时自动改走云引擎；手机端没有本地引擎，天然走云。",
  local: "始终走本机 acpx 连接的编码引擎 CLI。本机环境不可用时会报错提示，不静默回落。",
  cloud: "始终走云 API 模型，桌面与手机端都可用，需要在下方配置 API Key。",
};

export function AiSection() {
  const desktop = isTauri();
  const aiEngineMode = useAppSettings((s) => s.aiEngineMode);
  const setAiEngineMode = useAppSettings((s) => s.setAiEngineMode);
  const showLocalEngine = desktop && aiEngineMode !== "cloud";

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <p className="text-sm font-medium">AI 引擎</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          {ENGINE_MODE_HINTS[aiEngineMode]}
        </p>
      </div>

      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">引擎选择</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            本地引擎经 acpx 连接各编码 CLI，深度思考常开；云引擎走下方配置的 API。
          </p>
        </div>
        <Select
          value={aiEngineMode}
          onValueChange={(value) => setAiEngineMode(value as AiEngineMode)}
        >
          <SelectTrigger className="w-44" aria-label="AI 引擎选择">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_ENGINE_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {ENGINE_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showLocalEngine ? (
        <>
          <AcpxStatusCard />
          <AiEngineList />
        </>
      ) : null}

      <Separator />

      <div>
        <p className="text-sm font-medium">云引擎</p>
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
            本地引擎每轮注入 10000 token 的思考预算，先推理再回答；云引擎在模型返回
            思考过程时，回复里会先显示可折叠的「深度思考」块。不提供开关。
          </p>
        </div>
      </div>
    </div>
  );
}
