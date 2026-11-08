// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatBytes } from "@/lib/format";
import type { Book } from "@/lib/types";
import {
  useAnnotationStore,
  type StoredAnnotation,
} from "@/store/annotationStore";
import { BookDetailView } from "./BookDetailView";
import { filterNotes } from "./noteFilters";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "三国演义",
    author: "罗贯中",
    format: "epub",
    filePath: "/books/sanguo.epub",
    sizeBytes: 2_800_000,
    addedAt: new Date(2026, 9, 28).getTime(),
    lastOpenedAt: new Date(2026, 10, 4).getTime(),
    progress: 0.1,
    shelfIds: [],
    tags: [],
    ...overrides,
  };
}

const HL_WITH_CFI: StoredAnnotation = {
  id: "anno-1",
  cfi: "epubcfi(/6/4)",
  color: "#FBBF24",
  excerpt: "话说天下大势，分久必合，合久必分。",
  note: "开篇即全书总纲。",
  createdAt: new Date(2026, 10, 3).getTime(),
};

const HL_NO_CFI: StoredAnnotation = {
  id: "anno-2",
  color: "#FBBF24",
  excerpt: "宁教我负天下人，休教天下人负我。",
  createdAt: new Date(2026, 10, 1).getTime(),
};

const AI_NOTE: StoredAnnotation = {
  id: "anno-3",
  color: "#94A3B8",
  excerpt: "曹操明知刘备是英雄，为什么还放他走？",
  note: "曹操放走刘备并非单纯失策。",
  source: "ai",
  createdAt: new Date(2026, 10, 5).getTime(),
};

