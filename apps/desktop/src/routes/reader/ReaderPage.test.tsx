// @vitest-environment happy-dom
import type { Ref } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// —— 共享的可观察状态（vi.mock 工厂只能引用 vi.hoisted 的变量）——
const foliate = vi.hoisted(() => ({
  /** foliate-view 上的方法调用流水：[方法名, 参数]。 */
  calls: [] as Array<[string, ...unknown[]]>,
  instances: [] as unknown[],
}));

const chatPanel = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
  /** ChatPanelHandle 的替身：send 间 spy，beforeEach 里重建。 */
  handle: null as { send: ReturnType<typeof vi.fn> } | null,
}));

const readFileMock = vi.hoisted(() =>
  vi.fn(async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
);

vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: readFileMock }));

// 阅读页只在桌面（Tauri）分支走真实编排；浏览器演示分支不在本文件覆盖范围。
vi.mock("@/lib/platform", () => ({ isTauri: () => true }));

// <foliate-view> 假自定义元素：替代 vendor view.js 的注册副作用。
// 默认所有方法立即 resolve 并记入 calls；单个测试可就地覆写方法或属性。
vi.mock("@/vendor/foliate-js/view.js", () => {
  class FoliateViewFake extends HTMLElement {
    book: Record<string, unknown> = { sections: [], toc: [] };
    renderer: unknown = null;
    lastLocation: unknown = null;
    constructor() {
      super();
      foliate.instances.push(this);
    }
    async open(file: unknown) {
      foliate.calls.push(["open", file]);
    }
    async init(options: unknown) {
      foliate.calls.push(["init", options]);
    }
    async next() {
      foliate.calls.push(["next"]);
    }
    async prev() {
      foliate.calls.push(["prev"]);
    }
    async goTo(target: unknown) {
      foliate.calls.push(["goTo", target]);
    }
    async addAnnotation(annotation: unknown) {
      foliate.calls.push(["addAnnotation", annotation]);
    }
    async deleteAnnotation(annotation: unknown) {
      foliate.calls.push(["deleteAnnotation", annotation]);
    }
    deselect() {
      foliate.calls.push(["deselect"]);
    }
    getCFI(index: number) {
      return `epubcfi(sec-${index})`;
    }
    close() {
      foliate.calls.push(["close"]);
    }
  }
  customElements.define("foliate-view", FoliateViewFake);
  return {};
});

vi.mock("@/vendor/foliate-js/overlayer.js", () => ({
  Overlayer: {
    highlight: vi.fn(),
    underline: vi.fn(),
    squiggly: vi.fn(),
  },
}));

vi.mock("@/lib/foliate", () => ({
  makeBookFile: vi.fn(() => ({ __fakeBookFile: true })),
  ebookFormatOf: vi.fn(() => null),
  bookToc: (book: { toc?: unknown[] } | null) => book?.toc ?? [],
  readingStyles: vi.fn(() => ""),
}));

vi.mock("@/lib/noteHover", () => ({
  createNoteHoverCaches: () => ({}),
  resolveNote: () => Promise.resolve(null),
  wireNoteHover: () => ({ close() {}, dispose() {}, cancelScheduledClose() {} }),
}));

// ChatPanel 真身太重（assistant-ui 虚拟列表 + AI SDK）：换记录型替身，
// 编排层只关心 props 联动与 handle.send。
vi.mock("@/components/ai/ChatPanel", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    ChatPanel: forwardRef(function FakeChatPanel(
      props: Record<string, unknown>,
      ref: Ref<unknown> | undefined,
    ) {
      chatPanel.lastProps = props;
      useImperativeHandle(
        ref,
        () =>
          chatPanel.handle ??
          (chatPanel.handle = { send: vi.fn() } as never),
        [],
      );
      const draft = props.draft as { text?: string } | null | undefined;
      return (
        <div
          data-testid="chat-panel"
          data-open={String(props.open === true)}
          data-draft={draft?.text ?? ""}
        />
      );
    }),
  };
});

import { ReaderPage } from "./ReaderPage";
import { Overlayer } from "@/vendor/foliate-js/overlayer.js";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useReadingSettings } from "@/store/readingSettings";
import { getReaderBridge } from "@/lib/ai/readerBridge";

const updateBookSpy = vi.fn(async () => {});

