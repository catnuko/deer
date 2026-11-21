/**
 * 备份与恢复的前端编排：文件对话框、进度事件、设置键的收集与写回。
 * 归档的打包/解包/合并都在 Rust 侧 command 里做，书籍文件不进 JS 内存。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

export type BackupProgress = {
  phase: "scan" | "copy" | "merge" | "done";
  done: number;
  total: number;
};

export type BackupManifest = {
  formatVersion: number;
  appVersion: string;
  createdAt: number;
  books: number;
  covers: number;
  annotations: number;
};

export type ImportReport = {
  booksAdded: number;
  booksSkipped: number;
  coversAdded: number;
  foldersAdded: number;
  annotationsAdded: number;
  manifest: BackupManifest;
  /** 归档带出的设置原文，按 localStorage 键名组织；由前端写回。 */
  settings: Record<string, string>;
};

export const BACKUP_FILE_FILTERS = [
  { name: "Deer 备份", extensions: ["deer-backup"] },
];

/** 备份覆盖的两份 zustand persist 设置（localStorage 键名）。 */
const SETTINGS_STORAGE_KEYS = ["deer-app-settings", "deer-reading-settings"];

/** 收集设置原文；storage 可注入，方便单测。 */
export function collectSettingsBlobs(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): Record<string, string> {
  const blobs: Record<string, string> = {};
  for (const key of SETTINGS_STORAGE_KEYS) {
    const raw = storage.getItem(key);
    if (raw !== null) blobs[key] = raw;
  }
  return blobs;
}

/** 把归档带出的设置写回 localStorage；storage 可注入，方便单测。 */
export function applySettingsBlobs(
  blobs: Record<string, string>,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  for (const [key, raw] of Object.entries(blobs)) {
    if (SETTINGS_STORAGE_KEYS.includes(key)) storage.setItem(key, raw);
  }
}

export function backupFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `deer-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}.deer-backup`;
}

/** 弹出保存对话框；取消返回 null。 */
export function pickExportDestination(): Promise<string | null> {
  return save({
    title: "导出备份",
    defaultPath: backupFileName(),
    filters: BACKUP_FILE_FILTERS,
  });
}

/** 弹出选择备份文件的对话框；取消返回 null。 */
export function pickImportSource(): Promise<string | null> {
  return open({
    title: "选择备份文件",
    multiple: false,
    directory: false,
    filters: BACKUP_FILE_FILTERS,
  });
}

type ProgressListener = (progress: BackupProgress) => void;

async function withProgress<T>(
  task: () => Promise<T>,
  onProgress?: ProgressListener,
): Promise<T> {
  if (!onProgress) return task();
  const unlisten = await listen<BackupProgress>("backup://progress", (event) => {
    onProgress(event.payload);
  });
  try {
    return await task();
  } finally {
    unlisten();
  }
}

/** 导出备份；返回归档绝对路径。 */
export function runExport(
  destPath: string,
  onProgress?: ProgressListener,
): Promise<BackupManifest> {
  const settings = collectSettingsBlobs();
  return withProgress(
    () => invoke<BackupManifest>("export_backup", { destPath, settings }),
    onProgress,
  );
}

/** 导入恢复（合并式）；归档带出的设置会先写回 localStorage。 */
export function runImport(
  srcPath: string,
  onProgress?: ProgressListener,
): Promise<ImportReport> {
  return withProgress(
    () =>
      invoke<ImportReport>("import_backup", { srcPath }).then((report) => {
        applySettingsBlobs(report.settings);
        return report;
      }),
    onProgress,
  );
}
