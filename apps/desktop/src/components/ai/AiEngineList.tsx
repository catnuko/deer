import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AI_INSTALL_LOG_EVENT,
  aiEngineInstall,
  aiEngineStatus,
  isTauriRuntime,
  type AiInstallLogPayload,
} from "@/lib/ai/claudeBackend";
import {
  COMMON_AI_ENGINES,
  isEngineSelectable,
  OTHER_AI_ENGINES,
  type AiEngineSpec,
} from "@/lib/ai/engines";
import { useAppSettings } from "@/store/appSettings";
import { cn } from "@/lib/utils";

/**
 * AI 伴读引擎列表：常用 7 个固定前排，其余折叠；每行右侧是安装状态
 * （已安装 / 可直接用 / 安装按钮 + 官方提示），点行即选中并持久化。
 * 安装走 Rust 白名单命令，npm 输出经 ai://install-log 逐行流回展示。
 */
export function AiEngineList() {
  const desktop = isTauriRuntime();
  const selectedEngine = useAppSettings((state) => state.aiEngine);
  const setAiEngine = useAppSettings((state) => state.setAiEngine);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(desktop);
  const [expanded, setExpanded] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const unlistenRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    setChecking(true);
    try {
      const statuses = await aiEngineStatus();
      setInstalled(Object.fromEntries(statuses.map((s) => [s.id, s.installed])));
    } catch {
      // 检测失败按未知处理，行内显示占位，不打挂列表
    } finally {
      setChecking(false);
    }
  }, [desktop]);

  useEffect(() => {
    void refresh();
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [refresh]);

  const install = useCallback(
    async (spec: AiEngineSpec) => {
      if (!spec.adapterPackage || installingId) return;
      setInstallingId(spec.id);
      setLogs([]);
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<AiInstallLogPayload>(
        AI_INSTALL_LOG_EVENT,
        (event) => {
          const payload = event.payload;
          if (payload.engineId !== spec.id) return;
          if (payload.done) {
            setInstallingId(null);
            if (payload.success) void refresh();
            return;
          }
          setLogs((prev) => [...prev.slice(-200), payload.line]);
        },
      );
      unlistenRef.current = unlisten;
      try {
        await aiEngineInstall(spec.id);
      } catch (error) {
        setLogs((prev) => [
          ...prev,
          `安装失败：${error instanceof Error ? error.message : String(error)}`,
        ]);
        setInstallingId(null);
      } finally {
        unlisten();
        unlistenRef.current = null;
      }
    },
    [installingId, refresh],
  );

  const renderEngineRow = (spec: AiEngineSpec) => {
    const isInstalled = installed[spec.id];
    const known = isInstalled !== undefined;
    const selectable = known && isEngineSelectable(spec, isInstalled);
    const selected = selectedEngine === spec.id;
    const installing = installingId === spec.id;
    return (
      <button
        key={spec.id}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={!selectable}
        onClick={() => selectable && setAiEngine(spec.id)}
        className={cn(
          "hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
          selected && "bg-muted",
          !selectable && "cursor-not-allowed opacity-60",
        )}
      >
        <Check
          className={cn(
            "size-4 shrink-0",
            selected ? "text-primary" : "text-transparent",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm">{spec.name}</span>
        {!desktop ? (
          <span className="text-muted-foreground shrink-0 text-xs">桌面端可用</span>
        ) : !known ? (
          <span className="text-muted-foreground shrink-0 text-xs">
            {checking ? "检测中…" : "未检测"}
          </span>
        ) : isInstalled ? (
          <Badge variant="secondary" className="shrink-0">
            已安装
          </Badge>
        ) : spec.installMode === "vendor" ? (
          <span
            className="text-muted-foreground max-w-56 shrink-0 truncate text-right text-xs"
            title={spec.installHint}
          >
            {spec.installHint}
          </span>
        ) : (
          <>
            <Badge variant="outline" className="shrink-0">
              可直接用
            </Badge>
            {spec.installMode === "adapter" && (
              <Button
                variant="outline"
                size="sm"
                className="w-auto shrink-0"
                disabled={installingId !== null}
                onClick={(event) => {
                  event.stopPropagation();
                  void install(spec);
                }}
              >
                {installing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {installing ? "安装中…" : "安装"}
              </Button>
            )}
          </>
        )}
      </button>
    );
  };

  return (
    <div
      role="radiogroup"
      aria-label="AI 伴读引擎"
      className="border-border bg-muted/30 space-y-1 rounded-lg border p-3"
    >
      {COMMON_AI_ENGINES.map(renderEngineRow)}
      {!expanded && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground w-full"
          onClick={() => setExpanded(true)}
        >
          <ChevronDown className="size-3.5" />
          显示其余引擎（{OTHER_AI_ENGINES.length}）
        </Button>
      )}
      {expanded && (
        <>
          {OTHER_AI_ENGINES.map(renderEngineRow)}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-full"
            onClick={() => setExpanded(false)}
          >
            <ChevronUp className="size-3.5" />
            收起其余引擎
          </Button>
        </>
      )}
      {(installingId || logs.length > 0) && (
        <div className="bg-background mt-2 max-h-40 overflow-y-auto rounded-md border p-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
          {logs.length === 0 ? "准备安装…" : logs.join("\n")}
        </div>
      )}
    </div>
  );
}
