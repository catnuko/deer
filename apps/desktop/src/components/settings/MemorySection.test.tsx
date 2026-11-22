// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemorySection } from "./MemorySection";
import { useBookStore } from "@/store/bookStore";
import { useMemoryStore } from "@/store/memoryStore";

function book(id: string, title: string) {
  return {
    id,
    title,
    author: "作者",
    format: "epub" as const,
    filePath: `/books/${id}.epub`,
    sizeBytes: 1024,
    addedAt: 1,
    progress: 0,
    tags: [],
  };
}

function seedMemory(
  bookId: string,
  overrides: Partial<{ type: "topic" | "preference" | "progress"; content: string }> = {},
) {
  const now = Date.now();
  return {
    id: `mem_${bookId}_${Math.random().toString(36).slice(2, 8)}`,
    bookId,
    type: "topic" as const,
    content: "在讨论遗忘曲线",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  useBookStore.setState({
    books: [book("b1", "甲书"), book("b2", "乙书")],
    ready: true,
    load: async () => undefined,
  });
  useMemoryStore.setState({ memories: {}, ready: true, load: async () => undefined });
});

afterEach(cleanup);

describe("设置 · 读书记忆区块", () => {
  it("按书分组展示条目（书名、类型、内容），没有记忆时显示空态", () => {
    const { rerender } = render(<MemorySection />);
    expect(screen.getByText("暂无记忆")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清空记忆" })).toBeDisabled();

    useMemoryStore.setState({
      memories: {
        b1: [seedMemory("b1", { type: "preference", content: "喜欢简短回答" })],
        b2: [seedMemory("b2"), seedMemory("b2", { content: "读到第三章" })],
      },
    });
    rerender(<MemorySection />);

    expect(screen.queryByText("暂无记忆")).not.toBeInTheDocument();
    expect(screen.getByText("甲书")).toBeInTheDocument();
    expect(screen.getByText("乙书")).toBeInTheDocument();
    expect(screen.getByText("喜欢简短回答")).toBeInTheDocument();
    expect(screen.getByText("在讨论遗忘曲线")).toBeInTheDocument();
    expect(screen.getByText("读到第三章")).toBeInTheDocument();
    // 类型标签来自注入逻辑共用的 MEMORY_TYPE_LABELS
    expect(screen.getByText(/^偏好 · 更新于/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "清除本书" })).toHaveLength(2);
  });

  it("编辑记忆并保存后，store 立即更新为编辑后的内容", async () => {
    const entry = seedMemory("b1", { content: "旧摘要" });
    useMemoryStore.setState({ memories: { b1: [entry] } });
    const user = userEvent.setup();
    render(<MemorySection />);

    await user.click(screen.getByRole("button", { name: "编辑记忆" }));
    const textarea = screen.getByLabelText("编辑记忆内容") as HTMLTextAreaElement;
    expect(textarea.value).toBe("旧摘要");

    await user.clear(textarea);
    await user.type(textarea, "编辑后的新摘要");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(
        useMemoryStore.getState().listByBook("b1")[0].content,
      ).toBe("编辑后的新摘要");
    });
    expect(screen.getByText("编辑后的新摘要")).toBeInTheDocument();
    expect(screen.queryByLabelText("编辑记忆内容")).not.toBeInTheDocument();
  });

  it("单条删除需二次确认，确认后从 store 移除；取消则保留", async () => {
    const entry = seedMemory("b1");
    useMemoryStore.setState({ memories: { b1: [entry] } });
    const user = userEvent.setup();
    render(<MemorySection />);

    await user.click(screen.getByRole("button", { name: "删除记忆" }));
    expect(screen.getByText("删除这条记忆？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(useMemoryStore.getState().listByBook("b1")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "删除记忆" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(useMemoryStore.getState().listByBook("b1")).toHaveLength(0);
    });
  });

  it("按书清除与全部清除均需二次确认，操作后列表与 store 一致", async () => {
    useMemoryStore.setState({
      memories: {
        b1: [seedMemory("b1")],
        b2: [seedMemory("b2", { content: "乙书记忆" })],
      },
    });
    const user = userEvent.setup();
    render(<MemorySection />);

    // 按书清除：只清甲书
    await user.click(screen.getAllByRole("button", { name: "清除本书" })[0]);
    expect(screen.getByText("清除《甲书》的记忆？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除" }));
    await waitFor(() => {
      expect(useMemoryStore.getState().memories.b1).toBeUndefined();
    });
    expect(useMemoryStore.getState().listByBook("b2")).toHaveLength(1);
    expect(screen.getByText("乙书记忆")).toBeInTheDocument();

    // 全部清除
    await user.click(screen.getByRole("button", { name: "清空记忆" }));
    expect(screen.getByText("清空全部读书记忆？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全部清除" }));
    await waitFor(() => {
      expect(useMemoryStore.getState().memories).toEqual({});
    });
    expect(screen.getByText("暂无记忆")).toBeInTheDocument();
  });
});
