// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBytes, formatDate } from "@/lib/format";
import type { Book, Folder } from "@/lib/types";
import { BookCard } from "./BookCard";

const FOLDERS: Folder[] = [
  { id: "folder-1", name: "科幻", order: 1 },
  { id: "folder-2", name: "在读", order: 2 },
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
    folderId: "folder-1",
    tags: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("BookCard", () => {
  it("只显示书名（单行截断）和作者，不再有大小/日期行", () => {
    const book = makeBook();
    render(
      <BookCard
        book={book}
        folders={FOLDERS}
        onOpen={() => {}}
        onMoveToFolder={() => {}}
        onDelete={() => {}}
      />,
    );

    const title = screen.getByRole("heading", { name: "三体" });
    expect(title).toBeInTheDocument();
    expect(title.className).toContain("truncate");
    expect(screen.getByText("刘慈欣")).toBeInTheDocument();
    expect(
      screen.queryByText(`${formatBytes(book.sizeBytes)} · ${formatDate(book.addedAt)}`),
    ).not.toBeInTheDocument();
  });

  it("卡片带 deer-lift 钩子与悬浮加深阴影，减少动态效果下抬升由它取消（D-05）", () => {
    render(
      <BookCard
        book={makeBook()}
        folders={FOLDERS}
        onOpen={() => {}}
        onMoveToFolder={() => {}}
        onDelete={() => {}}
      />,
    );

    const card = screen.getByRole("heading", { name: "三体" }).closest(".deer-lift");
    expect(card).toBeTruthy();
    expect(card?.className).toContain("hover:-translate-y-0.5");
    expect(card?.className).toContain("hover:shadow-lg");
  });

  it("没有封面时用书名首字做占位封面", () => {
    render(
      <BookCard
        book={makeBook()}
        folders={[]}
        onOpen={() => {}}
        onMoveToFolder={() => {}}
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
        folders={[]}
        onOpen={onOpen}
        onMoveToFolder={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "打开《三体》详情" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(book);
  });

  it("菜单里点「阅读」优先走 onRead（直达阅读页），点封面仍走 onOpen", async () => {
    const onOpen = vi.fn();
    const onRead = vi.fn();
    const book = makeBook();
    const user = userEvent.setup();
    render(
      <BookCard
        book={book}
        folders={[]}
        onOpen={onOpen}
        onRead={onRead}
        onMoveToFolder={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "《三体》更多操作" }));
    await user.click(await screen.findByText("阅读"));
    expect(onRead).toHaveBeenCalledOnce();
    expect(onRead).toHaveBeenCalledWith(book);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("阅读进度大于 0 时显示进度条", () => {
    const { container } = render(
      <BookCard
        book={makeBook({ progress: 0.5 })}
        folders={[]}
        onOpen={() => {}}
        onMoveToFolder={() => {}}
        onDelete={() => {}}
      />,
    );

    const bar = container.querySelector<HTMLElement>("div[style]");
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe("50%");
  });

  it("菜单里的「移动到文件夹」单选：当前项打勾，点别的文件夹触发 onMoveToFolder", async () => {
    const onMoveToFolder = vi.fn();
    const book = makeBook(); // folderId = folder-1
    const user = userEvent.setup();
    render(
      <BookCard
        book={book}
        folders={FOLDERS}
        onOpen={() => {}}
        onMoveToFolder={onMoveToFolder}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "《三体》更多操作" }));
    expect(await screen.findByText("移动到文件夹")).toBeInTheDocument();
    await user.click(await screen.findByText("在读"));
    expect(onMoveToFolder).toHaveBeenCalledWith(book, "folder-2");
  });

  it("菜单里的「未分类」把书移出文件夹", async () => {
    const onMoveToFolder = vi.fn();
    const user = userEvent.setup();
    render(
      <BookCard
        book={makeBook()}
        folders={FOLDERS}
        onOpen={() => {}}
        onMoveToFolder={onMoveToFolder}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "《三体》更多操作" }));
    await user.click(await screen.findByText("未分类"));
    expect(onMoveToFolder).toHaveBeenCalledWith(makeBook(), null);
  });

  it("菜单里点「删除书籍」触发 onDelete", async () => {
    const onDelete = vi.fn();
    const book = makeBook();
    const user = userEvent.setup();
    render(
      <BookCard
        book={book}
        folders={[]}
        onOpen={() => {}}
        onMoveToFolder={() => {}}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "《三体》更多操作" }));
    await user.click(await screen.findByText("删除书籍"));
    expect(onDelete).toHaveBeenCalledWith(book);
  });

  it("没有文件夹时「移动到文件夹」仍保留「未分类」一项", async () => {
    const user = userEvent.setup();
    render(
      <BookCard
        book={makeBook()}
        folders={[]}
        onOpen={() => {}}
        onMoveToFolder={() => {}}
        onDelete={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "《三体》更多操作" }));
    expect(await screen.findByText("未分类")).toBeInTheDocument();
  });
});
