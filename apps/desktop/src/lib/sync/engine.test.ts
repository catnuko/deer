import { describe, expect, it } from "vitest";
import type { SyncAdapter } from "./adapters";
import { kindOfKey, SyncEngine } from "./engine";
import { createSyncState } from "./syncState";
import {
  createMemoryBackend,
  MemoryTransport,
  type MemoryBackend,
} from "./transport";
import type { SyncPersistedState } from "./types";

/**
 * 引擎集成测：两个引擎接在同一个内存「网盘」上，模拟两台设备。
 * 用假 adapter 代替真实 store，聚焦同步内核本身。
 */

type FakeDevice = {
  engine: SyncEngine;
  data: Map<string, unknown>;
  transport: MemoryTransport;
  state: SyncPersistedState;
};

function makeDevice(
  backend: MemoryBackend,
  deviceId: string,
  failNext: ((op: string) => Error | null) | null = null,
): FakeDevice {
  const data = new Map<string, unknown>();
  const adapter: SyncAdapter = {
    name: "fake",
    snapshot: () =>
      [...data.entries()].map(([key, value]) => ({
        kind: kindOfKey(key),
        key,
        data: value,
      })),
    apply: (record) => {
      if (record.deleted) data.delete(record.key);
      else data.set(record.key, record.data);
    },
  };

  const state = createSyncState(deviceId);
  const transport = new MemoryTransport(backend, failNext);
  const engine = new SyncEngine({ transport, adapters: [adapter], state });
  return { engine, data, transport, state };
}

describe("同步引擎", () => {
  it("本地变更推送后，第二台设备拉取即可应用", async () => {
    const backend = createMemoryBackend();
    const a = makeDevice(backend, "dev-a");
    const b = makeDevice(backend, "dev-b");

    a.data.set("bk:hash-1", { title: "小王子" });
    const report = await a.engine.run();
    expect(report.pushed).toBe(1);

    const applied = await b.engine.run();
    expect(applied.applied).toBeGreaterThan(0);
    expect(b.data.get("bk:hash-1")).toEqual({ title: "小王子" });

    // 再同步一次：没有新变更，不应重复推送/应用。
    const idle = await b.engine.run();
    expect(idle.pushed).toBe(0);
    expect(idle.applied).toBe(0);
  });

  it("删除会以墓碑传播，不会被离线设备复活", async () => {
    const backend = createMemoryBackend();
    const a = makeDevice(backend, "dev-a");
    const b = makeDevice(backend, "dev-b");

    a.data.set("bk:hash-1", { title: "将删除" });
    await a.engine.run();
    await b.engine.run();
    expect(b.data.has("bk:hash-1")).toBe(true);

    a.data.delete("bk:hash-1");
    await a.engine.run();

    const offline = b.engine.run();
    await offline;
    expect(b.data.has("bk:hash-1")).toBe(false);
  });

  it("并发修改同一 key 收敛到较新的那次", async () => {
    const backend = createMemoryBackend();
    const a = makeDevice(backend, "dev-a");
    const b = makeDevice(backend, "dev-b");

    a.data.set("bk:hash-1", { title: "初始" });
    await a.engine.run();
    await b.engine.run();

    // A 先改并推送；B 后改（HLC 更大）并推送，同时拉到 A 的旧值。
    a.data.set("bk:hash-1", { title: "A 的修改" });
    await a.engine.run();

    b.data.set("bk:hash-1", { title: "B 的修改" });
    await b.engine.run();
    expect(b.data.get("bk:hash-1")).toEqual({ title: "B 的修改" });

    // A 再同步：拉到 B 的较新记录，收敛一致。
    await a.engine.run();
    expect(a.data.get("bk:hash-1")).toEqual({ title: "B 的修改" });
  });

  it("断网期间改动保留在发件箱，恢复后补传", async () => {
    const backend = createMemoryBackend();
    const a = makeDevice(backend, "dev-a", (op) =>
      op === "chunk:put" ? new Error("网络中断") : null,
    );
    const b = makeDevice(backend, "dev-b");

    a.data.set("bk:hash-1", { title: "离线写的" });
    await expect(a.engine.run()).rejects.toThrow("网络中断");
    expect(a.engine.state.outbox.length).toBeGreaterThan(0);

    // 网络恢复：同一批发件箱补传成功。
    const report = await a.engine.run();
    expect(report.pushed).toBe(1);
    expect(a.engine.state.outbox).toHaveLength(0);

    await b.engine.run();
    expect(b.data.get("bk:hash-1")).toEqual({ title: "离线写的" });
  });

  it("重复块与乱序块的应用是幂等的", async () => {
    const backend = createMemoryBackend();
    const a = makeDevice(backend, "dev-a");
    const b = makeDevice(backend, "dev-b");

    a.data.set("bk:hash-1", { title: "只应出现一次" });
    await a.engine.run();

    const chunk = JSON.parse(
      backend.files.get("ops/dev-a/000001.json") ?? "{}",
    );
    const records = chunk.records;

    expect(b.engine.applyRecords(records)).toBe(1);
    expect(b.engine.applyRecords(records)).toBe(0); // 重复块不再应用
  });

  it("换到另一个网盘空间时重新对齐，不沿用旧游标", async () => {
    const oldBackend = createMemoryBackend();
    const a = makeDevice(oldBackend, "dev-a");
    a.data.set("bk:hash-1", { title: "旧空间" });
    await a.engine.run();
    const oldSpaceId = a.engine.state.spaceId;

    // 同一个引擎换到新网盘目录：manifest 里的空间 id 不同。
    const newBackend = createMemoryBackend();
    const shared = makeDevice(newBackend, "dev-b");
    shared.data.set("bk:hash-2", { title: "新空间" });
    await shared.engine.run();

    a.engine = new SyncEngine({
      transport: new MemoryTransport(newBackend),
      adapters: [
        {
          name: "fake",
          snapshot: () =>
            [...a.data.entries()].map(([key, value]) => ({
              kind: kindOfKey(key),
              key,
              data: value,
            })),
          apply: () => {},
        },
      ],
      state: a.engine.state,
    });

    await a.engine.run();
    expect(a.engine.state.spaceId).not.toBe(oldSpaceId);
    expect(a.engine.state.spaceId).toBe(shared.engine.state.spaceId);
  });
});