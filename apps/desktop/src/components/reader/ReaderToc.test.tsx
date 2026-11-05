// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderToc } from "./ReaderToc";

afterEach(cleanup);

const chapters = [
  { index: 0, title: "第一章" },
  { index: 1, title: "第二章" },
];

describe("ReaderToc", () => {
  it("列出全部章节，当前章带 aria-current", () => {
    render(
      <ReaderToc chapters={chapters} currentIndex={1} onSelect={() => undefined} />,
    );

    const current = screen.getByRole("button", { name: "第二章" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "第一章" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("点章节把章序号交给 onSelect", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ReaderToc chapters={chapters} currentIndex={0} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: "第二章" }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("空目录显示空态", () => {
    render(<ReaderToc chapters={[]} currentIndex={0} onSelect={() => undefined} />);
    expect(screen.getByText("本书没有目录")).toBeInTheDocument();
  });
});
