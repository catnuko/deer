/** 阅读位置持久化（M5a）：进度节流与写回补丁的纯逻辑，供 ReaderPage 调用。 */

export const PROGRESS_SAVE_STEP = 0.05;

export type ReadingPosition = {
  progress: number; // 0..1
  cfi: string | null;
};

/** 满足节流条件时的 updateBook 补丁；null 表示本轮不值得写盘。 */
export type PositionPatch = { progress: number; lastLocationCfi: string };

export function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
}

/**
 * 进度变化超过 PROGRESS_SAVE_STEP 且有有效 CFI 才写盘，
 * 平时翻页不落库；离开阅读页时由调用方 flush 兜底保存最新位置。
 */
export function positionPatchOf(
  lastSavedProgress: number,
  next: ReadingPosition,
): PositionPatch | null {
  if (!next.cfi) return null;
  const progress = clampProgress(next.progress);
  if (Math.abs(progress - lastSavedProgress) < PROGRESS_SAVE_STEP) return null;
  return { progress, lastLocationCfi: next.cfi };
}

/** 离开阅读页时的兜底补丁：有 CFI 就写，进度用最新值。 */
export function positionFlushPatchOf(
  next: ReadingPosition,
): PositionPatch | null {
  if (!next.cfi) return null;
  return { progress: clampProgress(next.progress), lastLocationCfi: next.cfi };
}
