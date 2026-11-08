import { isTauri } from "@/lib/platform";
import type { SyncPersistedState } from "./types";

/**
 * 本机同步状态（设备号、发件箱、游标、指纹表）的持久化。
 * 桌面端与其它 store 一致走 Tauri plugin-store；浏览器预览退化为 localStorage，
 * 仅用于调试（浏览器直开本来就没有同步能力）。
 */

const STORE_FILE = "sync-state.json";
const STORE_KEY = "syncState";
const LS_KEY = "deer.sync-state.v1";

/** 墓碑保留 90 天：足够覆盖离线设备，避免状态文件无限增长。 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function createDeviceId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  // 取前 12 位即可：只用于块目录名与 HLC 平局，不需要全局唯一。
  return rand.replace(/-/g, "").slice(0, 12);
}

export function createSyncState(deviceId = createDeviceId()): SyncPersistedState {
  return {
    deviceId,
    spaceId: "",
    seq: 0,
    outbox: [],
    shadow: {},
    tombstones: {},
    appliedHlc: {},
    localHlc: {},
    cursor: {},
    uploadedFiles: {},
  };
}

/** 老版本/损坏的状态文件按「空状态」兜底，绝不因同步状态坏掉而阻塞书库。 */
export function normalizeSyncState(raw: unknown): SyncPersistedState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<SyncPersistedState>;
  if (typeof value.deviceId !== "string" || !value.deviceId) return null;
  return {
    ...createSyncState(value.deviceId),
    ...value,
    outbox: Array.isArray(value.outbox) ? value.outbox : [],
    shadow: value.shadow && typeof value.shadow === "object" ? value.shadow : {},
    tombstones:
      value.tombstones && typeof value.tombstones === "object"
        ? value.tombstones
        : {},
    appliedHlc:
      value.appliedHlc && typeof value.appliedHlc === "object"
        ? value.appliedHlc
        : {},
    localHlc:
      value.localHlc && typeof value.localHlc === "object"
        ? value.localHlc
        : {},
    cursor:
      value.cursor && typeof value.cursor === "object" ? value.cursor : {},
    uploadedFiles:
      value.uploadedFiles && typeof value.uploadedFiles === "object"
        ? value.uploadedFiles
        : {},
  };
}

export async function readSyncState(): Promise<SyncPersistedState | null> {
  try {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(STORE_FILE, { autoSave: false });
      return normalizeSyncState(await store.get<unknown>(STORE_KEY));
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw ? normalizeSyncState(JSON.parse(raw)) : null;
  } catch (error) {
    console.error("[sync] 读取同步状态失败，按空状态启动", error);
    return null;
  }
}

export async function writeSyncState(state: SyncPersistedState): Promise<void> {
  try {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(STORE_FILE, { autoSave: false });
      await store.set(STORE_KEY, state);
      await store.save();
      return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("[sync] 写入同步状态失败", error);
  }
}

/** 清理过期墓碑（以及对应的指纹/游标痕迹），每次同步前跑一次。 */
export function pruneExpiredTombstones(
  state: SyncPersistedState,
  now = Date.now(),
): SyncPersistedState {
  const tombstones: SyncPersistedState["tombstones"] = {};
  for (const [key, value] of Object.entries(state.tombstones)) {
    if (now - value.at <= TOMBSTONE_TTL_MS) tombstones[key] = value;
  }
  return { ...state, tombstones };
}