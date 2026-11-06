import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { isTauriRuntime } from "@/lib/ai/claudeBackend";
import { useAcpxEnvStatus } from "@/lib/ai/useAcpxEnvStatus";
import { cn } from "@/lib/utils";

/** 一行「标签 + 值」：设置页与聊天页共用同一套信息口径。 */
function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="text-muted-foreground w-20 shrink-0 text-xs">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs">{value}</span>
    </div>
  );
}

/** acpx 连接层状态卡：版本、是否就绪、重新检测与安装指引。 */
export function AcpxStatusCard() {
  const desktop = isTauriRuntime();
  const { status, checking, refresh } = useAcpxEnvStatus(desktop);

  if (!desktop) {
    return (
      <div className="border-border bg-muted/40 rounded-lg border p-4 text-xs leading-relaxed">
        浏览器预览没有桌面后端，无法检测本机的 Node 与 acpx。请在 Deer
        桌面应用内查看。
      </div>
    );
  }

  const ok = status?.ok === true;

  return (
    <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        {status ? (
          ok ? (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="text-destructive size-4" />
          )
        ) : (
          <RefreshCw className="text-muted-foreground size-4 animate-spin" />
        )}
        <span className="text-sm font-medium">acpx 连接层</span>
        <Badge
          variant={status ? (ok ? "secondary" : "destructive") : "outline"}
          className={cn("ml-auto shrink-0")}
        >
          {status ? (ok ? "就绪" : "未就绪") : "检测中"}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="w-auto shrink-0"
          disabled={checking}
          onClick={() => void refresh()}
        >
          <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
          {checking ? "检测中…" : "重新检测"}
        </Button>
      </div>

      <div className="space-y-1.5">
        <StatusRow label="Node" value={status?.nodeVersion ?? "未检测到"} />
        <StatusRow label="acpx" value={status?.acpxVersion ?? "未检测到"} />
      </div>

      {status && !ok ? (
        <>
          <Separator />
          <p className="text-destructive text-xs leading-relaxed">
            {status.message}
          </p>
          <div className="text-muted-foreground space-y-1 text-xs leading-relaxed">
            <p>安装指引：</p>
            <p className="font-mono">1. Node ≥ 22.13（nvm install 22 / brew install node）</p>
            <p className="font-mono">2. npm install -g acpx@0.21.1</p>
            <p>装好后回到这里点「重新检测」。</p>
          </div>
        </>
      ) : null}
    </div>
  );
}