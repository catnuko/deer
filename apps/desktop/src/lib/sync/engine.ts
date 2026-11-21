import { createHlcClock, type HlcClock } from "./hlc";
import { mergeRemoteRecords } from "./merge";
import { pruneExpiredTombstones } from "./syncState";
import type { SyncTransport } from "./transport";
import type {
  Hlc,
  SyncKind,
  SyncPersistedState,
  SyncRecord,
  SyncReport,
} from "./types";
import { fingerprintOf, type LocalEntry, type SyncAdapter } from "./adapters";

/** 每块最多带多少条记录：控制单文件大小、降低拉取重试成本。 */
const CHUNK_SIZE = 200;

const KIND_BY_KEY_PREFIX: Record<string, SyncKind> = {
  bk: "book",
  sh: "shelf",
  bs: "bookShelf",
  an: "annotation",
  th: "chatThread",
  ms: "chatMessage",
};

export function kindOfKey(key: string): SyncKind {
  return KIND_BY_KEY_PREFIX[key.slice(0, 2)] ?? "book";
}

export type SyncEngineOptions = {
  transport: SyncTransport;
  adapters: SyncAdapter[];
  state: SyncPersistedState;
  /** 每次状态变化后落盘（引擎不直接碰存储，便于测试）。 */
  persist?: (state: SyncPersistedState) => Promise<void>;
  now?: () => number;
};

/**
 * 同步引擎：一次 run = 收集本地变更 → 推送 → 拉取远端 → 合并应用。
 *
 * - 单飞：同一时刻只有一次 run 在执行，并发调用复用同一个 Promise。
 * - 推送先于拉取：先把本地变更写上去，再读别人的，避免自己刚改的东西被旧远端盖掉。
 * - 每个 key 记住已应用的远端 HLC，重复块、乱序块都幂等。
 */
export class SyncEngine {
  private readonly transport: SyncTransport;
  private readonly adapters: SyncAdapter[];
  private readonly clock: HlcClock;
  private readonly persistFn?: (state: SyncPersistedState) => Promise<void>;
  private readonly now: () => number;

  state: SyncPersistedState;
  private inflight: Promise<SyncReport> | null = null;

  constructor(options: SyncEngineOptions) {
    this.transport = options.transport;
    this.adapters = options.adapters;
    this.state = options.state;
    this.persistFn = options.persist;
    this.now = options.now ?? (() => Date.now());
    this.clock = createHlcClock(options.state.deviceId);
  }

