// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataSection } from "./DataSection";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { useChatStore } from "@/store/chatStore";

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
    shelfIds: [],
    tags: [],
  };
}

beforeEach(() => {
  useBookStore.setState({
    books: [book("b1", "甲书"), book("b2", "乙书")],
    ready: true,
    load: async () => undefined,
  });
  useAnnotationStore.setState({
    annotations: {
      b1: [
        {
          id: "a1",
          cfi: "epubcfi(/6/4!/4/2)",
          color: "#FFD60A",
          note: "有笔记",
          createdAt: 1,
        },
        { id: "a2", cfi: "epubcfi(/6/6!/4/2)", color: "#6FB6FF", createdAt: 2 },
      ],
    },
    ready: true,
    load: async () => undefined,
  });
  useChatStore.setState({
    messages: {
      t1: [
        { id: "m1", role: "user", content: "问", createdAt: 1 },
        { id: "m2", role: "assistant", content: "答", createdAt: 2 },
      ],
    },
    ready: true,
    load: async () => undefined,
  });
});

afterEach(cleanup);

describe("设置 · 数据组", () => {
  it("浏览器预览没有数据目录，打开按钮禁用", () => {
    render(<DataSection />);
    expect(screen.getByText("浏览器预览模式无本地数据目录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开文件夹" })).toBeDisabled();
  });

  it("存储概况按书籍、标注、笔记与聊天真实计数", () => {
    const { container } = render(<DataSection />);
    expect(container.textContent).toContain(
      "2 本书 · 2 条标注 · 其中 1 条含笔记 · 1 个会话共 2 条聊天消息",
    );
  });

  it("清空笔记需二次确认，确认后立即清空", async () => {
    const user = userEvent.setup();
    render(<DataSection />);

    await user.click(screen.getByRole("button", { name: "清空笔记" }));
    expect(screen.getByText("清空全部笔记？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认清空" }));
    expect(useAnnotationStore.getState().annotations).toEqual({});
    expect(screen.getByRole("button", { name: "清空笔记" })).toBeDisabled();
  });

  it("取消二次确认不会清空", async () => {
    const user = userEvent.setup();
    render(<DataSection />);

    await user.click(screen.getByRole("button", { name: "清空聊天记录" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(useChatStore.getState().messages.t1).toHaveLength(2);
  });

  it("确认后清空全部聊天记录", async () => {
    const user = userEvent.setup();
    render(<DataSection />);

    await user.click(screen.getByRole("button", { name: "清空聊天记录" }));
    await user.click(screen.getByRole("button", { name: "确认清空" }));
    expect(useChatStore.getState().messages).toEqual({});
    expect(screen.getByRole("button", { name: "清空聊天记录" })).toBeDisabled();
  });
});