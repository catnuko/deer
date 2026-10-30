// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderToolbar } from "./ReaderToolbar";

afterEach(cleanup);

function renderToolbar(props: Parameters<typeof ReaderToolbar>[0]) {
  return render(
    <MemoryRouter>
      <ReaderToolbar {...props} />
    </MemoryRouter>,
  );
}

const BASE = {
  bookTitle: "三体",
  author: "刘慈欣",
  chapterIndex: 2,
  chapterCount: 9,
  fontSize: 17,
  lineHeight: 1.8 as const,
};

describe("ReaderToolbar", () => {
  it("提供 onSummarizeChapter 时显示「总结本章」，点击触发回调", async () => {
    const onSummarizeChapter = vi.fn();
    renderToolbar({ ...BASE, onSummarizeChapter });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "总结本章" }));
    expect(onSummarizeChapter).toHaveBeenCalledOnce();
  });

  it("没提供回调时不显示入口（书架等场景不受影响）", () => {
    renderToolbar(BASE);
    expect(screen.queryByText("总结本章")).not.toBeInTheDocument();
    expect(screen.getByText("第 3 / 9 章")).toBeInTheDocument();
  });
});
