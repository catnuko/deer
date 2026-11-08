import { isTauri } from "@/lib/platform";
import { useAnnotationStore } from "@/store/annotationStore";
import { useAppSettings } from "@/store/appSettings";
import { useBookStore } from "@/store/bookStore";
import { useChatStore } from "@/store/chatStore";
import { syncAdapters } from "./adapters";
import { uploadPendingFiles } from "./bookFiles";
import { SyncEngine } from "./engine";
import { useSyncStore } from "./statusStore";
import {
  createSyncState,
  readSyncState,
  writeSyncState,
} from "./syncState";
import type { SyncPersistedState } from "./types";
import { WebDavTransport } from "./webdavTransport";

/**
 * 同步运行时：把「设置 + 传输 + 引擎 + 三个 store」接起来。
 *
 * - 开启同步且填了 WebDAV 地址时才启动；
 * - 本地变更 5s 防抖后自动同步，另有 60s 定时与窗口聚焦触发；
 * - 同步期间抑制 store 订阅回环（applyRemote 写 store 不该再触发一轮）。
 */

const AUTO_INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 5_000;
const FIRST_SYNC_DELAY_MS = 3_000;

type SyncHandle = {
  transport: WebDavTransport;
  engine: SyncEngine;
  state: SyncPersistedState;
  running: boolean;
  suppressDirty: boolean;
  timer: ReturnType<typeof setInterval>;
  debounce: ReturnType<typeof setTimeout> | null;
  disposers: Array<() => void>;
};

let handle: SyncHandle | null = null;

export function isSyncRunning(): boolean {
  return handle !== null;
}

export function currentSyncDeviceId(): string | null {
  return handle?.state.deviceId ?? null;
}

/** 启动/重启同步运行时（设置变更后调用）。 */
export async function startSyncRuntime(): Promise<void> {
  stopSyncRuntime();

  const settings = useAppSettings.getState();
  if (!isTauri() || !settings.syncEnabled || !settings.syncUrl.trim()) {
    useSyncStore.getState().reset();
    return;
  }

  // 书库还没加载完：等 ready 再启动，避免拿空库做第一次收集。
  if (!useBookStore.getState().ready) {
    const unsubscribe = useBookStore.subscribe((state) => {
      if (!state.ready) return;
      unsubscribe();
      void startSyncRuntime();
    });
    return;
  }

  const persisted = (await readSyncState()) ?? createSyncState();
  const transport = new WebDavTransport({
    baseUrl: settings.syncUrl,
    username: settings.syncUsername,
    password: settings.syncPassword,
    deviceId: persisted.deviceId,
  });
  const engine = new SyncEngine({
    transport,
    adapters: syncAdapters,
    state: persisted,
    persist: writeSyncState,
  });

  const current: SyncHandle = {
    transport,
    engine,
    state: persisted,
    running: false,
    suppressDirty: false,
    timer: setInterval(() => void runSync(), AUTO_INTERVAL_MS),
    debounce: null,
    disposers: [],
  };

  const markDirty = () => {
    if (!handle || handle.suppressDirty) return;
    if (handle.debounce) clearTimeout(handle.debounce);
    handle.debounce = setTimeout(() => void runSync(), DEBOUNCE_MS);
  };

  const unsubscribers = [
    useBookStore.subscribe(markDirty),
    useAnnotationStore.subscribe(markDirty),
    useChatStore.subscribe(markDirty),
  ];
  const onFocus = () => void runSync();
  window.addEventListener("focus", onFocus);

  current.disposers.push(
    ...unsubscribers,
    () => window.removeEventListener("focus", onFocus),
  );

  handle = current;
  useSyncStore.setState({ phase: "idle" });

  setTimeout(() => void runSync(), FIRST_SYNC_DELAY_MS);
}

export function stopSyncRuntime(): void {
  const current = handle;
  handle = null;
  if (!current) return;
  clearInterval(current.timer);
  if (current.debounce) clearTimeout(current.debounce);
  for (const dispose of current.disposers) dispose();
  useSyncStore.getState().reset();
}

/** 手动「立即同步」。 */
export async function syncNow(): Promise<void> {
  await runSync();
}

async function runSync(): Promise<void> {
  const current = handle;
  if (!current || current.running) return;

  current.running = true;
  current.suppressDirty = true;
  useSyncStore.getState().begin();

  try {
    // 旧书补内容哈希：同步的身份基础，哈希算不出来的书不参与同步。
    await useBookStore.getState().backfillContentHashes();

    const report = await current.engine.run();

    let filesSynced = 0;
    if (useAppSettings.getState().syncBooks) {
      // 引擎在每轮开始时会重建 state 对象（墓碑裁剪），以引擎当前对象为准。
      const result = await uploadPendingFiles({
        transport: current.transport,
        state: current.engine.state,
        books: useBookStore.getState().books,
      });
      filesSynced = result.uploaded;
      if (result.failed.length) {
        console.warn("[sync] 部分书文件上传失败", result.failed);
      }
      await writeSyncState(current.engine.state);
    }

    useSyncStore.getState().finish(report, filesSynced);
  } catch (error) {
    useSyncStore
      .getState()
      .fail(error instanceof Error ? error.message : String(error));
  } finally {
    current.running = false;
    current.suppressDirty = false;
  }
}

/** 设置页「测试连接」：只发一次 PROPFIND，不写入任何东西。 */
export async function testWebDavConnection(config: {
  url: string;
  username: string;
  password: string;
}): Promise<{ ok: boolean; message: string }> {
  if (!isTauri()) {
    return { ok: false, message: "连接测试只在桌面应用里可用" };
  }
  const transport = new WebDavTransport({
    baseUrl: config.url,
    username: config.username,
    password: config.password,
    deviceId: "probe",
  });
  return transport.testConnection();
}