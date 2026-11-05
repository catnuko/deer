import { describe, expect, it } from "vitest";
import {
  SELECTION_MAX_CHARS,
  formatSelectionDraft,
  popoverPlacement,
  fitPopover,
  selectionTextOf,
} from "./selectionDraft";

describe("selectionTextOf", () => {
  it("没有 Selection、rangeCount 为 0、或折叠选区时都返回空串", () => {
    expect(selectionTextOf(null)).toBe("");
    expect(selectionTextOf(undefined)).toBe("");
    expect(selectionTextOf({ rangeCount: 0, toString: () => "不该被读到" })).toBe("");
    expect(
      selectionTextOf({ rangeCount: 1, toString: () => "" }),
    ).toBe("");
  });

  it("正常选区原样返回文本", () => {
    expect(
      selectionTextOf({ rangeCount: 1, toString: () => "给岁月以文明" }),
    ).toBe("给岁月以文明");
  });
});

describe("formatSelectionDraft", () => {
  it("常规选区整进引用块，末尾留提问引导", () => {
    expect(formatSelectionDraft("弱小和无知不是生存的障碍，傲慢才是")).toEqual({
      draft:
        "我划选了这段：\n\n「弱小和无知不是生存的障碍，傲慢才是」\n\n想问：",
      truncated: false,
    });
  });

  it("首尾空白剥掉、内部换行压成空格，纯空白选区不发", () => {
    expect(formatSelectionDraft("  第一行\n\n第二行  ")).toEqual({
      draft: "我划选了这段：\n\n「第一行 第二行」\n\n想问：",
      truncated: false,
    });
    for (const blank of ["", "   ", " \n\t "]) {
      expect(formatSelectionDraft(blank)).toBeNull();
    }
  });

  it("超过上限按码点截断，附省略号与说明（中文一个字就是一个码点）", () => {
    const text = "字".repeat(SELECTION_MAX_CHARS + 37);
    const result = formatSelectionDraft(text);
    expect(result?.truncated).toBe(true);
    expect(result?.draft).toContain("……");
    expect(result?.draft).toContain(
      `（选区过长，只带前 ${SELECTION_MAX_CHARS} 字）`,
    );
    // 引用块里正好是 limit 个字 + 省略号，不把说明混进引用。
    expect(result?.draft).toContain(
      `「${"字".repeat(SELECTION_MAX_CHARS)}……」`,
    );
  });

  it("代理对（emoji）不被截成半个", () => {
    // 499 个字 + 1 个占两码元位置的 emoji：按码点数没超限，不截断。
    const text = "读".repeat(SELECTION_MAX_CHARS - 1) + "📚";
    const result = formatSelectionDraft(text);
    expect(result?.truncated).toBe(false);
    expect(result?.draft).toContain("📚」");

    // emoji 本身在截断点上也不裂开。
    const split = "读".repeat(SELECTION_MAX_CHARS) + "📚📚";
    const truncated = formatSelectionDraft(split);
    expect(truncated?.draft).toContain(
      `「${"读".repeat(SELECTION_MAX_CHARS)}……」`,
    );
  });

  it("limit 可注入，方便小数字直接测截断路径", () => {
    expect(formatSelectionDraft("一二三四五", 3)).toEqual({
      draft: "我划选了这段：\n\n「一二三……」（选区过长，只带前 3 字）\n\n想问：",
      truncated: true,
    });
    expect(formatSelectionDraft("一二三", 3)?.truncated).toBe(false);
  });
});

describe("popoverPlacement", () => {
  const host = { top: 0, left: 0, width: 800 };

  it("浮层水平居中于选区，选区够靠下时放上方、留 8px 间距", () => {
    expect(
      popoverPlacement({ top: 300, left: 300, width: 200, height: 60 }, host),
    ).toEqual({
      x: 400,
      y: 292,
      placement: "above",
      selTop: 300,
      selBottom: 360,
    });
  });

  it("选区贴近顶部时改放下方", () => {
    expect(
      popoverPlacement({ top: 20, left: 300, width: 200, height: 60 }, host),
    ).toEqual({
      x: 400,
      y: 88,
      placement: "below",
      selTop: 20,
      selBottom: 80,
    });
  });

  it("居中点落在容器边缘留白内时被夹回（窄选区贴边）", () => {
    expect(
      popoverPlacement({ top: 300, left: 0, width: 20, height: 20 }, host),
    ).toMatchObject({ x: 48, placement: "above" });
    expect(
      popoverPlacement({ top: 300, left: 790, width: 20, height: 20 }, host),
    ).toMatchObject({ x: 752, placement: "above" });
  });

  it("宿主坐标不从零开始时按相对位置折算", () => {
    // rect 相对宿主 selTop = 60 > 40 → 上方，y = 60 - 8。
    expect(
      popoverPlacement(
        { top: 540, left: 1100, width: 100, height: 40 },
        { top: 480, left: 1000, width: 400 },
      ),
    ).toEqual({
      x: 150,
      y: 52,
      placement: "above",
      selTop: 60,
      selBottom: 100,
    });
  });
});

describe("fitPopover", () => {
  const host = { width: 800, height: 600 };
  const popup = { width: 280, height: 96 };

  it("选区上方放得下就优先上方，水平居中", () => {
    expect(
      fitPopover({ top: 300, bottom: 360, centerX: 400 }, host, popup),
    ).toEqual({ left: 260, top: 196, placement: "above" });
  });

  it("上方放不下翻下方", () => {
    expect(
      fitPopover({ top: 60, bottom: 100, centerX: 400 }, host, popup),
    ).toEqual({ left: 260, top: 108, placement: "below" });
  });

  it("两边都放不下取空间更大的一侧，并夹在宿主内", () => {
    // 紧贴顶部：上方空间 8-8=0 < 需求，下方放得下 → 下方（此处上方更小仍走下方）。
    const tight = fitPopover({ top: 12, bottom: 40, centerX: 400 }, host, popup);
    expect(tight.placement).toBe("below");
    // 选区贴近底部：下方放不下 → 翻上方。
    const bottom = fitPopover({ top: 520, bottom: 580, centerX: 400 }, host, popup);
    expect(bottom.placement).toBe("above");
  });

  it("水平居中点越出宿主边缘时夹回 8px 边距", () => {
    const fitted = fitPopover({ top: 300, bottom: 360, centerX: 20 }, host, popup);
    expect(fitted.left).toBe(8);
    const right = fitPopover({ top: 300, bottom: 360, centerX: 790 }, host, popup);
    expect(right.left).toBe(800 - 280 - 8);
  });
});
