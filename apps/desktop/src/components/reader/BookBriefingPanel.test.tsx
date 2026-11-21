// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/cloudEngine", () => ({
  runCloudOnce: vi.fn(),
}));
vi.mock("@/lib/ai/claudeBackend", () => ({
  acpxChat: vi.fn(),
  // auto 模式自检失败 → 路由到云引擎，与既有云链路用例保持同一路径。
  acpxEnvCheck: vi.fn(async () => ({
    ok: false,
    nodeOk: false,
    nodeVersion: null,
    acpxVersion: null,
    message: "测试环境无 acpx",
  })),
}));
vi.mock("@/lib/platform", () => ({
  isTauri: vi.fn(() => false),
}));

const { isTauri } = await import("@/lib/platform");
const { runCloudOnce } = await import("@/lib/ai/cloudEngine");
const { BookBriefingPanel } = await import("./BookBriefingPanel");
const { useBookBriefingStore } = await import("@/store/bookBriefingStore");

const PROPS = {
  bookId: "book-1",
  bookTitle: "三体",
  chapterTitles: ["第一章", "第二章"],
  getBookText: vi.fn(async () => "全书正文……"),
  onClose: vi.fn(),
};

const MODEL_JSON = JSON.stringify({
  mentalModel: "现象—机制—对策的三段式论证。",
  chapters: [
    { title: "第一章 深度工作", note: "定义问题。" },
    { title: "第二章 诱因设计", note: "解释机制。" },
  ],
  concepts: [{ term: "深度工作", note: "无干扰的高专注状态" }],
});

// happy-dom 的 MutationObserver 不触发 RTL waitFor，改用 vi.waitFor 轮询。
function eventually<T>(fn: () => T, timeout = 3000): Promise<T> {
  return vi.waitFor(fn, { timeout });
}

function resetStore() {
  useBookBriefingStore.setState({ briefings: {}, ready: true });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(runCloudOnce).mockReset();
  PROPS.getBookText.mockClear();
  PROPS.onClose.mockClear();
});

afterEach(() => {
  cleanup();
  resetStore();
});

