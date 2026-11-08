import { describe, expect, it } from "vitest";
import { mergeRemoteRecords, shouldApply, sortRecordsByHlc } from "./merge";
import type { Hlc, SyncRecord } from "./types";

function hlc(wall: number, counter = 0, node = "dev-a"): Hlc {
  return { wall, counter, node };
}

function record(
  key: string,
  time: Hlc,
  data?: unknown,
  deleted = false,
): SyncRecord {
  return {
    kind: "book",
    key,
    hlc: time,
    ...(deleted ? { deleted: true as const } : { data }),
  };
}

describe("合并规则", () => {
  it("HLC 更大者胜", () => {
    expect(shouldApply(record("bk:1", hlc(200)), hlc(100))).toBe(true);
    expect(shouldApply(record("bk:1", hlc(100)), hlc(200))).toBe(false);
    expect(shouldApply(record("bk:1", hlc(100)), undefined)).toBe(true);
  });

  it("墓碑不会被更旧的创建记录复活", () => {
    const tombstone = record("bk:1", hlc(300), undefined, true);
    const staleCreate = record("bk:1", hlc(200), { title: "旧数据" });

    const { accepted, appliedHlc } = mergeRemoteRecords([tombstone], {
      "bk:1": hlc(100),
    });
    expect(accepted).toHaveLength(1);

    const second = mergeRemoteRecords([staleCreate], appliedHlc);
    expect(second.accepted).toHaveLength(0);
  });

  it("重复应用同一批记录是幂等的", () => {
    const records = [record("bk:1", hlc(100), { v: 1 })];
    const first = mergeRemoteRecords(records, {});
    expect(first.accepted).toHaveLength(1);

    const second = mergeRemoteRecords(records, first.appliedHlc);
    expect(second.accepted).toHaveLength(0);
  });

  it("块内记录按 HLC 升序应用（创建先于删除）", () => {
    const create = record("bk:1", hlc(100), { v: 1 });
    const update = record("bk:1", hlc(200), { v: 2 });
    const remove = record("bk:1", hlc(300), undefined, true);

    const sorted = sortRecordsByHlc([remove, update, create]);
    expect(sorted.map((item) => item.hlc.wall)).toEqual([100, 200, 300]);

    const { accepted } = mergeRemoteRecords([remove, update, create], {});
    expect(accepted).toHaveLength(3);
  });

  it("不同 key 互不影响，各自保留最新", () => {
    const { accepted, appliedHlc } = mergeRemoteRecords(
      [
        record("bk:1", hlc(100), { v: 1 }),
        record("bk:2", hlc(150), { v: 1 }),
        record("bk:1", hlc(50), { v: 0 }),
      ],
      { "bk:1": hlc(80) },
    );
    // bk:1 的 @50 比已应用的 @80 旧，跳过；bk:1@100 与 bk:2@150 应用。
    expect(accepted.map((item) => item.key)).toEqual(["bk:1", "bk:2"]);
    expect(appliedHlc["bk:1"].wall).toBe(100);
    expect(appliedHlc["bk:2"].wall).toBe(150);
  });
});