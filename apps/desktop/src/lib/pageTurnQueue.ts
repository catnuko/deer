/**
 * 翻页请求收口（motion.md M1b）。
 *
 * foliate 分页器用 300ms 串行锁（`paginator.js` 的 `#turnPage`）：滑动档动画
 * 期间到达的 next/prev 直接被丢掉，关闭档也有 100ms 保护间隔。快速连点或
 * 按住方向键时会大量丢键，用户会觉得「点了没反应」。
 *
 * 这里的做法是锁窗口内的请求按页数累加不丢弃，窗口结束后用一次不带
 * animated 的定位把累计页数补上；用户慢下来后立刻恢复逐页动画。
 */

export type TurnQueue = {
  busy: boolean;
  pending: number;
  epoch: number;
};

/** 分页器暴露的翻页所需能力（foliate 的 Renderer 类型没声明页数与 goTo 细节）。 */
export type PagedRendererLike = {
  page?: number;
  pages?: number;
  getContents(): Array<{ index: number }>;
  goTo(target: { index: number; anchor: () => number }): Promise<void>;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
};

export type PageTurnViewLike = {
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  renderer?: PagedRendererLike;
};

export function createTurnQueue(): TurnQueue {
  return { busy: false, pending: 0, epoch: 0 };
}

/** 换书 / 卸载时作废未消化的请求，避免排到下一棵渲染树上。 */
export function resetTurnQueue(queue: TurnQueue): void {
  queue.epoch += 1;
  queue.busy = false;
  queue.pending = 0;
}

/**
 * 发出一次翻页请求：空闲就立即开跑，忙就只累加（正数向前、负数向后，
 * 反向连按会相互抵消）。
 */
export function requestTurn(
  queue: TurnQueue,
  delta: number,
  launch: (delta: number) => Promise<void>,
): void {
  if (queue.busy) {
    queue.pending += delta;
    return;
  }
  void launch(delta);
}

/**
 * 消化一次翻页请求，直到累加值清零。单次翻页失败不阻塞队列，否则一次
 * 异常会让后续所有按键都石沉大海。
 */
export async function drainTurnQueue(
  queue: TurnQueue,
  firstDelta: number,
  step: (delta: number) => Promise<void>,
): Promise<void> {
  const epoch = queue.epoch;
  queue.busy = true;
  try {
    let delta = firstDelta;
    while (delta !== 0 && queue.epoch === epoch) {
      try {
        await step(delta);
      } catch {
        // 见上：吞掉单次失败，继续消化已累计的页数。
      }
      if (queue.epoch !== epoch) break;
      delta = queue.pending;
      queue.pending = 0;
    }
  } finally {
    if (queue.epoch === epoch) queue.busy = false;
  }
}

/**
 * 一次跳 delta 页，不播动画、只落一次 relocate。
 *
 * 页内跳转走 `renderer.goTo({ index, anchor })`：分页器把 fraction 反解成
 * newPage = round(anchor × (pages - 3)) 再 +1，所以
 * anchor = (target - 1) / (pages - 3) 正好落在目标页。跨章（目标越出当前
 * section）的部分摘掉 animated 逐页走完，走完按原状挂回。
 *
 * @returns 是否真的动了位置（到头时为 false）。
 */
export async function jumpPages(
  view: PageTurnViewLike,
  delta: number,
): Promise<boolean> {
  const renderer = view.renderer;
  if (!renderer) return false;

  let pages: number | undefined;
  let page: number | undefined;
  try {
    pages = renderer.pages;
    page = renderer.page;
  } catch {
    pages = undefined;
  }

  if (
    typeof pages !== "number" ||
    typeof page !== "number" ||
    !Number.isFinite(pages) ||
    !Number.isFinite(page) ||
    pages < 4
  ) {
    // 固定版式等拿不到页数的渲染器：逐页走，本来也没有可缓动的动画。
    for (let i = 0; i < Math.abs(delta); i += 1) {
      if (delta > 0) await view.next();
      else await view.prev();
    }
    return true;
  }

  const lastPage = pages - 2;
  const target = Math.max(1, Math.min(lastPage, page + delta));
  const rest = delta - (target - page);
  const moved = target !== page;

  if (moved) {
    const index = renderer.getContents()[0]?.index;
    if (typeof index === "number") {
      await renderer.goTo({
        index,
        anchor: () => (lastPage > 1 ? (target - 1) / (lastPage - 1) : 0),
      });
    }
  }

  if (rest !== 0) {
    const animated = renderer.hasAttribute("animated");
    renderer.removeAttribute("animated");
    try {
      for (let i = 0; i < Math.abs(rest); i += 1) {
        if (rest > 0) await view.next();
        else await view.prev();
      }
    } finally {
      if (animated) renderer.setAttribute("animated", "");
    }
  }

  return moved || rest !== 0;
}