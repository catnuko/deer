import { describe, expect, it } from "vitest";
import {
  clampProgress,
  positionFlushPatchOf,
  positionPatchOf,
  PROGRESS_SAVE_STEP,
} from "./readingPosition";

describe("clampProgress", () => {
  it.each([
    [-0.2, 0],
    [0.3, 0.3],
    [1.4, 1],
    [Number.NaN, 0],
  ])("clampProgress(%s) → %s", (input, expected) => {
    expect(clampProgress(input)).toBe(expected);
  });
});

describe("positionPatchOf（节流写盘判定）", () => {
  it.each([
    {
      name: "没有 CFI 就不写盘，即使进度跨过阈值",
      last: 0,
      next: { progress: 0.2, cfi: null },
      expected: null,
    },
    {
      name: "进度变化不足一个步长不写盘",
      last: 0,
      next: { progress: PROGRESS_SAVE_STEP / 2, cfi: "epubcfi(/6/4)" },
      expected: null,
    },
    {
      name: "进度跨过步长就带 CFI 写盘",
      last: 0,
      next: { progress: 0.06, cfi: "epubcfi(/6/4)" },
      expected: { progress: 0.06, lastLocationCfi: "epubcfi(/6/4)" },
    },
    {
      name: "越界进度先收敛到 0..1 再写盘",
      last: 0,
      next: { progress: 1.5, cfi: "epubcfi(/6/8)" },
      expected: { progress: 1, lastLocationCfi: "epubcfi(/6/8)" },
    },
    {
      name: "与上次已存进度相同时不写盘",
      last: 0.4,
      next: { progress: 0.4, cfi: "epubcfi(/6/8)" },
      expected: null,
    },
  ])("$name", ({ last, next, expected }) => {
    expect(positionPatchOf(last, next)).toEqual(expected);
  });
});

describe("positionFlushPatchOf（离开阅读页兜底）", () => {
  it.each([
    {
      name: "没有 CFI 就没什么可保存",
      next: { progress: 0.3, cfi: null },
      expected: null,
    },
    {
      name: "有 CFI 就无视节流直接保存最新位置",
      next: { progress: 0.012, cfi: "epubcfi(/6/2!4:8)" },
      expected: { progress: 0.012, lastLocationCfi: "epubcfi(/6/2!4:8)" },
    },
  ])("$name", ({ next, expected }) => {
    expect(positionFlushPatchOf(next)).toEqual(expected);
  });
});
