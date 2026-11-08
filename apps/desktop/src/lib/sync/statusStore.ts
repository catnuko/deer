import { create } from "zustand";
import type { SyncPhase, SyncReport } from "./types";

/** 同步状态：设置页与顶栏只读这里，不直接碰引擎。 */
type SyncStatusStore = {
  phase: SyncPhase;
  lastSyncedAt?: number;
  lastError?: string;
  lastReport?: SyncReport;
  /** 本次同步上传的书籍文件/封面数量。 */
  filesSynced: number;
  begin(): void;
  finish(report: SyncReport, filesSynced: number): void;
  fail(message: string): void;
  reset(): void;
};

export const useSyncStore = create<SyncStatusStore>((set) => ({
  phase: "off",
  filesSynced: 0,

  begin() {
    set({ phase: "syncing", lastError: undefined });
  },

  finish(report, filesSynced) {
    set({
      phase: "idle",
      lastReport: report,
      filesSynced,
      lastSyncedAt: Date.now(),
      lastError: undefined,
    });
  },

  fail(message) {
    // 失败不清 lastSyncedAt：用户仍能看到「上次成功是什么时候」。
    set({ phase: "error", lastError: message });
  },

  reset() {
    set({ phase: "off", lastError: undefined, lastReport: undefined, filesSynced: 0 });
  },
}));