beforeEach(() => {
  // 挂载会触发 load()：换成桩，避免它异步读 localStorage 冲掉测试灌入的笔记。
  useAnnotationStore.setState({
    annotations: {},
    ready: true,
    load: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(cleanup);

function renderDetail(book: Book = makeBook()) {
  const props = {
    onBack: vi.fn(),
    onContinueRead: vi.fn(),
    onLocate: vi.fn(),
    onRemove: vi.fn(),
  };
  render(
    <BookDetailView book={book} variant="page" {...props} />,
  );
  return props;
}

describe("filterNotes", () => {
  const notes = [HL_WITH_CFI, HL_NO_CFI, AI_NOTE];

  it("all 全量，hl 只留非 AI，ai 只留 AI", () => {
    expect(filterNotes(notes, "all")).toEqual(notes);
    expect(filterNotes(notes, "hl")).toEqual([HL_WITH_CFI, HL_NO_CFI]);
    expect(filterNotes(notes, "ai")).toEqual([AI_NOTE]);
  });
});

describe("BookDetailView 基本信息与操作", () => {
  it("渲染书名、作者、格式、文件大小、加入书架与阅读进度", () => {
    renderDetail();

    expect(screen.getByRole("heading", { name: "三国演义" })).toBeInTheDocument();
    expect(screen.getAllByText("罗贯中").length).toBeGreaterThan(0);
    expect(screen.getByText("EPUB")).toBeInTheDocument();
    expect(screen.getByText(formatBytes(2_800_000))).toBeInTheDocument();
    expect(
      screen.getAllByText(formatDate(makeBook().addedAt)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/已读 10%/)).toBeInTheDocument();
  });

  it("点「返回书架」触发 onBack；Esc 同效", async () => {
    const props = renderDetail();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "返回书架" }));
    expect(props.onBack).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape" }),
    );
    expect(props.onBack).toHaveBeenCalledTimes(2);
  });

  it("整页形态进入后焦点落在「返回书架」", async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "返回书架" })).toHaveFocus(),
    );
  });

  it("浮层形态不监听 Esc、不抢焦点", () => {
    render(
      <BookDetailView
        book={makeBook()}
        variant="sheet"
        onBack={() => {}}
        onContinueRead={() => {}}
        onLocate={() => {}}
        onRemove={() => {}}
      />,
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: "返回书架" }),
    );
  });

  it("顶栏与左栏的「继续阅读」都触发 onContinueRead；「从书架移除」触发 onRemove", async () => {
    const props = renderDetail();
    const user = userEvent.setup();

    const buttons = screen.getAllByRole("button", { name: "继续阅读" });
    expect(buttons.length).toBe(2);
    await user.click(buttons[0]!);
    expect(props.onContinueRead).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "从书架移除" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it("没有封面时用书名首字占位", () => {
    const { container } = render(
      <BookDetailView
        book={makeBook()}
        variant="page"
        onBack={() => {}}
        onContinueRead={() => {}}
        onLocate={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("三")).toBeInTheDocument();
  });
});

describe("BookDetailView 笔记列表", () => {
  it("笔记未就绪时显示加载骨架", () => {
    useAnnotationStore.setState({ annotations: {}, ready: false });
    renderDetail();
    expect(screen.getByRole("status", { name: "笔记加载中" })).toBeInTheDocument();
  });

  it("无笔记时显示空状态引导", () => {
    renderDetail();
    expect(screen.getByText("还没有笔记")).toBeInTheDocument();
    expect(
      screen.getByText("去阅读页划选一段文字，或问 AI 一个问题试试"),
    ).toBeInTheDocument();
  });

  it("筛选切换：全部 / 划线与笔记 / AI 笔记 各自只显示对应卡片", async () => {
    useAnnotationStore.setState({
      annotations: { "book-1": [HL_WITH_CFI, HL_NO_CFI, AI_NOTE] },
      ready: true,
    });
    renderDetail();
    const user = userEvent.setup();

    expect(screen.getByText("笔记与摘录（3）")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全部 3", selected: true })).toBeInTheDocument();
    expect(screen.getByText(HL_WITH_CFI.excerpt!)).toBeInTheDocument();
    expect(screen.getByText(AI_NOTE.excerpt!)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "AI 笔记 1" }));
    expect(screen.queryByText(HL_WITH_CFI.excerpt!)).not.toBeInTheDocument();
    expect(screen.getByText(AI_NOTE.excerpt!)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "划线与笔记 2" }));
    expect(screen.queryByText(AI_NOTE.excerpt!)).not.toBeInTheDocument();
    expect(screen.getByText(HL_NO_CFI.excerpt!)).toBeInTheDocument();
  });

  it("划线卡：摘录 + 我的笔记 + 「在书中查看」跳原文", async () => {
    useAnnotationStore.setState({
      annotations: { "book-1": [HL_WITH_CFI] },
      ready: true,
    });
    const props = renderDetail();
    const user = userEvent.setup();

    expect(screen.getByText("划线 · 笔记")).toBeInTheDocument();
    expect(screen.getByText("我的笔记")).toBeInTheDocument();

    const locate = screen.getByRole("button", { name: /在书中查看/ });
    await user.click(locate);
    expect(props.onLocate).toHaveBeenCalledWith(HL_WITH_CFI.cfi);
  });

  it("无 CFI 的划线卡不渲染「在书中查看」", () => {
    useAnnotationStore.setState({
      annotations: { "book-1": [HL_NO_CFI] },
      ready: true,
    });
    renderDetail();

    expect(screen.getByText("划线")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /在书中查看/ })).not.toBeInTheDocument();
  });

  it("AI 卡：徽标 + 提问片段 + AI 总结 + 来源行，无原文跳转", () => {
    useAnnotationStore.setState({
      annotations: { "book-1": [AI_NOTE] },
      ready: true,
    });
    renderDetail();

    expect(screen.getByText("AI 总结")).toBeInTheDocument();
    expect(screen.getByText("我问过 AI")).toBeInTheDocument();
    expect(screen.getByText("AI 总结的笔记")).toBeInTheDocument();
    expect(screen.getByText("来自 AI 伴读对话")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /在书中查看/ })).not.toBeInTheDocument();
  });

  it("筛选分类下没有笔记时给出分类空态", async () => {
    useAnnotationStore.setState({
      annotations: { "book-1": [HL_WITH_CFI] },
      ready: true,
    });
    renderDetail();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "AI 笔记 0" }));
    expect(screen.getByText("这个分类下还没有笔记。")).toBeInTheDocument();
  });
});
