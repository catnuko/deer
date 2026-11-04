import { describe, expect, it } from "vitest";
import {
  createTurnQueue,
  drainTurnQueue,
  jumpPages,
  requestTurn,
  resetTurnQueue,
  type PageTurnViewLike,
  type TurnQueue,
} from "@/lib/pageTurnQueue";

/** 可控门槛：模拟分页器一次翻页动画的时长，期间发生的按键要被累加。 */
function gate() {
  let open: (() => void) | null = null;
  const wait = () =>
    new Promise<void>((resolve) => {
      open = resolve;
    });
  return {
    wait,
    release() {
      const resolve = open;
      open = null;
      resolve?.();
    },
  };
}

type FakeRendererOptions = {
  pages?: number;
  page?: number;
  index?: number;
  animated?: boolean;
};

function fakeView(options: FakeRendererOptions = {}) {
  const state = {
    page: options.page ?? 10,
    pages: options.pages ?? 100,
    index: options.index ?? 3,
    animated: options.animated ?? true,
    goes: [] as Array<{ index: number; anchor: number }>,
    turns: [] as Array<"next" | "prev">,
    animatedDuringTurn: [] as boolean[],
  };

  const renderer = {
    get pages() {
      return state.pages;
    },
    get page() {
      return state.page;
    },
    getContents: () => [{ index: state.index }],
    goTo: async (target: { index: number; anchor: () => number }) => {
      state.goes.push({ index: target.index, anchor: target.anchor() });
    },
    hasAttribute: (name: string) => name === "animated" && state.animated,
    removeAttribute: (name: string) => {
      if (name === "animated") state.animated = false;
    },
    setAttribute: (name: string) => {
      if (name === "animated") state.animated = true;
    },
  };

  const view: PageTurnViewLike = {
    renderer,
    next: async () => {
      state.turns.push("next");
      state.animatedDuringTurn.push(state.animated);
      state.page += 1;
    },
    prev: async () => {
      state.turns.push("prev");
      state.animatedDuringTurn.push(state.animated);
      state.page -= 1;
    },
  };

  return { view, state };
}

/** 一直等到队列空闲（drainTurnQueue 内部的 await 链走完）。 */
async function idle(queue: TurnQueue) {
  for (let i = 0; i < 20 && queue.busy; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("M1b 连翻累加", () => {
  it("动画窗口内连按 4 次，最终恰好前进 5 页（1 次动画 + 4 页合并）", async () => {
    const queue = createTurnQueue();
    const positions: number[] = [];
    const first = gate();
    let position = 0;

    const step = async (delta: number) => {
      if (Math.abs(delta) === 1) {
        await first.wait();
      }
      position += delta;
      positions.push(position);
    };

    requestTurn(queue, 1, (delta) => drainTurnQueue(queue, delta, step));
    expect(queue.busy).toBe(true);

    // 分页器忙：这 4 次按键不能被丢掉。
    for (let i = 0; i < 4; i += 1) {
      requestTurn(queue, 1, (delta) => drainTurnQueue(queue, delta, step));
    }
    expect(queue.pending).toBe(4);

    first.release();
    await idle(queue);

    expect(position).toBe(5);
    // 合并跳只跑一次 step(4)，不是四次单页 step。
    expect(positions).toEqual([1, 5]);
    expect(queue.pending).toBe(0);
  });

  it("反向连按相互抵消", async () => {
    const queue = createTurnQueue();
    const first = gate();
    let position = 0;
    const step = async (delta: number) => {
      if (Math.abs(delta) === 1) await first.wait();
      position += delta;
    };

    requestTurn(queue, 1, (delta) => drainTurnQueue(queue, delta, step));
    requestTurn(queue, 1, (delta) => drainTurnQueue(queue, delta, step));
    requestTurn(queue, -1, (delta) => drainTurnQueue(queue, delta, step));
    expect(queue.pending).toBe(0);

    first.release();
    await idle(queue);

    expect(position).toBe(1);
    expect(queue.busy).toBe(false);
  });

  it("换书作废未消化的请求，不会排到下一本书上", async () => {
    const queue = createTurnQueue();
    const first = gate();
    let position = 0;
    const step = async (delta: number) => {
      if (Math.abs(delta) === 1) await first.wait();
      position += delta;
    };

    requestTurn(queue, 1, (delta) => drainTurnQueue(queue, delta, step));
    requestTurn(queue, 1, (delta) => drainTurnQueue(queue, delta, step));
    requestTurn(queue, 1, (delta) => drainTurnQueue(queue, delta, step));
    expect(queue.pending).toBe(2);

    resetTurnQueue(queue);
    first.release();
    await idle(queue);

    expect(position).toBe(1);
    expect(queue.busy).toBe(false);
    expect(queue.pending).toBe(0);
  });
});

describe("M1b 合并跳转", () => {
  it("同章内一次 goTo 落到目标页，不碰 animated", async () => {
    const { view, state } = fakeView({ pages: 100, page: 10, index: 3 });

    await jumpPages(view, 5);

    expect(state.goes).toHaveLength(1);
    expect(state.goes[0].index).toBe(3);
    // 分页器反解：round(anchor × (pages - 3)) + 1 = 目标页。
    expect(Math.round(state.goes[0].anchor * (state.pages - 3)) + 1).toBe(15);
    expect(state.turns).toEqual([]);
    expect(state.animated).toBe(true);
  });

  it("目标越出本节时，剩余页数摘掉 animated 逐页走完再挂回", async () => {
    const { view, state } = fakeView({ pages: 100, page: 95 });

    await jumpPages(view, 10);

    // 本节最后一页是 pages-2=98，走 goTo 到 98，剩 7 页跨章。
    expect(state.goes).toHaveLength(1);
    expect(Math.round(state.goes[0].anchor * (state.pages - 3)) + 1).toBe(98);
    expect(state.turns).toHaveLength(7);
    expect(state.animatedDuringTurn.every((animated) => animated === false)).toBe(
      true,
    );
    expect(state.animated).toBe(true);
  });

  it("已经在本节末页时全部按跨章逐页走完", async () => {
    const { view, state } = fakeView({ pages: 100, page: 98 });

    await jumpPages(view, 3);

    expect(state.goes).toEqual([]);
    expect(state.turns).toEqual(["next", "next", "next"]);
  });

  it("拿不到页数的渲染器（固定版式）逐页走，不报错", async () => {
    const { view, state } = fakeView({ page: 0 });
    delete (view.renderer as { pages?: number }).pages;

    await jumpPages(view, 3);

    expect(state.turns).toEqual(["next", "next", "next"]);
  });

  it("向后合并跳转同样落到目标页", async () => {
    const { view, state } = fakeView({ pages: 100, page: 40 });

    await jumpPages(view, -6);

    expect(Math.round(state.goes[0].anchor * (state.pages - 3)) + 1).toBe(34);
    expect(state.turns).toEqual([]);
  });
});