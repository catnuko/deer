// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "@/lib/types";
import { ContinueReadingCard } from "./ContinueReadingCard";

afterEach(cleanup);

const book: Book = {
  id: "book-1",
  title: "三体",
  author: "刘慈欣",
  format: "epub",
  filePath: "/books/book-1.epub",
  sizeBytes: 2048,
  addedAt: 1000,
  lastOpenedAt: 2000,
  progress: 0.42,
  lastLocationCfi: "epubcfi(/6/4)",
  shelfIds: [],
  tags: [],
};

describe("ContinueReadingCard", () => {
  it("显示书名、作者和进度，按钮带可读名", () => {
    render(<ContinueReadingCard book={book} onContinue={() => {}} />);

    expect(screen.getByText("三体")).toBeInTheDocument();
    expect(screen.getByText("刘慈欣")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "继续阅读《三体》" }),
    ).toBeInTheDocument();
  });

  it("点卡片把这本书交给 onContinue", async () => {
    const onContinue = vi.fn();
    render(<ContinueReadingCard book={book} onContinue={onContinue} />);

    await userEvent.click(
      screen.getByRole("button", { name: "继续阅读《三体》" }),
    );
    expect(onContinue).toHaveBeenCalledWith(book);
  });
});
