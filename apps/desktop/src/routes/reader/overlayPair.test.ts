import { describe, expect, it } from "vitest";
import { toggleOverlayPair, type OverlayPair } from "./overlayPair";

const closed: OverlayPair = {
  quickSettings: { open: false, immediate: false },
  conceptMap: { open: false, immediate: false },
};

describe("toggleOverlayPair", () => {
  it("打开显示设置时另一浮层立即摘除（G8：不播退场、不并存）", () => {
    const prev: OverlayPair = {
      quickSettings: { open: false, immediate: false },
      conceptMap: { open: true, immediate: false },
    };
    const next = toggleOverlayPair(prev, "quickSettings");
    expect(next.quickSettings).toEqual({ open: true, immediate: false });
    expect(next.conceptMap).toEqual({ open: false, immediate: true });
  });

  it("打开概念地图时显示设置立即摘除（对称）", () => {
    const prev: OverlayPair = {
      quickSettings: { open: true, immediate: false },
      conceptMap: { open: false, immediate: false },
    };
    const next = toggleOverlayPair(prev, "conceptMap");
    expect(next.conceptMap).toEqual({ open: true, immediate: false });
    expect(next.quickSettings).toEqual({ open: false, immediate: true });
  });

  it("用户自己关闭仍走 150ms 退场（immediate 置回 false）", () => {
    const prev: OverlayPair = {
      quickSettings: { open: true, immediate: false },
      conceptMap: { open: false, immediate: false },
    };
    const next = toggleOverlayPair(prev, "quickSettings");
    expect(next.quickSettings).toEqual({ open: false, immediate: false });
  });

  it("被互斥关闭的一方重新打开时 immediate 复位", () => {
    const afterMutual = toggleOverlayPair(
      { quickSettings: { open: true, immediate: false }, conceptMap: closed.conceptMap },
      "conceptMap",
    );
    expect(afterMutual.quickSettings.immediate).toBe(true);

    const reopened = toggleOverlayPair(afterMutual, "quickSettings");
    expect(reopened.quickSettings).toEqual({ open: true, immediate: false });
    // 复位后用户关闭它，仍然播退场动画。
    expect(toggleOverlayPair(reopened, "quickSettings").quickSettings.immediate).toBe(
      false,
    );
  });

  it("两个浮层同时只开一个", () => {
    let state: OverlayPair = closed;
    for (const slot of ["quickSettings", "conceptMap", "quickSettings"] as const) {
      state = toggleOverlayPair(state, slot);
      const openCount = Number(state.quickSettings.open) + Number(state.conceptMap.open);
      expect(openCount).toBe(1);
    }
  });
});