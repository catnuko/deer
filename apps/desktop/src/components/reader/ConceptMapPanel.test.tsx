// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/claudeBackend", () => ({
  CLAUDE_CHUNK_EVENT: "claude://chunk",
  isTauriRuntime: vi.fn(() => false),
  acpxChat: vi.fn(),
}));

const { isTauriRuntime, acpxChat } = await import("@/lib/ai/claudeBackend");
const { ConceptMapPanel } = await import("./ConceptMapPanel");
const { useConceptMapStore } = await import("@/store/conceptMapStore");

const PROPS = {
  bookId: "book-1",
  bookTitle: "三体",
  chapterKey: "sec:3",
  chapterTitle: "第三章",
  getChapterText: vi.fn(async () => "章节全文……"),
  onClose: vi.fn(),
};

const MODEL_JSON = JSON.stringify({
  nodes: [
    { id: "n1", label: "记忆", summary: "存储与提取" },
    { id: "n2", label: "遗忘" },
  ],
  edges: [{ from: "n1", to: "n2", label: "导致" }],
});

// happy-dom 的 MutationObserver 不触发 RTL waitFor，改用 vi.waitFor 轮询。
function eventually<T>(fn: () => T, timeout = 3000): Promise<T> {
  return vi.waitFor(fn, { timeout });
}

function resetStore() {
  useConceptMapStore.setState({ maps: {}, ready: true });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  vi.mocked(acpxChat).mockReset();
  PROPS.getChapterText.mockClear();
  PROPS.onClose.mockClear();
});

afterEach(() => {
  cleanup();
  resetStore();
});