describe("BookBriefingPanel", () => {
  it("以视口居中模态渲染：挂到 body、900×640、带遮罩", () => {
    render(<BookBriefingPanel {...PROPS} />);
    const panel = screen.getByRole("dialog", { name: "开读简报" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    // 尺寸与概念地图/设置弹窗同规格（窄窗由 max-w/max-h 退到 94vw×86vh）。
    expect(panel.className).toContain("w-[900px]");
    expect(panel.className).toContain("h-[640px]");
    expect(panel.className).toContain("max-w-[94vw]");
    expect(panel.className).toContain("max-h-[86vh]");
    expect(panel.parentElement?.closest("body")).toBe(document.body);
  });

  it("没有缓存时显示引导文案和生成按钮", async () => {
    render(<BookBriefingPanel {...PROPS} />);
    expect(screen.getByText(/还没有这本书的开读简报/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "生成开读简报" }),
    ).toBeInTheDocument();
    await eventually(() =>
      expect(screen.getByTestId("briefing-footer")).toHaveTextContent(
        "浏览器预览",
      ),
    );
  });

  it("浏览器预览点生成：渲染演示简报的骨架、章节与概念，落缓存", async () => {
    const user = userEvent.setup();
    render(<BookBriefingPanel {...PROPS} />);
    await user.click(screen.getByRole("button", { name: "生成开读简报" }));

    await eventually(() =>
      expect(screen.getByTestId("briefing-mental-model")).toHaveTextContent(
        "注意力如何被劫持",
      ),
    );
    expect(screen.getByTestId("briefing-chapters")).toHaveTextContent(
      "诱因设计",
    );
    expect(screen.getByTestId("briefing-concepts")).toHaveTextContent(
      "注意力残余",
    );
    expect(
      useBookBriefingStore.getState().get("book-1"),
    ).toBeDefined();
  });

  it("有缓存时打开即显示简报与重新生成按钮，不要求再点生成", async () => {
    useBookBriefingStore.getState().save("book-1", {
      mentalModel: "旧的骨架。",
      chapters: [{ title: "旧章节", note: "旧注。" }],
      concepts: [],
    });
    render(<BookBriefingPanel {...PROPS} />);

    await eventually(() =>
      expect(screen.getByTestId("briefing-mental-model")).toHaveTextContent(
        "旧的骨架",
      ),
    );
    expect(screen.getByText(/生成于/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新生成/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "生成开读简报" }),
    ).not.toBeInTheDocument();
  });

  it("桌面端生成：模型输出解析成功后渲染并落缓存，prompt 带书名与目录", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(runCloudOnce).mockResolvedValue(
      `好的，这是简报：\n\`\`\`json\n${MODEL_JSON}\n\`\`\``,
    );
    const user = userEvent.setup();
    render(<BookBriefingPanel {...PROPS} />);
    await user.click(screen.getByRole("button", { name: "生成开读简报" }));

    await eventually(() =>
      expect(screen.getByTestId("briefing-mental-model")).toHaveTextContent(
        "现象—机制—对策",
      ),
    );
    expect(runCloudOnce).toHaveBeenCalledTimes(1);
    // system 带书名；prompt 带上下文、目录标题与全书内容。
    const call = vi.mocked(runCloudOnce).mock.calls[0]![0]!;
    expect(call.system).toContain("《三体》");
    expect(call.prompt).toContain("《三体》");
    expect(call.prompt).toContain("- 第一章");
    expect(call.prompt).toContain("全书正文……");
    const cached = useBookBriefingStore.getState().get("book-1");
    expect(cached?.mentalModel).toBe("现象—机制—对策的三段式论证。");
    expect(cached?.chapters).toHaveLength(2);
  });

  it("桌面端兜底：抽不出全书正文时显示错误与重试，不落缓存", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const user = userEvent.setup();
    render(<BookBriefingPanel {...PROPS} getBookText={async () => null} />);
    await user.click(screen.getByRole("button", { name: "生成开读简报" }));

    await eventually(() =>
      expect(screen.getByText(/没有可读正文/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(runCloudOnce).not.toHaveBeenCalled();
    expect(useBookBriefingStore.getState().get("book-1")).toBeUndefined();
  });

  it.each([
    ["模型输出解析失败", "模型答非所问", /解析失败/],
    ["模型调用报错", new Error("连接断了"), /生成失败/],
  ])("桌面端兜底：%s 时显示错误与重试，不落缓存", async (_name, result, errorText) => {
    vi.mocked(isTauri).mockReturnValue(true);
    if (result instanceof Error) {
      vi.mocked(runCloudOnce).mockRejectedValue(result);
    } else {
      vi.mocked(runCloudOnce).mockResolvedValue(result);
    }
    const user = userEvent.setup();
    render(<BookBriefingPanel {...PROPS} />);
    await user.click(screen.getByRole("button", { name: "生成开读简报" }));

    await eventually(() =>
      expect(screen.getByText(errorText)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(useBookBriefingStore.getState().get("book-1")).toBeUndefined();
  });

  it("解析失败的输出不会覆盖已有缓存", async () => {
    useBookBriefingStore.getState().save("book-1", {
      mentalModel: "旧的骨架。",
      chapters: [],
      concepts: [],
    });
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(runCloudOnce).mockResolvedValue("解析不了");
    const user = userEvent.setup();
    render(<BookBriefingPanel {...PROPS} />);
    await eventually(() =>
      expect(screen.getByTestId("briefing-mental-model")).toHaveTextContent(
        "旧的骨架",
      ),
    );
    await user.click(screen.getByRole("button", { name: /重新生成/ }));
    await eventually(() =>
      expect(screen.getByText(/解析失败/)).toBeInTheDocument(),
    );
    // 旧缓存原样保留。
    expect(
      useBookBriefingStore.getState().get("book-1")?.mentalModel,
    ).toBe("旧的骨架。");
  });
});
