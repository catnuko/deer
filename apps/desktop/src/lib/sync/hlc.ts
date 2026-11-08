import type { Hlc } from "./types";

/**
 * 混合逻辑时钟（HLC）。
 *
 * 规则：wall 取「物理时间」与「见过的最大 wall」的较大值；
 * 同一毫秒内递增 counter；node 恒为设备号，平局按 node 字典序定序。
 * 这样既能回答「这条笔记什么时候改的」，又能保证跨设备全序。
 */
export type HlcClock = {
  /** 生成一个严格大于此前本机所有时间戳的新 HLC。 */
  now(): Hlc;
  /** 观察远端 HLC，抬高本地时钟水位（避免本机时间回拨后被远端压住）。 */
  observe(remote: Hlc): void;
  /** 当前水位（用于持久化后恢复）。 */
  peek(): Hlc;
};

export function createHlcClock(node: string, initial?: Hlc): HlcClock {
  let last: Hlc = initial
    ? { ...initial, node }
    : { wall: 0, counter: 0, node };

  return {
    now() {
      const wall = Math.max(Date.now(), last.wall);
      const counter = wall === last.wall ? last.counter + 1 : 0;
      last = { wall, counter, node };
      return last;
    },
    observe(remote) {
      if (compareHlc(remote, last) <= 0) return;
      const wall = Math.max(Date.now(), remote.wall, last.wall);
      // 同一 wall 上必须把 counter 抬到远端之上，否则 now() 只加 1 仍可能小于远端。
      let counter = wall === last.wall ? last.counter : 0;
      if (wall === remote.wall) counter = Math.max(counter, remote.counter);
      last = { wall, counter, node };
    },
    peek() {
      return last;
    },
  };
}

/** 全序比较：负数表示 a 早于 b。 */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.wall !== b.wall) return a.wall - b.wall;
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.node < b.node ? -1 : a.node > b.node ? 1 : 0;
}

export function isNewerThan(a: Hlc, b: Hlc | undefined): boolean {
  return b === undefined || compareHlc(a, b) > 0;
}