function seedBook(overrides: Record<string, unknown> = {}) {
  const book = {
    id: "b1",
    title: "测试之书",
    author: "测试者",
    format: "epub",
    filePath: "/books/测试之书.epub",
    sizeBytes: 1024,
    addedAt: 0,
    progress: 0,
    tags: [],
    ...overrides,
  };
  useBookStore.setState({
    books: [book as never],
    ready: true,
    updateBook: updateBookSpy,
  });
  return book;
}

/** matchMedia 替身：断点与减少动态效果按需指定，其余一律不匹配。 */
function stubMatchMedia(overrides: Record<string, boolean> = {}) {
  window.matchMedia = ((query: string) => ({
    matches: overrides[query] ?? false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** 章节文档替身：真实 DOM 文档 + 可切换的 Selection + iframe frameElement。 */
function makeFakeDoc(initialSelection: unknown = null) {
  const doc = document.implementation.createHTMLDocument("chapter");
  doc.body.innerHTML = "<p>第一章的正文内容。</p>";
  const selectionHolder = { current: initialSelection };
  vi.spyOn(doc, "getSelection").mockImplementation(
    () => selectionHolder.current as never,
  );
  Object.defineProperty(doc, "defaultView", {
    configurable: true,
    value: { frameElement: document.createElement("iframe") },
  });
  return { doc, selectionHolder };
}

function makeFakeSelection(text: string) {
  const frame = document.createElement("iframe");
  const range = {
    getBoundingClientRect: () => ({
      top: 10,
      left: 10,
      width: 120,
      height: 24,
      right: 130,
      bottom: 34,
      toJSON() {},
    }),
    startContainer: {
      ownerDocument: { defaultView: { frameElement: frame } },
    },
  };
  return {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => range,
    range,
  };
}

/** 分页器替身：jumpPages 需要 pages/page 数值与 goTo。 */
function makeFakeRenderer(overrides: Record<string, unknown> = {}) {
  const attrs = new Map<string, string>();
  return {
    attrs,
    pages: 10,
    page: 3,
    getContents: () => [{ index: 0 }],
    goTo: vi.fn<(target: unknown) => Promise<void>>(async () => {}),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
    hasAttribute: (name: string) => attrs.has(name),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 600 }),
    setStyles: vi.fn(),
    ...overrides,
  };
}

type FakeRenderer = ReturnType<typeof makeFakeRenderer>;

/** 测试就地改写的 foliate-view 形态：book/renderer 与翻页方法。 */
type FakeView = HTMLElement & {
  book: { sections?: Array<Record<string, unknown>>; toc?: Array<unknown> };
  renderer: FakeRenderer | null;
  next: ReturnType<typeof vi.fn>;
  prev: ReturnType<typeof vi.fn>;
};

function dispatchViewEvent(view: HTMLElement, type: string, detail: unknown) {
  act(() => {
    view.dispatchEvent(new CustomEvent(type, { detail }));
  });
}

async function mountReader(entry = "/reader?book=b1") {
  const utils = render(
    <MemoryRouter initialEntries={[entry]}>
      <ReaderPage />
    </MemoryRouter>,
  );
  const view = await waitFor(() => {
    const element = document.querySelector("foliate-view");
    expect(element).toBeTruthy();
    return element as unknown as FakeView;
  });
  return { ...utils, view };
}

function progressbar() {
  return screen.getByRole("progressbar", { name: "全书阅读进度" });
}

beforeEach(() => {
  foliate.calls.length = 0;
  foliate.instances.length = 0;
  chatPanel.lastProps = null;
  chatPanel.handle = { send: vi.fn() };
  updateBookSpy.mockClear();
  vi.mocked(Overlayer.highlight).mockClear();
  vi.mocked(Overlayer.underline).mockClear();
  vi.mocked(Overlayer.squiggly).mockClear();
  readFileMock.mockClear();
  localStorage.clear();
  stubMatchMedia();
  useAnnotationStore.setState({ annotations: {}, ready: true });
});

afterEach(() => {
  cleanup();
});

describe("ReaderPage 编排 · foliate-view 挂载与事件流", () => {
  it("打开书：读文件 → 挂载 foliate-view → open/init 恢复上次位置", async () => {
    const book = seedBook({ lastLocationCfi: "epubcfi(saved)" });
    const { view } = await mountReader();

    expect(readFileMock).toHaveBeenCalledWith(book.filePath);
    expect(foliate.calls).toContainEqual(["open", { __fakeBookFile: true }]);
    expect(foliate.calls).toContainEqual([
      "init",
      { lastLocation: "epubcfi(saved)", showTextStart: true },
    ]);

    // 就绪后骨架屏消失，顶栏是这本书，AI 工具桥已挂上。
    await waitFor(() =>
      expect(screen.queryByRole("status")).toBeNull(),
    );
    expect(screen.getByText("测试之书")).toBeTruthy();
    expect(getReaderBridge()?.bookId).toBe("b1");
    expect(view.isConnected).toBe(true);
  });

  it("relocate 驱动进度条、位置写回与页级指令解锁；无效上报被跳过", async () => {
    seedBook();
    const { view } = await mountReader();

    // 打开初期 payload（total 0）不压进度。
    dispatchViewEvent(view, "relocate", {
      section: { current: 0, total: 0 },
      fraction: 0.9,
    });
    expect(progressbar().getAttribute("aria-valuenow")).toBe("0");

    dispatchViewEvent(view, "relocate", {
      section: { current: 1, total: 10 },
      fraction: 0.42,
      cfi: "epubcfi(p42)",
      tocItem: { href: "ch1.html" },
      range: {},
    });

    expect(progressbar().getAttribute("aria-valuenow")).toBe("42");
    expect(updateBookSpy).toHaveBeenCalledWith("b1", {
      progress: 0.42,
      lastLocationCfi: "epubcfi(p42)",
    });
    // 可见区 Range 上报后，页级快捷指令可用。
    await waitFor(() =>
      expect(
        (chatPanel.lastProps?.quickCommands as Record<string, unknown>)?.page,
      ).toBeTruthy(),
    );
  });

  it("卸载清理：close foliate、摘除 AI 桥、节点移出文档", async () => {
    seedBook();
    const { view, unmount } = await mountReader();

    unmount();

    expect(foliate.calls).toContainEqual(["close"]);
    expect(getReaderBridge()).toBeNull();
    expect(document.querySelector("foliate-view")).toBeNull();
    expect(view.isConnected).toBe(false);
  });
});

describe("ReaderPage 编排 · 翻页队列", () => {
  it("分页模式：锁窗口内连点累加，窗口结束后合并为一次定位", async () => {
    seedBook();
    const { view } = await mountReader();
    const renderer = makeFakeRenderer();
    view.renderer = renderer;
    const resolvers: Array<() => void> = [];
    view.next = vi.fn(
      () => new Promise<void>((resolve) => void resolvers.push(resolve)),
    );

    const nextButton = screen.getByRole("button", { name: "下一页" });
    fireEvent.click(nextButton);
    expect(view.next).toHaveBeenCalledTimes(1);

    // 锁窗口内再点两次：只累加，不再发起逐页翻。
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);
    expect(view.next).toHaveBeenCalledTimes(1);

    // 首页翻完，队列把累计的 2 页合并成一次分页器定位。
    await act(async () => {
      resolvers[0]?.();
    });
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(renderer.goTo).toHaveBeenCalledTimes(1);
    const goToArg = renderer.goTo.mock.calls[0]?.[0] as unknown as {
      index: number;
      anchor?: unknown;
    };
    expect(goToArg.index).toBe(0);
    expect(typeof goToArg.anchor).toBe("function");

    // 队列排空后恢复正常逐页。
    fireEvent.click(nextButton);
    await act(async () => {});
    expect(view.next).toHaveBeenCalledTimes(2);
  });

  it("键盘方向键与 PgUp/PgDn 走同一收口", async () => {
    seedBook();
    await mountReader();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight" }),
      );
    });
    await act(async () => {});
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
    });
    await act(async () => {});

    expect(foliate.calls).toContainEqual(["next"]);
    expect(foliate.calls).toContainEqual(["prev"]);
  });

  it("滚动模式不排队：方向键直接翻，正文 flow 属性同步切换", async () => {
    seedBook();
    const { view } = await mountReader();
    const renderer = makeFakeRenderer();
    view.renderer = renderer;

    act(() => {
      useReadingSettings.setState({ pageFlow: "scrolled" });
    });
    // 滚动模式没有页脚翻页按钮。
    expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight" }),
      );
    });
    await act(async () => {});

    expect(foliate.calls).toContainEqual(["next"]);
    expect(renderer.attrs.get("flow")).toBe("scrolled");
  });
});

