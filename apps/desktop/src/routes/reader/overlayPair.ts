/** L1 浮层的开关态：immediate=true 表示关闭时不播 150ms 退场，立即摘除。 */
export type OverlayPresence = { open: boolean; immediate: boolean };

export type OverlayPair = {
  quickSettings: OverlayPresence;
  conceptMap: OverlayPresence;
  briefing: OverlayPresence;
};

export type OverlaySlot = keyof OverlayPair;

const SLOTS: OverlaySlot[] = ["quickSettings", "conceptMap", "briefing"];

/**
 * 显示设置、概念地图与开读简报互斥开合（motion.md §1.3）。
 *
 * 打开一方时其余各方**立即摘除**：容它们走 150ms 退场会与新面板并存，期间
 * 旧面板还在拦点击（验收 G8）。immediate 与该浮层的 open 在同一次更新里
 * 落地，壳渲染时读到的就是这次关闭的理由。
 */
export function toggleOverlayPair(prev: OverlayPair, slot: OverlaySlot): OverlayPair {
  const target = prev[slot];
  if (target.open) {
    return { ...prev, [slot]: { open: false, immediate: false } };
  }
  const next: OverlayPair = { ...prev, [slot]: { open: true, immediate: false } };
  for (const other of SLOTS) {
    if (other !== slot) {
      next[other] = { open: false, immediate: true };
    }
  }
  return next;
}