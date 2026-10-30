// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBytes, formatDate } from "@/lib/format";
import type { Book, Shelf } from "@/lib/types";
import { BookCard } from "./BookCard";

const SHELVES: Shelf[] = [
  { id: "shelf-1", name: "科幻", order: 0 },
  { id: "shelf-2", name: "在读", order: 1 },
];

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "三体",
    author: "刘慈欣",
    format: "epub",
    filePath: "/books/santi.epub",
    sizeBytes: 1_500_000,
    addedAt: new Date("2026-01-15T08:00:00Z").getTime(),
    progress: 0,
    shelfIds: ["shelf-1"],
    tags: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("BookCard", () => {
  it("显示书名、作者和大小/日期元信息", () => {
    const book = makeBook();
    render(
      <BookCard
        book={book}
        shelves={SHELVES}
        onOpen={() => {}}
        onToggleShelf={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "三体" })).toBeInTheDocument();
    expect(screen.getByText("刘慈欣")).toBeInTheDocument();
    expect(
      screen.getByText(`${formatBytes(book.sizeBytes)} · ${formatDate(book.addedAt)}`),
    ).toBeInTheDocument();
  });

  it("没有封面时用书名首字做占位封面", () => {
    render(
      <BookCard
        book={makeBook()}
        shelves={[]}
        onOpen={() => {}}
        onToggleShelf={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("三")).toBeInTheDocument();
  });

  it("点封面触发 onOpen 并带上整本书", async () => {
    const onOpen = vi.fn();
    const book = makeBook();
    const user = userEvent.setup();
    render(
      <BookCard
        book={book}
        shelves={[]}
        onOpen={onOpen}
        onToggleShelf={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "阅读《三体》" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(book);
  });

  it("阅读进度大于 0 时显示进度条", () => {
    const { container } = render(
      <BookCard
        book={makeBook({ progress: 0.5 })}
        shelves={[]}
        onOpen={() => {}}
        onToggleShelf={() => {}}
        onDelete={() => {}}
      />,
    );

    const bar = container.querySelector<HTMLElement>("div[style]");
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe("50%");
  });

  it("菜单里展示书架归属：在架的打勾，点另一个书架触发 onToggleShelf", async () => {
    const onToggleShelf = vi.fn();
    const book = makeBook(); // shelfIds 含 shelf-1
    const user = userEvent.setup();
    render(
      <BookCard
        book={book}
        shelves={SHELVES}
        onOpen={() => {}}
        onToggleShelf={onToggleShelf}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "《三体》更多操作" }));
    await user.click(await screen.findByText("在读"));
    expect(onToggleShelf).toHaveBeenCalledWith(book, SHELVES[1]);
  });

  it("菜单里点「删除书籍」触发 onDelete", async () => {
    const onDelete = vi.fn();
    const book = makeBook();
    const user = userEvent.setup();
    render(
      <BookCard
        book={book}
        shelves={[]}
        onOpen={() => {}}
        onToggleShelf={() => {}}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "《三体》更多操作" }));
    await user.click(await screen.findByText("删除书籍"));
    expect(onDelete).toHaveBeenCalledWith(book);
  });

  it("shelves 为空时菜单显示「还没有书架」占位", async () => {
    const user = userEvent.setup();
    render(
      <BookCard
        book={makeBook()}
        shelves={[]}
        onOpen={() => {}}
        onToggleShelf={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "《三体》更多操作" }));
    expect(await screen.findByText("还没有书架")).toBeInTheDocument();
  });
});
