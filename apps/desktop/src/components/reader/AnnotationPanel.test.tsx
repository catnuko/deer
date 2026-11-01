// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredAnnotation } from "@/store/annotationStore";
import { AnnotationPanel } from "./AnnotationPanel";

afterEach(cleanup);

const ANNOTATIONS: StoredAnnotation[] = [
  {
    id: "anno-1",
    cfi: "epubcfi(/6/4!/4/2)",
    color: "#fbbf24",
    excerpt: "被划选的第一段话",
    note: "这里是笔记",
    createdAt: new Date(2026, 9, 31, 8, 5).getTime(),
  },
  {
    id: "anno-2",
    cfi: "epubcfi(/6/6!/4/2)",
    color: "#93c5fd",
    createdAt: new Date(2026, 9, 30, 22, 30).getTime(),
  },
];

const baseProps = {
  annotations: ANNOTATIONS,
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
};

describe("AnnotationPanel", () => {
  it("列出全部条目：摘录、笔记、时间、删除按钮齐全", () => {
    render(<AnnotationPanel {...baseProps} />);

    expect(screen.getByText("被划选的第一段话")).toBeInTheDocument();
    expect(screen.getByText("这里是笔记")).toBeInTheDocument();
    expect(screen.getByText("2026-10-31 08:05")).toBeInTheDocument();
    // 有摘录的条目正文是按钮；第二条无摘录也无笔记，显示占位文案。
    expect(screen.getAllByLabelText("删除这条笔记")).toHaveLength(2);
    expect(screen.getByText("（无文本摘录）")).toBeInTheDocument();
  });

  it("点击条目把它的 CFI 交给 onSelect", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<AnnotationPanel {...baseProps} onSelect={onSelect} />);

    await user.click(screen.getByText("被划选的第一段话"));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("epubcfi(/6/4!/4/2)");
  });

  it("点击删除把该条 id 交给 onDelete，不影响其他条目", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<AnnotationPanel {...baseProps} onDelete={onDelete} />);

    const buttons = screen.getAllByLabelText("删除这条笔记");
    await user.click(buttons[1]);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith("anno-2");
  });

  it("点击关闭按钮触发 onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AnnotationPanel {...baseProps} onClose={onClose} />);

    await user.click(screen.getByLabelText("关闭笔记列表"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("空列表显示引导文案，不渲染条目", () => {
    render(<AnnotationPanel {...baseProps} annotations={[]} />);

    expect(screen.getByText(/还没有高亮或笔记/)).toBeInTheDocument();
    expect(screen.queryByLabelText("删除这条笔记")).not.toBeInTheDocument();
  });
});
