// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Book } from "@/lib/types";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { BookshelfPage } from "./BookshelfPage";

vi.mock("@/lib/platform", () => ({ isTauri: () => true }));

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "三国演义",
    author: "罗贯中",
    format: "epub",
    filePath: "/books/sanguo.epub",
    sizeBytes: 2_800_000,
    addedAt: new Date(2026, 9, 28).getTime(),
    progress: 0.1,
    shelfIds: [],
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  useBookStore.setState({
    books: [makeBook()],
    shelves: [],
    ready: true,
    importing: false,
    error: null,
    // 挂载时的 load() 与测试里的删除都换成桩，不碰 Tauri。
    load: vi.fn().mockResolvedValue(undefined),
    removeBook: vi.fn().mockResolvedValue(undefined),
  });
  useAnnotationStore.setState({ annotations: {}, ready: true });
});

afterEach(cleanup);

function renderShelf() {
  return render(
    <MemoryRouter initialEntries={["/bookshelf"]}>
      <BookshelfPage />
    </MemoryRouter>,
  );
}

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "打开《三国演义》详情" }));
  await screen.findByRole("button", { name: "返回书架" });
}

describe("BookshelfPage 整页详情", () => {
  it("点书籍卡片进入详情，返回后焦点还给来源书卡", async () => {
    const user = userEvent.setup();
    renderShelf();

    await openDetail(user);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "返回书架" })).toHaveFocus(),
    );

    await user.click(screen.getByRole("button", { name: "返回书架" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "打开《三国演义》详情" }),
      ).toHaveFocus(),
    );
  });

  it("Esc 关闭详情并把焦点还给来源书卡", async () => {
    const user = userEvent.setup();
    renderShelf();

    await openDetail(user);
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "打开《三国演义》详情" }),
      ).toHaveFocus(),
    );
    // 覆盖层退场后对辅助技术隐藏
    await waitFor(() =>
      expect(
        screen.getByLabelText("书籍详情页").parentElement,
      ).toHaveAttribute("aria-hidden", "true"),
    );
  });

  it("详情页「从书架移除」走二次确认：取消不删，确认才调用删除", async () => {
    const user = userEvent.setup();
    const removeBook = useBookStore.getState().removeBook as ReturnType<typeof vi.fn>;
    renderShelf();

    await openDetail(user);
    await user.click(screen.getByRole("button", { name: "从书架移除" }));

    expect(await screen.findByText(/删除《三国演义》？/)).toBeInTheDocument();
    expect(screen.getByText(/此操作不可撤销/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(removeBook).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "从书架移除" }));
    await user.click(await screen.findByRole("button", { name: "删除" }));
    await waitFor(() => expect(removeBook).toHaveBeenCalledWith("book-1"));
  });

  it("书卡菜单里的「阅读」不走详情，直接打开阅读页", async () => {
    const user = userEvent.setup();
    renderShelf();

    await user.click(screen.getByRole("button", { name: "《三国演义》更多操作" }));
    await user.click(await screen.findByText("阅读"));
    // 非详情路径下不应出现详情顶栏
    expect(screen.queryByRole("button", { name: "返回书架" })).not.toBeInTheDocument();
  });
});
