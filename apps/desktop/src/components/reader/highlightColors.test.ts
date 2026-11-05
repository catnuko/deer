import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  highlightColorOf,
} from "./highlightColors";

describe("HIGHLIGHT_COLORS", () => {
  it("五枚颜色，key 与 value 互不重复", () => {
    expect(HIGHLIGHT_COLORS).toHaveLength(5);
    const keys = HIGHLIGHT_COLORS.map((color) => color.key);
    const values = HIGHLIGHT_COLORS.map((color) => color.value);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("highlightColorOf", () => {
  it("已知颜色原样返回该色", () => {
    expect(highlightColorOf("#82B2F9").key).toBe("blue");
  });

  it("未知、空或缺失的值都退回默认色", () => {
    for (const value of [undefined, null, "", "#NOPE"]) {
      expect(highlightColorOf(value)).toBe(HIGHLIGHT_COLORS[0]);
    }
    expect(DEFAULT_HIGHLIGHT_COLOR).toBe(HIGHLIGHT_COLORS[0]!.value);
  });
});
