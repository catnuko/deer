// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReaderToc } from "./ReaderToc";
import {
  TOC_DEFAULT_WIDTH,
  TOC_MAX_WIDTH,
  TOC_MIN_WIDTH,
  useReaderLayout,
} from "@/store/readerLayout";

const chapters = [
  { index: 0, title: "第一章" },
  { index: 1, title: "第二章" },
];

const baseProps = {
  chapters,
  currentIndex: 0,
  onSelect: () => undefined,
} as const;

beforeEach(() => {
  useReaderLayout.setState({ tocWidth: TOC_DEFAULT_WIDTH });
});

afterEach(cleanup);

/** happy-dom 没有指针捕获实现，拖拽测试用空实现顶掉。 */
function stubPointerCapture(element: Element) {
  Object.assign(element, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  });
}

describe("ReaderToc dock（motion.md M11）", () => {
  it("宽度直接赋值，不挂任何宽度过渡，内容走 120ms 淡入", () => {
    const { container } = render(<ReaderToc {...baseProps} variant="dock" />);
    const aside = container.querySelector("aside");

    expect(aside).not.toBeNull();
    expect(aside!.style.width).toBe(`${TOC_DEFAULT_WIDTH}px`);
    expect(aside!.className).toContain("deer-content-fade");
    expect(aside!.className).not.toContain("transition-[width]");
  });

  it("键盘步进即时改宽：8px、Shift 24px、Home/End 到边界", () => {
    render(<ReaderToc {...baseProps} variant="dock" />);
    const separator = screen.getByRole("separator", {
      name: "调整目录宽度",
    });

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_DEFAULT_WIDTH + 8);

    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true });
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_DEFAULT_WIDTH + 32);

    fireEvent.keyDown(separator, { key: "End" });
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_MAX_WIDTH);

    fireEvent.keyDown(separator, { key: "Home" });
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_MIN_WIDTH);
  });

  it("拖拽期间分隔条颜色过渡归零，松手后恢复", () => {
    render(<ReaderToc {...baseProps} variant="dock" />);
    const separator = screen.getByRole("separator", {
      name: "调整目录宽度",
    });
    stubPointerCapture(separator);

    expect(separator.className).toContain("after:transition-colors");
    expect(separator.className).not.toContain("after:transition-none");

    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 300 });
    expect(separator.className).toContain("after:transition-none");

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 340 });
    expect(useReaderLayout.getState().tocWidth).toBe(TOC_DEFAULT_WIDTH + 40);

    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(separator.className).not.toContain("after:transition-none");
  });

  it("sheet 变体不写死宽度，也不套 dock 的内容淡入", () => {
    const { container } = render(<ReaderToc {...baseProps} variant="sheet" />);
    const aside = container.querySelector("aside");

    expect(aside!.style.width).toBe("");
    expect(aside!.className).not.toContain("deer-content-fade");
    expect(
      screen.queryByRole("separator", { name: "调整目录宽度" }),
    ).toBeNull();
  });
});