describe("ReaderPage 编排 · 高亮与注解链路", () => {
  it("划线：addAnnotation + store 落盘 + 就地切编辑态", async () => {
    seedBook();
    const { view } = await mountReader();
    const selection = makeFakeSelection("被划选的句子");
    const { doc } = makeFakeDoc(selection);

    dispatchViewEvent(view, "load", { doc, index: 2 });
    act(() => {
      doc.dispatchEvent(new Event("pointerup"));
    });

    // 划选菜单弹出，携带选区文本。
    expect(screen.getByText("划线")).toBeTruthy();
    expect(screen.getByText("问 Deer")).toBeTruthy();

    fireEvent.click(screen.getByText("划线"));

    await waitFor(() =>
      expect(useAnnotationStore.getState().annotations.b1?.[0]).toMatchObject({
        cfi: "epubcfi(sec-2)",
        excerpt: "被划选的句子",
      }),
    );
    expect(foliate.calls).toContainEqual([
      "addAnnotation",
      expect.objectContaining({ value: "epubcfi(sec-2)" }),
    ]);
    // 微信读书式：菜单不关，就地切编辑态（按钮变「删除划线」，摘录仍可问 Deer）。
    expect(screen.getByText("删除划线")).toBeTruthy();
    expect(screen.getByText("问 Deer")).toBeTruthy();
  });

  it("draw-annotation 按 style 选绘制策略并带颜色", async () => {
    seedBook();
    const { view } = await mountReader();
    const draw = vi.fn();
    dispatchViewEvent(view, "draw-annotation", {
      annotation: { color: "#FF0000", style: "line" },
      draw,
    });
    dispatchViewEvent(view, "draw-annotation", {
      annotation: { color: "#00FF00", style: "dash" },
      draw,
    });
    dispatchViewEvent(view, "draw-annotation", {
      annotation: { color: "#0000FF" },
      draw,
    });
    // 选中的绘制策略作为参数交给 detail.draw；旧数据没有 style 字段 → 马克笔。
    expect(draw.mock.calls.map((call) => call[0])).toEqual([
      Overlayer.underline,
      Overlayer.squiggly,
      Overlayer.highlight,
    ]);
    expect(draw).toHaveBeenNthCalledWith(1, Overlayer.underline, {
      color: "#FF0000",
    });
  });

  it("章节重载回显已有注解；store 删除后同步摘除 foliate 高亮", async () => {
    seedBook();
    useAnnotationStore.getState().add({
      bookId: "b1",
      cfi: "epubcfi(a1)",
      color: "#FFF176",
      style: "marker",
      excerpt: "旧高亮",
    });
    const { view } = await mountReader();
    const { doc } = makeFakeDoc(null);

    dispatchViewEvent(view, "load", { doc, index: 0 });
    await act(async () => {});

    expect(foliate.calls).toContainEqual([
      "addAnnotation",
      expect.objectContaining({ value: "epubcfi(a1)", color: "#FFF176" }),
    ]);

    act(() => {
      useAnnotationStore.getState().remove(
        useAnnotationStore.getState().annotations.b1![0]!.id,
      );
    });
    await waitFor(() =>
      expect(foliate.calls).toContainEqual([
        "deleteAnnotation",
        { value: "epubcfi(a1)" },
      ]),
    );
  });

  it("点击已有高亮弹编辑菜单，删除时 store 与 foliate 双删", async () => {
    seedBook();
    useAnnotationStore.getState().add({
      bookId: "b1",
      cfi: "epubcfi(hit)",
      color: "#FFF176",
      style: "marker",
      excerpt: "点我",
    });
    const { view } = await mountReader();

    dispatchViewEvent(view, "show-annotation", {
      value: "epubcfi(hit)",
      range: makeFakeSelection("点我").range,
    });

    expect(screen.getByText("删除划线")).toBeTruthy();

    fireEvent.click(screen.getByText("删除划线"));

    expect(useAnnotationStore.getState().annotations.b1 ?? []).toHaveLength(0);
    expect(foliate.calls).toContainEqual([
      "deleteAnnotation",
      { value: "epubcfi(hit)" },
    ]);
  });
});