describe("ConceptMapPanel", () => {
  it("以视口居中模态渲染：挂到 body、900×640、带遮罩", () => {
    render(<ConceptMapPanel {...PROPS} />);
    const panel = screen.getByRole("dialog", { name: "章节概念地图" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    // 尺寸与设置弹窗同规格（窄窗由 max-w/max-h 退到 94vw×86vh）。
    expect(panel.className).toContain("w-[900px]");
    expect(panel.className).toContain("h-[640px]");
    expect(panel.className).toContain("max-w-[94vw]");
    expect(panel.className).toContain("max-h-[86vh]");
    // 居中靠网格，不用 translate(-50%,-50%)（会和缩放入场抢 transform）。
    expect(panel.parentElement?.className).toContain("place-items-center");
    expect(panel.className).not.toContain("-translate-x-1/2");
    expect(panel.parentElement?.closest("body")).toBe(document.body);
  });

  it("没有缓存时显示引导文案和生成按钮", async () => {
    render(<ConceptMapPanel {...PROPS} />);
    expect(screen.getByText(/还没有这一章的概念地图/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "生成本章概念地图" }),
    ).toBeInTheDocument();
    await eventually(() =>
      expect(screen.getByTestId("concept-map-detail")).toHaveTextContent(
        "浏览器预览",
      ),
    );
  });

  it("浏览器预览点生成：渲染演示地图的节点与关系，点节点显示说明", async () => {
    const user = userEvent.setup();
    render(<ConceptMapPanel {...PROPS} />);
    await user.click(screen.getByRole("button", { name: "生成本章概念地图" }));

    const svg = await eventually(() => {
      const el = screen.getByTestId("concept-map-svg");
      expect(el).toHaveTextContent("工作记忆");
      expect(el).toHaveTextContent("编码进");
      return el;
    });
    expect(svg).toHaveTextContent("间隔重复");
    // 生成结果落了缓存。
    await eventually(() =>
      expect(
        useConceptMapStore.getState().get("book-1", "sec:3"),
      ).toBeDefined(),
    );
    // 点节点显示该概念的说明。
    await user.click(screen.getByText("工作记忆"));
    expect(screen.getByTestId("concept-map-detail")).toHaveTextContent(
      "容量有限",
    );
  });

  it("有缓存时打开即显示地图与重新生成按钮，不要求再点生成", async () => {
    useConceptMapStore.getState().save("book-1", "sec:3", {
      nodes: [{ id: "n1", label: "记忆" }],
      edges: [],
    });
    render(<ConceptMapPanel {...PROPS} />);

    const svg = await eventually(() => screen.getByTestId("concept-map-svg"));
    expect(svg).toHaveTextContent("记忆");
    expect(screen.getByText(/生成于/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /重新生成/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "生成本章概念地图" }),
    ).not.toBeInTheDocument();
  });

  it("桌面端生成：claude 输出解析成功后渲染并落缓存", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockResolvedValue({
      text: `好的，这是地图：\n\`\`\`json\n${MODEL_JSON}\n\`\`\``,
      sessionId: "s1",
    });
    const user = userEvent.setup();
    render(<ConceptMapPanel {...PROPS} />);
    await user.click(screen.getByRole("button", { name: "生成本章概念地图" }));

    await eventually(() =>
      expect(screen.getByTestId("concept-map-svg")).toHaveTextContent("记忆"),
    );
    expect(acpxChat).toHaveBeenCalledTimes(1);
    // prompt 带 N1 上下文行和章节全文。
    const call = vi.mocked(acpxChat).mock.calls[0]![0]!;
    expect(call.prompt).toContain("《三体》");
    expect(call.prompt).toContain("章节全文");
    expect(
      useConceptMapStore.getState().get("book-1", "sec:3")?.nodes,
    ).toEqual([
      { id: "n1", label: "记忆", summary: "存储与提取" },
      { id: "n2", label: "遗忘" },
    ]);
  });

  it("桌面端兜底：抽不出章节正文时显示错误与重试，不落缓存", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <ConceptMapPanel
        {...PROPS}
        getChapterText={async () => null}
      />,
    );
    await user.click(screen.getByRole("button", { name: "生成本章概念地图" }));

    await eventually(() =>
      expect(screen.getByText(/没有可读正文/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(acpxChat).not.toHaveBeenCalled();
    expect(useConceptMapStore.getState().get("book-1", "sec:3")).toBeUndefined();
  });

  it.each([
    ["模型输出解析失败", { text: "模型答非所问", sessionId: "s1" }, /解析失败/],
    ["claude 调用报错", new Error("连接断了"), /生成失败/],
  ])("桌面端兜底：%s 时显示错误与重试，不落缓存", async (_name, result, errorText) => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    if (result instanceof Error) {
      vi.mocked(acpxChat).mockRejectedValue(result);
    } else {
      vi.mocked(acpxChat).mockResolvedValue(result);
    }
    const user = userEvent.setup();
    render(<ConceptMapPanel {...PROPS} />);
    await user.click(screen.getByRole("button", { name: "生成本章概念地图" }));

    await eventually(() =>
      expect(screen.getByText(errorText)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(useConceptMapStore.getState().get("book-1", "sec:3")).toBeUndefined();
  });

  it("解析失败的输出不会覆盖已有缓存", async () => {
    useConceptMapStore.getState().save("book-1", "sec:3", {
      nodes: [{ id: "n1", label: "旧地图" }],
      edges: [],
    });
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockResolvedValue({
      text: "解析不了",
      sessionId: "s1",
    });
    const user = userEvent.setup();
    render(<ConceptMapPanel {...PROPS} />);
    await eventually(() =>
      expect(screen.getByTestId("concept-map-svg")).toHaveTextContent("旧地图"),
    );
    await user.click(screen.getByRole("button", { name: /重新生成/ }));
    await eventually(() =>
      expect(screen.getByText(/解析失败/)).toBeInTheDocument(),
    );
    // 生成失败不清掉已有缓存：store 里仍是旧地图。
    expect(
      useConceptMapStore.getState().get("book-1", "sec:3")?.nodes,
    ).toEqual([{ id: "n1", label: "旧地图" }]);
  });

  it("按 Esc 触发 onClose（布局重排 P8）", async () => {
    render(<ConceptMapPanel {...PROPS} />);
    await eventually(() =>
      expect(screen.getByText(/还没有这一章的概念地图/)).toBeInTheDocument(),
    );

    await userEvent.keyboard("{Escape}");
    expect(PROPS.onClose).toHaveBeenCalledOnce();
  });
});