  /** 单飞执行一次完整同步。 */
  run(): Promise<SyncReport> {
    this.inflight ??= this.runOnce().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async save(): Promise<void> {
    this.state.lastSyncedAt = this.now();
    await this.persistFn?.(this.state);
  }

  private async runOnce(): Promise<SyncReport> {
    this.state = pruneExpiredTombstones(this.state, this.now());

    await this.ensureManifest();
    this.collectLocal();

    const pushed = await this.push();
    const pulled = await this.pull();

    await this.save();
    return { ...pulled, pushed };
  }

  /** 首次接触网盘时建立空间；换到别的目录时按新空间重新对齐。 */
  private async ensureManifest(): Promise<void> {
    const manifest = await this.transport.readManifest();
    if (!manifest) {
      this.state.spaceId = this.state.spaceId || `space-${this.state.deviceId}`;
      await this.transport.writeManifest({
        schema: 1,
        spaceId: this.state.spaceId,
        createdAt: this.now(),
      });
      return;
    }

    if (this.state.spaceId && this.state.spaceId !== manifest.spaceId) {
      // 换了网盘目录（或别人重建了空间）：清掉游标与指纹，按新空间重来。
      this.state.spaceId = manifest.spaceId;
      this.state.cursor = {};
      this.state.appliedHlc = {};
      this.state.shadow = {};
      this.state.seq = 0;
      await this.save();
    } else {
      this.state.spaceId = manifest.spaceId;
    }
  }

  /**
   * 本地变更收集：拿当前全量快照与上次指纹比。
   * 指纹变了 → 新记录；快照里消失 → 墓碑。
   */
  collectLocal(): SyncRecord[] {
    const entries = this.snapshot();
    const seen = new Set<string>();
    const fresh: SyncRecord[] = [];

    for (const entry of entries) {
      seen.add(entry.key);
      const fingerprint = fingerprintOf(entry.data);
      if (this.state.shadow[entry.key] === fingerprint) continue;
      const record: SyncRecord = {
        kind: entry.kind,
        key: entry.key,
        hlc: this.clock.now(),
        data: entry.data,
      };
      this.state.outbox.push(record);
      this.state.shadow[entry.key] = fingerprint;
      this.state.localHlc[entry.key] = record.hlc;
      fresh.push(record);
    }

    for (const [key, fingerprint] of Object.entries(this.state.shadow)) {
      if (seen.has(key)) continue;
      // null 表示这个 key 的墓碑已经入过发件箱或推送过，不必重复。
      if (fingerprint === null) continue;
      const hlc = this.clock.now();
      this.state.outbox.push({
        kind: kindOfKey(key),
        key,
        hlc,
        deleted: true,
      });
      this.state.shadow[key] = null;
      this.state.localHlc[key] = hlc;
      this.state.tombstones[key] = { hlc, at: this.now() };
    }

    return fresh;
  }

  private snapshot(): LocalEntry[] {
    const entries: LocalEntry[] = [];
    for (const adapter of this.adapters) entries.push(...adapter.snapshot());
    return entries;
  }

  private async push(): Promise<number> {
    let pushed = 0;
    while (this.state.outbox.length) {
      const records = this.state.outbox.slice(0, CHUNK_SIZE);
      const seq = this.state.seq + 1;
      await this.transport.putChunk({
        deviceId: this.state.deviceId,
        seq,
        records,
      });
      this.state.seq = seq;
      this.state.cursor[this.state.deviceId] = seq;
      this.state.outbox = this.state.outbox.slice(records.length);
      pushed += records.length;
      await this.save();
    }
    return pushed;
  }

  private async pull(): Promise<{ pulled: number; applied: number }> {
    const chunks = await this.transport.listChunks();
    const pending = chunks
      .filter(
        (ref) =>
          ref.deviceId !== this.state.deviceId &&
          ref.seq > (this.state.cursor[ref.deviceId] ?? 0),
      )
      .sort(
        (a, b) =>
          a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq,
      );

    let applied = 0;
    for (const ref of pending) {
      const chunk = await this.transport.getChunk(ref);
      applied += this.applyRecords(chunk.records);
      this.state.cursor[ref.deviceId] = Math.max(
        this.state.cursor[ref.deviceId] ?? 0,
        ref.seq,
      );
      await this.save();
    }

    return { pulled: pending.length, applied };
  }

  /** 应用一批远端记录；返回实际写入 store 的条数。 */
  applyRecords(records: SyncRecord[]): number {
    const { accepted } = mergeRemoteRecords(records, this.state.appliedHlc);
    let applied = 0;

    for (const record of accepted) {
      this.clock.observe(record.hlc);

      // 本地同 key 有更新的修改（还没推或推了但没被自己拉回）：让本地赢。
      const local = this.state.localHlc[record.key];
      if (local && isNewerHlc(local, record.hlc)) continue;

      for (const adapter of this.adapters) adapter.apply(record);
      this.state.appliedHlc[record.key] = record.hlc;

      if (record.deleted) {
        this.state.shadow[record.key] = null;
        this.state.tombstones[record.key] = { hlc: record.hlc, at: this.now() };
      } else {
        this.state.shadow[record.key] = fingerprintOf(record.data);
      }
      applied += 1;
    }

    return applied;
  }
}

function isNewerHlc(a: Hlc, b: Hlc): boolean {
  if (a.wall !== b.wall) return a.wall > b.wall;
  if (a.counter !== b.counter) return a.counter > b.counter;
  return a.node > b.node;
}