describe("ReaderPage 编排 · AI 面板联动", () => {
  async function mountWithSelection() {
    seedBook();
    const utils = await mountReader();
    const selection = makeFakeSelection("被划选的句子");
    const { doc } = makeFakeDoc(selection);
    dispatchViewEvent(utils.view, "load", { doc, index: 0 });
    act(() => {
      doc.dispatchEvent(new Event("pointerup"));
    });
    expect(screen.getByText("问 Deer")).toBeTruthy();
    return utils;
  }

  it("问 Deer：预填草稿、打开面板并取消选区", async () => {
    await mountWithSelection();

    fireEvent.click(screen.getByText("问 Deer"));

    expect(screen.getByTestId("chat-panel").getAttribute("data-open")).toBe(
      "true",
    );
    expect(chatPanel.lastProps?.draft).toMatchObject({
      text: expect.stringContaining("被划选的句子"),
    });
    expect(foliate.calls).toContainEqual(["deselect"]);
    expect(screen.queryByText("问 Deer")).toBeNull();
  });

  it("总结本章：抽当前 section 正文经 handle.send 发出", async () => {
    const { view } = await mountWithSelection();
    const sectionDoc = document.implementation.createHTMLDocument("section");
    sectionDoc.body.innerHTML = "<p>本章讲述了一只鹿的冒险。</p>";
    view.book.sections = [{ createDocument: async () => sectionDoc }];
    dispatchViewEvent(view, "relocate", {
      section: { current: 0, total: 2 },
      fraction: 0.1,
      cfi: "epubcfi(s0)",
    });

    act(() => {
      (chatPanel.lastProps?.onSummarizeChapter as () => void)();
    });

    await waitFor(() =>
      expect(chatPanel.handle?.send).toHaveBeenCalledTimes(1),
    );
    const [prompt, display] = chatPanel.handle!.send.mock.calls[0]!;
    expect(display).toBe("总结本章");
    expect(String(prompt)).toContain("本章讲述了一只鹿的冒险。");
    expect(screen.getByTestId("chat-panel").getAttribute("data-open")).toBe(
      "true",
    );
  });

  it("快捷指令：章节指令从 foliate section 抽正文", async () => {
    seedBook();
    const { view } = await mountReader();
    const sectionDoc = document.implementation.createHTMLDocument("section");
    sectionDoc.body.innerHTML = "<p>第一章的正文内容。</p>";
    view.book.sections = [{ createDocument: async () => sectionDoc }];

    const chapterCommand = (
      chatPanel.lastProps?.quickCommands as Record<
        string,
        { getText: () => Promise<string | null> }
      >
    )?.chapter;
    await expect(chapterCommand?.getText()).resolves.toContain(
      "第一章的正文内容",
    );
  });

  it("图片书（CBZ）：章节与全书快捷指令置灰", async () => {
    seedBook({ format: "cbz" });
    await mountReader();

    const quickCommands = chatPanel.lastProps?.quickCommands as Record<
      string,
      { available?: boolean; unavailableReason?: string }
    >;
    expect(quickCommands.chapter.available).toBe(false);
    expect(quickCommands.chapter.unavailableReason).toBe("该格式不支持");
    expect(quickCommands.book.available).toBe(false);
  });

  it("AI 工具桥：目录与跳转接 foliate", async () => {
    seedBook();
    const { view } = await mountReader();
    view.book.toc = [{ href: "ch1.html", title: "第一章" }];

    const bridge = getReaderBridge();
    expect(bridge?.bookId).toBe("b1");
    expect(bridge?.getToc()).toEqual([{ href: "ch1.html", title: "第一章" }]);
    await expect(bridge?.jumpTo("epubcfi(x)")).resolves.toBe(true);
    expect(foliate.calls).toContainEqual(["goTo", "epubcfi(x)"]);
    // 越界目录索引返回 false，不触发跳转。
    await expect(bridge?.jumpToTocIndex(5)).resolves.toBe(false);
  });
});

describe("ReaderPage 编排 · 浮层互斥与导航关闭", () => {
  it("relocate（翻页/跳章）立即关闭显示设置浮层", async () => {
    seedBook();
    const { view } = await mountReader();

    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    expect(
      document.querySelector('[aria-label="阅读显示设置"]'),
    ).toBeTruthy();

    dispatchViewEvent(view, "relocate", {
      section: { current: 1, total: 10 },
      fraction: 0.5,
      cfi: "epubcfi(nav)",
    });

    await waitFor(() =>
      expect(
        document.querySelector('[aria-label="阅读显示设置"]'),
      ).toBeNull(),
    );
  });
});
