import { useState } from "react";
import { Check, Copy } from "lucide-react";
import packageJson from "../../../package.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { copyPlainText } from "@/lib/clipboard";
import { buildDiagnostics } from "@/lib/diagnostics";
import { isTauri } from "@/lib/platform";
import { useDataDir } from "@/lib/useDataDir";

const STACK = [
  ["运行外壳", "Tauri v2"],
  ["界面", "React 19 + TypeScript + Vite"],
  ["样式", "Tailwind CSS v4"],
  ["组件库", "assistant-ui（AI 聊天）· cult-ui（界面）"],
  ["基础件", "shadcn/ui"],
] as const;

const LICENSES = [
  ["React", "MIT"],
  ["Tauri", "MIT / Apache-2.0"],
  ["Vite", "MIT"],
  ["Tailwind CSS", "MIT"],
  ["foliate-js", "MIT"],
  ["zustand", "MIT"],
  ["lucide-react", "ISC"],
  ["assistant-ui", "MIT"],
  ["shadcn/ui", "MIT"],
] as const;

async function resolveVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      // 桌面接口不可用时退回构建时版本。
    }
  }
  return packageJson.version ?? "unknown";
}

export function AboutSection() {
  const desktop = isTauri();
  const dataDir = useDataDir();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function copyDiagnostics() {
    const text = buildDiagnostics({
      appVersion: await resolveVersion(),
      runtime: desktop ? "Tauri 桌面端" : "浏览器预览",
      userAgent: navigator.userAgent,
      dataDir,
      copiedAt: new Date(),
    });
    const ok = await copyPlainText(text);
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold tracking-tight">Deer</span>
        <Badge variant="secondary">{packageJson.version}</Badge>
        <Badge variant="outline">本地运行</Badge>
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        一个本地运行的电子书阅读器。当前为夜间构建版本，阅读与书架功能正在逐步接入。
      </p>

      <Separator />

      <dl className="space-y-2 text-sm">
        {STACK.map(([label, value]) => (
          <div key={label} className="flex gap-4">
            <dt className="text-muted-foreground w-24 shrink-0 text-xs leading-5">
              {label}
            </dt>
            <dd className="min-w-0 text-xs leading-5">{value}</dd>
          </div>
        ))}
      </dl>

      <Separator />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">诊断信息</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            复制版本、运行环境、数据目录，方便反馈问题。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void copyDiagnostics()}
        >
          {copyState === "copied" ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copyState === "copied"
            ? "已复制"
            : copyState === "failed"
              ? "复制失败"
              : "复制诊断信息"}
        </Button>
      </div>

      <Separator />

      <div>
        <p className="mb-2 text-sm font-medium">开源许可</p>
        <ul className="text-muted-foreground grid grid-cols-1 gap-x-6 gap-y-1 text-xs leading-relaxed sm:grid-cols-2">
          {LICENSES.map(([name, license]) => (
            <li key={name} className="flex items-baseline justify-between gap-3">
              <span className="text-foreground">{name}</span>
              <span className="font-mono text-[11px]">{license}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          字体未打包，阅读时使用系统字体。
        </p>
      </div>
    </div>
  );
}