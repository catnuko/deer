// @vitest-environment happy-dom
// 导出/导入编排默认读写 window.localStorage，所以整个文件跑 DOM 环境；
// 收集/写回的纯逻辑测试仍用注入 storage，不受环境影响。
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySettingsBlobs,
  backupFileName,
  collectSettingsBlobs,
  runExport,
  runImport,
  type BackupManifest,
  type ImportReport,
} from "./backup";

// runExport/runImport 走 Tauri command 与事件通道：命令用受控 Promise 替身，
// 事件 listen 记录回调，验证进度监听的挂载与清理。
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

/** 内存 Storage 实现，替代 window.localStorage。 */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("备份设置的收集与写回", () => {
  it("collectSettingsBlobs 只收集 Deer 的两份设置键", () => {
    const storage = memoryStorage({
      "deer-app-settings": '{"state":{"aiApiKey":"k"}}',
      "deer-reading-settings": '{"state":{}}',
      "unrelated-key": "keep-out",
    });
    const blobs = collectSettingsBlobs(storage);
    expect(Object.keys(blobs).sort()).toEqual([
      "deer-app-settings",
      "deer-reading-settings",
    ]);
  });

  it("applySettingsBlobs 写回设置且忽略未知键", () => {
    const storage = memoryStorage();
    applySettingsBlobs(
      {
        "deer-app-settings": '{"state":{"startupView":"continue"}}',
        "evil-key": "ignored",
      },
      storage,
    );
    expect(storage.getItem("deer-app-settings")).toBe(
      '{"state":{"startupView":"continue"}}',
    );
    expect(storage.getItem("evil-key")).toBeNull();
  });

  it("导出文件名带时间戳与 .deer-backup 扩展名", () => {
    expect(backupFileName()).toMatch(
      /^deer-backup-\d{8}-\d{2}\d{2}\.deer-backup$/,
    );
  });
});

describe("备份导出与导入恢复", () => {
  const manifest: BackupManifest = {
    formatVersion: 1,
    appVersion: "0.2.0",
    createdAt: 0,
    books: 3,
    covers: 2,
    annotations: 7,
  };

  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("runExport 收集设置发给 command，进度监听随任务结束摘除", async () => {
    localStorage.setItem("deer-reading-settings", '{"state":{"fontSize":"lg"}}');
    let progressHandler: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    listenMock.mockImplementation(async (_event, handler) => {
      progressHandler = handler;
      return unlisten;
    });
    let resolveInvoke: (manifest: BackupManifest) => void = () => {};
    invokeMock.mockImplementation(
      () => new Promise<BackupManifest>((resolve) => (resolveInvoke = resolve)),
    );

    const onProgress = vi.fn();
    const promise = runExport("/tmp/deer.deer-backup", onProgress);

    // 任务运行前进度通道已挂上；推送一条进度应到达监听器。
    await vi.waitFor(() => expect(progressHandler).toBeTruthy());
    progressHandler!({ payload: { phase: "copy", done: 1, total: 3 } });
    expect(onProgress).toHaveBeenCalledWith({
      phase: "copy",
      done: 1,
      total: 3,
    });

    resolveInvoke(manifest);
    await expect(promise).resolves.toBe(manifest);

    expect(invokeMock).toHaveBeenCalledWith("export_backup", {
      destPath: "/tmp/deer.deer-backup",
      settings: { "deer-reading-settings": '{"state":{"fontSize":"lg"}}' },
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("runImport 写回归档带出的设置并原样返回报告", async () => {
    const report: ImportReport = {
      booksAdded: 2,
      booksSkipped: 1,
      coversAdded: 2,
      foldersAdded: 0,
      annotationsAdded: 5,
      manifest,
      settings: {
        "deer-app-settings": '{"state":{"startupView":"continue"}}',
      },
    };
    invokeMock.mockResolvedValue(report);

    await expect(runImport("/tmp/deer.deer-backup")).resolves.toBe(report);

    expect(invokeMock).toHaveBeenCalledWith("import_backup", {
      srcPath: "/tmp/deer.deer-backup",
    });
    // 恢复的设置已写回 localStorage（合并式导入的设置部分）。
    expect(localStorage.getItem("deer-app-settings")).toBe(
      '{"state":{"startupView":"continue"}}',
    );
  });
});
