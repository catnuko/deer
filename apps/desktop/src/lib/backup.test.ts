import { describe, expect, it } from "vitest";
import {
  applySettingsBlobs,
  backupFileName,
  collectSettingsBlobs,
} from "./backup";

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
