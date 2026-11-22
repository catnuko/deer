import { compareHlc } from "./hlc";
import type { Hlc, SyncRecord } from "./types";

/**
 * 合并策略（v1）：
 * - 同一 key 按记录级 LWW：HLC 大者胜；墓碑也是记录，天然不会被离线设备复活。
 * - 书架归属用「每个成员一条记录」的 LWW-Element-Set：add = 有 data，remove = 墓碑，
 *   A 加书架与 B 移出并发时由 HLC 定序，结果确定。
 * - 进度/笔记等字段随记录整体 LWW（字段级 LWW 留到 P2：需要为每个字段记 HLC）。
 *
 * 全部是纯函数，不碰 IO，便于单测与在内存传输上复现多设备收敛。
 */

/** incoming 是否应当覆盖 currentHlc（currentHlc 缺省表示没见过）。 */
export function shouldApply(
  incoming: SyncRecord,
  currentHlc: Hlc | undefined,
): boolean {
  return currentHlc === undefined || compareHlc(incoming.hlc, currentHlc) > 0;
}

/**
 * 把一批远端记录按 HLC 升序排好再逐条应用：
 * 同一个块里可能同时有「创建 → 修改 → 删除」，顺序错了会留下错误的终态。
 */
export function sortRecordsByHlc(records: SyncRecord[]): SyncRecord[] {
  return [...records].sort((a, b) => compareHlc(a.hlc, b.hlc));
}

export type MergeOutcome = {
  /** 需要写入 store 的记录（已过滤掉旧的/重复的）。 */
  accepted: SyncRecord[];
  /** 应用后每个 key 的最新 HLC。 */
  appliedHlc: Record<string, Hlc>;
};

/**
 * 纯合并：不执行 IO，只算出「哪些记录该应用」。
 * `applied` 传本机已应用的最新 HLC 表（会被复制，不修改入参）。
 */
export function mergeRemoteRecords(
  records: SyncRecord[],
  applied: Record<string, Hlc>,
): MergeOutcome {
  const appliedHlc = { ...applied };
  const accepted: SyncRecord[] = [];

  for (const record of sortRecordsByHlc(records)) {
    if (!shouldApply(record, appliedHlc[record.key])) continue;
    appliedHlc[record.key] = record.hlc;
    accepted.push(record);
  }

  return { accepted, appliedHlc };
}

/** 缓存必须带 key 表，避免同一个实体在本地产生重复行。 */
export function recordKeyLabel(record: SyncRecord): string {
  return `${record.kind}:${record.key}${record.deleted ? " (deleted)" : ""}`;
}