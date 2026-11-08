import { describe, expect, it } from "vitest";
import { toggleOverlayPair, type OverlayPair } from "./overlayPair";

const closed: OverlayPair = {
  quickSettings: { open: false, immediate: false },
  conceptMap: { open: false, immediate: false },
  briefing: { open: false, immediate: false },
};

const open = (slot: keyof OverlayPair): OverlayPair => ({
  ...closed,
  [slot]: { open: true, immediate: false },
});

describe("toggleOverlayPair", () => {
  it("打开显示设置时其余浮层立即摘除（G8：不播退场、不并存）", () => {
    const next = toggleOverlayPair(open("conceptMap"), "quickSettings");
    expect(next.quickSettings).toEqual({ open: true, immediate: false });
    expect(next.conceptMap).toEqual({ open: false, immediate: true });
    expect(next.briefing).toEqual({ open: false, immediate: true });
  });

  it("打开概念地图时显示设置立即摘除（对称）", () => {
    const next = toggleOverlayPair(open("quickSettings"), "conceptMap");
    expect(next.conceptMap).toEqual({ open: true, immediate: false });
    expect(next.quickSettings).toEqual({ open: false, immediate: true });
  });

  it("打开开读简报时另外两个浮层同时摘除", () => {
    const prev: OverlayPair = {
      quickSettings: { open: true, immediate: false },
      conceptMap: { open: false, immediate: true },
      briefing: { open: false, immediate: false },
    };
    const next = toggleOverlayPair(prev, "briefing");
    expect(next.briefing).toEqual({ open: true, immediate: false });
    expect(next.quickSettings).toEqual({ open: false, immediate: true });
    expect(next.conceptMap).toEqual({ open: false, immediate: true });
  });

  it("用户自己关闭仍走 150ms 退场（immediate 置回 false）", () => {
    const next = toggleOverlayPair(open("quickSettings"), "quickSettings");
    expect(next.quickSettings).toEqual({ open: false, immediate: false });
  });

  it("被互斥关闭的一方重新打开时 immediate 复位", () => {
    const afterMutual = toggleOverlayPair(open("quickSettings"), "conceptMap");
    expect(afterMutual.quickSettings.immediate).toBe(true);

    const reopened = toggleOverlayPair(afterMutual, "quickSettings");
    expect(reopened.quickSettings).toEqual({ open: true, immediate: false });
    // 复位后用户关闭它，仍然播退场动画。
    expect(toggleOverlayPair(reopened, "quickSettings").quickSettings.immediate).toBe(
      false,
    );
  });

  it("三个浮层同时只开一个", () => {
    let state: OverlayPair = closed;
    for (const slot of [
      "quickSettings",
      "conceptMap",
      "briefing",
      "quickSettings",
    ] as const) {
      state = toggleOverlayPair(state, slot);
      const openCount =
        Number(state.quickSettings.open) +
        Number(state.conceptMap.open) +
        Number(state.briefing.open);
      expect(openCount).toBe(1);
    }
  });
});
