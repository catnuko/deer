import { useState } from "react";
import { Check, Eye, EyeOff, LoaderCircle, X } from "lucide-react";
import { useAppSettings } from "@/store/appSettings";
import {
  AI_PROVIDER_KINDS,
  testCloudConnection,
  type AiProviderKind,
} from "@/lib/ai/cloudProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  "openai-compatible": "OpenAI 兼容接口",
  anthropic: "Anthropic 接口",
};

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

/** 设置页「云引擎」卡：provider/地址/模型/key 配置 + 连接测试。 */
export function CloudEngineCard() {
  const aiProvider = useAppSettings((s) => s.aiProvider);
  const aiBaseUrl = useAppSettings((s) => s.aiBaseUrl);
  const aiModel = useAppSettings((s) => s.aiModel);
  const aiApiKey = useAppSettings((s) => s.aiApiKey);
  const setAiProvider = useAppSettings((s) => s.setAiProvider);
  const setAiBaseUrl = useAppSettings((s) => s.setAiBaseUrl);
  const setAiModel = useAppSettings((s) => s.setAiModel);
  const setAiApiKey = useAppSettings((s) => s.setAiApiKey);

  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  const runTest = async () => {
    setTest({ kind: "testing" });
    const result = await testCloudConnection({
      provider: aiProvider,
      baseUrl: aiBaseUrl,
      model: aiModel,
      apiKey: aiApiKey,
    });
    setTest(
      result.ok
        ? { kind: "ok", message: result.message }
        : { kind: "error", message: result.message },
    );
  };

  return (
    <div className="space-y-3" data-testid="cloud-engine-card">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">接口类型</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            默认智谱 GLM（OpenAI 兼容接口）；换成其他服务填对应地址与模型名。
          </p>
        </div>
        <Select
          value={aiProvider}
          onValueChange={(value) => {
            setAiProvider(value as AiProviderKind);
            // 换接口类型时旧 Base URL 语义已失效（如 OpenAI 兼容地址
            // 被 anthropic 当端点用会 404）；清空交给默认回落逻辑。
            setAiBaseUrl("");
          }}
        >
          <SelectTrigger className="w-44" aria-label="接口类型">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_PROVIDER_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {PROVIDER_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">接口地址</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            OpenAI 兼容端点的完整 Base URL。
          </p>
        </div>
        <Input
          aria-label="接口地址"
          value={aiBaseUrl}
          onChange={(event) => setAiBaseUrl(event.target.value)}
          placeholder="https://open.bigmodel.cn/api/paas/v4"
          className="w-72"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">模型名</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            服务方文档里的模型标识，如 glm-4.6、claude-sonnet-4-5。
          </p>
        </div>
        <Input
          aria-label="模型名"
          value={aiModel}
          onChange={(event) => setAiModel(event.target.value)}
          placeholder="glm-4.6"
          className="w-72"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">API Key</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            仅存本机，不上传、不进代码仓库。
          </p>
        </div>
        <div className="flex w-72 items-center gap-1.5">
          <Input
            aria-label="API Key"
            type={showKey ? "text" : "password"}
            value={aiApiKey}
            onChange={(event) => setAiApiKey(event.target.value)}
            placeholder="粘贴 API Key"
            className="flex-1"
            spellCheck={false}
            autoComplete="off"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={showKey ? "隐藏 Key" : "显示 Key"}
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0" aria-live="polite">
          {test.kind === "idle" ? null : test.kind === "testing" ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <LoaderCircle className="size-3.5 animate-spin" />
              正在测试连接…
            </p>
          ) : test.kind === "ok" ? (
            <p
              data-testid="cloud-test-result"
              className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
            >
              <Check className="size-3.5 shrink-0" />
              {test.message}
            </p>
          ) : (
            <p
              data-testid="cloud-test-result"
              className="text-destructive flex items-center gap-1.5 text-xs"
            >
              <X className="size-3.5 shrink-0" />
              {test.message}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={test.kind === "testing" || !aiApiKey.trim() || !aiModel.trim()}
          onClick={() => void runTest()}
        >
          连接测试
        </Button>
      </div>
    </div>
  );
}
