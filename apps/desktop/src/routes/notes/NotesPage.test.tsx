// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { Book } from "@/lib/types";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { NotesPage } from "./NotesPage";

afterEach(cleanup);

const book: Book = {
  id: "book-1",
  title: "三体",
  author: "刘慈欣",
  format: "epub",
  filePath: "/books/book-1.epub",
  sizeBytes: 2048,
  addedAt: 1000,
  shelfIds: [],
  tags: [],
  progress: 0,
};

function seedStores() {
  // load() 会从 localStorage 重读并盖掉 setState，测试里替换成空操作。
  useBookStore.setState({ books: [book], shelves: [], ready: true, load: async () => {} });
  useAnnotationStore.setState({
    annotations: {
      "book-1": [
        {
          id: "a1",
          cfi: "epubcfi(/6/4!/4/2,/1:0,/1:6)",
          color: "#fbbf24",
          excerpt: "给岁月以文明",
          note: "很喜欢这句",
          createdAt: new Date("2026-10-31T10:00:00").getTime(),
        },
        {
          id: "a2",
          cfi: "epubcfi(/6/6!/4/2,/1:0,/1:6)",
          color: "#93c5fd",
          createdAt: new Date("2026-10-31T11:00:00").getTime(),
        },
      ],
    },
    ready: true,
    load: async () => {},
  });
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/notes"]}>
      <Routes>
        <Route path="/notes" element={<NotesPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NotesPage", () => {
  it("按书分组展示摘录、笔记内容和时间，条目可跳转", () => {
    seedStores();
    renderPage();

    expect(screen.getByText("《三体》")).toBeInTheDocument();
    expect(screen.getByText("给岁月以文明")).toBeInTheDocument();
    expect(screen.getByText("很喜欢这句")).toBeInTheDocument();
    expect(screen.getByText("2026-10-31 11:00")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "跳到《三体》中的这条笔记" }),
    ).toHaveLength(2);
  });

  it("点条目带上书 id 和 CFI 跳去阅读页", async () => {
    seedStores();
    renderPage();

    await userEvent.click(
      screen.getAllByRole("button", { name: "跳到《三体》中的这条笔记" })[0],
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/reader?book=${encodeURIComponent("book-1")}&cfi=${encodeURIComponent("epubcfi(/6/4!/4/2,/1:0,/1:6)")}`,
    );
  });

  it("列表内删除条目后不再显示", async () => {
    seedStores();
    renderPage();

    expect(screen.getByText("给岁月以文明")).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", {
        name: "删除《三体》中的这条笔记",
      })[0],
    );
    expect(screen.queryByText("给岁月以文明")).not.toBeInTheDocument();
    // 纯摘录条目还在，说明删的是这一条而不是整本书的列表。
    expect(screen.getByText("（无文本摘录）")).toBeInTheDocument();
  });

  it("没有任何笔记时显示空态引导", () => {
    useBookStore.setState({ books: [book], shelves: [], ready: true, load: async () => {} });
    useAnnotationStore.setState({ annotations: {}, ready: true, load: async () => {} });
    renderPage();

    expect(screen.getByText("还没有任何笔记。")).toBeInTheDocument();
    expect(screen.queryByText("《三体》")).not.toBeInTheDocument();
  });

  it("AI 笔记带 AI 徽标、点击不跳原文，删除照常", async () => {
    useBookStore.setState({ books: [book], shelves: [], ready: true, load: async () => {} });
    useAnnotationStore.setState({
      annotations: {
        "book-1": [
          {
            id: "ai-1",
            color: "#94A3B8",
            excerpt: "这个章节讲了什么？",
            note: "本章讲了宇宙社会学",
            source: "ai",
            createdAt: new Date("2026-11-01T09:00:00").getTime(),
          },
        ],
      },
      ready: true,
      load: async () => {},
    });
    renderPage();

    expect(screen.getByText("本章讲了宇宙社会学")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    // 无 CFI：没有「跳原文」按钮，点击条目也不发生导航。
    expect(
      screen.queryByRole("button", { name: "跳到《三体》中的这条笔记" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("本章讲了宇宙社会学"));
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();

    // 删除通路对 AI 笔记照常生效。
    await userEvent.click(
      screen.getByRole("button", { name: "删除《三体》中的这条笔记" }),
    );
    expect(screen.queryByText("本章讲了宇宙社会学")).not.toBeInTheDocument();
  });
});
