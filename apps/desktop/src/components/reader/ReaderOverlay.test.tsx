// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderOverlay } from "./ReaderOverlay";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ReaderOverlay", () => {
  it("关闭时不渲染，打开后带进入类", () => {
    const { rerender } = render(
      <ReaderOverlay open={false} onClose={vi.fn()}>
        <p>面板</p>
      </ReaderOverlay>,
    );
    expect(screen.queryByText("面板")).toBeNull();

    rerender(
      <ReaderOverlay open onClose={vi.fn()}>
        <p>面板</p>
      </ReaderOverlay>,
    );
    const surface = screen.getByText("面板").parentElement;
    expect(surface?.className).toContain("deer-overlay-in-drop");
  });

  it("user 关闭播 150ms 退场后再摘除", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ReaderOverlay open exit="panel" onClose={vi.fn()}>
        <p>面板</p>
      </ReaderOverlay>,
    );

    act(() => {
      rerender(
        <ReaderOverlay open={false} exit="panel" onClose={vi.fn()}>
          <p>面板</p>
        </ReaderOverlay>,
      );
    });
    const surface = screen.getByText("面板").parentElement;
    expect(surface?.className).toContain("deer-overlay-out-drop");
    expect(screen.queryByText("面板")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByText("面板")).toBeNull();
  });

  it("navigation 关闭（immediate）立即摘除，不播退场", () => {
    const { rerender } = render(
      <ReaderOverlay open exit="panel" onClose={vi.fn()}>
        <p>面板</p>
      </ReaderOverlay>,
    );
    rerender(
      <ReaderOverlay open={false} immediate exit="panel" onClose={vi.fn()}>
        <p>面板</p>
      </ReaderOverlay>,
    );
    expect(screen.queryByText("面板")).toBeNull();
  });

  it("modal 挂到 body，网格居中并带遮罩，退出给遮罩同一节奏", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ReaderOverlay
        open
        modal
        role="dialog"
        exit="panel"
        variant="scale"
        ariaLabel="概念地图"
        className="h-[640px] w-[900px]"
        onClose={vi.fn()}
      >
        <p>面板</p>
      </ReaderOverlay>,
    );

    const panel = screen.getByRole("dialog", { name: "概念地图" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel.className).toContain("deer-overlay-in-scale");
    const wrapper = panel.parentElement;
    expect(wrapper?.className).toContain("place-items-center");
    expect(wrapper?.closest("body")).toBe(document.body);
    expect(wrapper?.querySelector('[aria-hidden="true"]')?.className).toContain(
      "deer-backdrop-in",
    );

    act(() => {
      rerender(
        <ReaderOverlay
          open={false}
          modal
          role="dialog"
          exit="panel"
          variant="scale"
          ariaLabel="概念地图"
          className="h-[640px] w-[900px]"
          onClose={vi.fn()}
        >
          <p>面板</p>
        </ReaderOverlay>,
      );
    });
    expect(panel.className).toContain("deer-overlay-out-scale");
    expect(wrapper?.querySelector('[aria-hidden="true"]')?.className).toContain(
      "deer-backdrop-out",
    );
  });

  it("Esc 与点浮层外关闭，点内部不关", () => {
    const onClose = vi.fn();
    render(
      <ReaderOverlay open closeOnOutside onClose={onClose}>
        <button type="button">内部按钮</button>
      </ReaderOverlay>,
    );

    act(() => {
      screen.getByText("内部按钮").click();
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});