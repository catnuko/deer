/** L1 浮层的开关态：immediate=true 表示关闭时不播 150ms 退场，立即摘除。 */
export type OverlayPresence = { open: boolean; immediate: boolean };

export type OverlayPair = {
  quickSettings: OverlayPresence;
  conceptMap: OverlayPresence;
};

export type OverlaySlot = keyof OverlayPair;

/**
 * 显示设置与概念地图互斥开合（motion.md §1.3）。
 *
 * 打开一方时另一方**立即摘除**：容它走 150ms 退场会与新面板并存，期间
 * 旧面板还在拦点击（验收 G8）。immediate 与该浮层的 open 在同一次更新里
 * 落地，壳渲染时读到的就是这次关闭的理由。
 */
export function toggleOverlayPair(prev: OverlayPair, slot: OverlaySlot): OverlayPair {
  const target = prev[slot];
  if (target.open) {
    return { ...prev, [slot]: { open: false, immediate: false } };
  }
  const other: OverlaySlot = slot === "quickSettings" ? "conceptMap" : "quickSettings";
  return {
    ...prev,
    [slot]: { open: true, immediate: false },
    [other]: { open: false, immediate: true },
  };
}