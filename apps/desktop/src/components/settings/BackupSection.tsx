import { useState } from "react";
import { ArchiveRestore, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SettingRow } from "@/components/settings/SettingRow";
import { isTauri } from "@/lib/platform";
import {
  pickExportDestination,
  pickImportSource,
  runExport,
  runImport,
  type BackupManifest,
  type BackupProgress,
  type ImportReport,
} from "@/lib/backup";

function phaseLabel(progress: BackupProgress | null): string {
  if (!progress) return "准备中…";
  if (progress.phase === "scan") return "正在收集数据…";
  if (progress.phase === "copy") return "正在打包文件…";
  if (progress.phase === "merge") return "正在恢复与合并…";
  return "完成";
}

type BackupResult =
  | { kind: "export"; manifest: BackupManifest }
  | { kind: "import"; report: ImportReport };

/**
 * 备份与恢复组：导出 `.deer-backup` 归档、从归档合并式恢复。
 * 打包与合并在 Rust 侧 command 完成，书籍文件不进 JS 内存。
 */
export function BackupSection() {
  const desktop = isTauri();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);

  async function handleExport() {
    setBusy("export");
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const destPath = await pickExportDestination();
      if (!destPath) return;
      const manifest = await runExport(destPath, setProgress);
      setResult({ kind: "export", manifest });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function handleImport() {
    setBusy("import");
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const srcPath = await pickImportSource();
      if (!srcPath) return;
      const report = await runImport(srcPath, setProgress);
      setResult({ kind: "import", report });
      // 归档带出的设置已写回 localStorage；整页刷新让各 store 从磁盘重读。
      window.setTimeout(() => window.location.reload(), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  return (
    <div className="max-w-xl space-y-2">
      <SettingRow
        title="导出备份"
        description="把书籍、封面、笔记、聊天、概念图与设置打包成单个 .deer-backup 文件。包含 AI API Key 等敏感设置，请妥善保管。"
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!desktop || busy !== null}
          onClick={() => void handleExport()}
        >
          <Download className="size-3.5" />
          导出…
        </Button>
      </SettingRow>

      <Separator />

      <SettingRow
        title="从备份恢复"
        description="合并式恢复：内容相同的书自动跳过，笔记按位置合并，不覆盖现有数据。恢复完成后会自动刷新应用。"
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!desktop || busy !== null}
          onClick={() => void handleImport()}
        >
          <Upload className="size-3.5" />
          导入…
        </Button>
      </SettingRow>

      {busy ? (
        <div
          role="status"
          aria-live="polite"
          className="border-border bg-muted/30 rounded-lg border px-3 py-2"
        >
          <p className="text-xs leading-relaxed">{phaseLabel(progress)}</p>
          {progress && progress.total > 0 ? (
            <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-[width]"
                style={{
                  width: `${Math.round((progress.done / progress.total) * 100)}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {result && !busy ? (
        <div className="border-border bg-muted/30 rounded-lg border px-3 py-2">
          {result.kind === "export" ? (
            <p className="text-xs leading-relaxed">
              导出完成：{result.manifest.books} 本书 ·{" "}
              {result.manifest.covers} 张封面 · {result.manifest.annotations}{" "}
              条笔记（导出自 Deer {result.manifest.appVersion}）
            </p>
          ) : (
            <p className="text-xs leading-relaxed">
              恢复完成：新增 {result.report.booksAdded} 本书（跳过{" "}
              {result.report.booksSkipped} 本重复）、
              {result.report.coversAdded} 张封面、
              {result.report.foldersAdded} 个文件夹、
              {result.report.annotationsAdded} 条笔记。正在刷新应用…
            </p>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive text-xs leading-relaxed" role="alert">
          {error}
        </p>
      ) : null}

      {!desktop ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <ArchiveRestore className="size-3.5" />
          浏览器预览模式不支持备份，桌面应用内可用。
        </p>
      ) : null}
    </div>
  );
}
