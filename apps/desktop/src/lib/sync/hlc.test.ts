import { afterEach, describe, expect, it, vi } from "vitest";
import { compareHlc, createHlcClock } from "./hlc";

describe("HLC", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("同一毫秒内连续生成的时间戳严格递增", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const clock = createHlcClock("device-a");
    const first = clock.now();
    const second = clock.now();
    const third = clock.now();

    expect(compareHlc(second, first)).toBeGreaterThan(0);
    expect(compareHlc(third, second)).toBeGreaterThan(0);
    expect(third.counter).toBe(2);
  });

  it("物理时钟回拨后仍然单调", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000);
    const clock = createHlcClock("device-a");
    const first = clock.now();

    now.mockReturnValue(4_000); // 时钟被往回调
    const second = clock.now();

    expect(compareHlc(second, first)).toBeGreaterThan(0);
    expect(second.wall).toBe(5_000);
  });

  it("observe 之后生成的 HLC 一定大于远端记录", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const clock = createHlcClock("device-a");
    const remote = { wall: 9_000, counter: 7, node: "device-b" };

    clock.observe(remote);
    const next = clock.now();

    expect(compareHlc(next, remote)).toBeGreaterThan(0);
  });

  it("平局按 node 字典序决胜", () => {
    const shared = { wall: 100, counter: 2 };
    expect(
      compareHlc({ ...shared, node: "a" }, { ...shared, node: "b" }),
    ).toBeLessThan(0);
    expect(
      compareHlc({ ...shared, node: "b" }, { ...shared, node: "a" }),
    ).toBeGreaterThan(0);
    expect(compareHlc({ ...shared, node: "a" }, { ...shared, node: "a" })).toBe(0);
  });
});