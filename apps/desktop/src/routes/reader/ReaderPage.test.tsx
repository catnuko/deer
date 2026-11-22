// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "@/lib/types";

// —— ReaderPage 编排层测试：mock foliate 自定义元素与 Tauri 边界，验证组件编排
// 行为本身（挂载/事件流、翻页队列、高亮链路、AI 面板联动），foliate 内部与
// Tauri 插件不在覆盖范围（各有自己的测试或属集成范畴）。——

// Tauri 边界：fs 读取、plugin-store（书库/注解持久化）、路径 API。
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    load: vi.fn(async (path: string) => {
      let data = stores.get(path);
      if (!data) {
        data = new Map();
        stores.set(path, data);
      }
      return {
        get: async (key: string) => data.get(key),
        set: async (key: string, value: unknown) => {
          data.set(key, value);
        },
        delete: async (key: string) => {
          data.delete(key);
        },
        save: async () => {},
      };
    }),
  };
});
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "/mock/appdata"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

// foliate：view.js 的 import 副作用是注册真实自定义元素，测试里换成下面的
// 桩元素；overlayer 的绘制函数只验证「按样式选对了策略」。
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
vi.mock("@/vendor/foliate-js/overlayer.js", () => ({
  Overlayer: {
    highlight: vi.fn(),
    underline: vi.fn(),
    squiggly: vi.fn(),
  },
}));

// ChatPanel 本体拉起 AI 引擎，另有自己的测试；这里用轻量替身暴露关键 props。
vi.mock("@/components/ai/ChatPanel", () => ({
  ChatPanel: (props: {
    open?: boolean;
    draft?: { text: string } | null;
    book?: { id: string };
  }) => (
    <div
      data-testid="chat-panel"
      data-open={String(Boolean(props.open))}
      data-draft={props.draft?.text ?? ""}
      data-book-id={props.book?.id ?? ""}
    />
  ),
}));

// 脚注悬浮预览的 doc 接线不在编排层测试范围，桩掉即可。
vi.mock("@/lib/noteHover", () => ({
  createNoteHoverCaches: () => ({}),
  resolveNote: vi.fn(async () => null),
  wireNoteHover: vi.fn(() => ({
    close() {},
    dispose() {},
    cancelScheduledClose() {},
  })),
}));

import { readFile } from "@tauri-apps/plugin-fs";
import { Overlayer } from "@/vendor/foliate-js/overlayer.js";
import { ReaderPage } from "./ReaderPage";
import { getReaderBridge } from "@/lib/ai/readerBridge";
import {
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
} from "@/components/reader/highlightColors";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { useReadingSettings } from "@/store/readingSettings";

// —— foliate-view 桩：实现 ReaderPage 用到的视图 API，事件由测试派发。——
type StubRenderer = {
  setStyles: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
  getAttribute: ReturnType<typeof vi.fn>;
  getBoundingClientRect: () => DOMRect;
};

class FoliateViewStub extends HTMLElement {
  book = {
    toc: [
      { label: "第一章", href: "chap1.xhtml" },
      { label: "第二章", href: "chap2.xhtml" },
    ],
    sections: [],
  };
  renderer: StubRenderer = {
    setStyles: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    getAttribute: vi.fn(() => null),
    getBoundingClientRect: () =>
      ({ top: 0, left: 0, width: 800, height: 600 }) as DOMRect,
  };
  lastLocation: { fraction: number } | null = null;
  openFiles: File[] = [];
  initOptions: unknown[] = [];
  nextCalls = 0;
  prevCalls = 0;
  goToTargets: unknown[] = [];
  addedAnnotations: Record<string, unknown>[] = [];
  deletedCfis: string[] = [];
  closeCalls = 0;
  deselectCalls = 0;
  /** 可注入的 next 实现：测试用 pending promise 制造翻页队列 busy 态。 */
  nextImpl: (() => Promise<void>) | null = null;

  constructor() {
    super();
    stubInstances.push(this);
  }

  async open(file: File) {
    this.openFiles.push(file);
  }
  async init(options: unknown) {
    this.initOptions.push(options);
    this.lastLocation = { fraction: 0.25 };
  }
  async next() {
    this.nextCalls += 1;
    if (this.nextImpl) await this.nextImpl();
  }
  async prev() {
    this.prevCalls += 1;
  }
  async goTo(target: unknown) {
    this.goToTargets.push(target);
  }
  lastDraw: ReturnType<typeof vi.fn> | null = null;

  async addAnnotation(annotation: Record<string, unknown>) {
    this.addedAnnotations.push(annotation);
    // 模拟 foliate 契约：addAnnotation 会派发 draw-annotation，外层按样式
    // 选好绘制策略后回调 detail.draw。
    const draw = vi.fn();
    this.lastDraw = draw;
    this.dispatchEvent(
      new CustomEvent("draw-annotation", { detail: { annotation, draw } }),
    );
  }
  async deleteAnnotation({ value }: { value: string }) {
    this.deletedCfis.push(value);
  }
  deselect() {
    this.deselectCalls += 1;
  }
  close() {
    this.closeCalls += 1;
  }
  getCFI() {
    return "epubcfi(stub)";
  }
  // foliate 契约：搜索逐个 yield 命中、最后 yield 字符串收尾；桩直接收尾。
  async *search() {
    yield "done" as unknown;
  }
}
customElements.define("foliate-view", FoliateViewStub);

const stubInstances: FoliateViewStub[] = [];
function currentView(): FoliateViewStub {
  const view = stubInstances.at(-1);
  if (!view) throw new Error("foliate-view 尚未创建");
  return view;
}

// —— load 事件的章节 document 桩：只暴露 ReaderPage 用到的 Selection 面。——
function makeFakeDoc(selection: {
  rangeCount: number;
  isCollapsed: boolean;
  toString(): string;
  getRangeAt(index: number): {
    getBoundingClientRect(): { top: number; left: number; width: number; height: number };
    startContainer: unknown;
  };
} | null) {
  const listeners = new Map<string, EventListener>();
  const doc = {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    getSelection: () => selection,
    defaultView: selection
      ? {
          frameElement: {
            getBoundingClientRect: () => ({ top: 0, left: 0, width: 800 }),
          },
        }
      : null,
    __fire(type: string) {
      listeners.get(type)?.(new Event(type));
    },
  };
  return doc as unknown as Document & { __fire(type: string): void };
}

const BOOK_ID = "book-1";

function bookRecord(): Book {
  return {
    id: BOOK_ID,
    title: "测试之书",
    author: "测试者",
    format: "epub",
    filePath: `/mock/books/${BOOK_ID}.epub`,
    sizeBytes: 1024,
    addedAt: 0,
    progress: 0,
    lastLocationCfi: "epubcfi(saved)",
    tags: [],
  };
}

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
  vi.mocked(readFile).mockReset();
  vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
  stubInstances.length = 0;
  localStorage.clear();
  useBookStore.setState({ books: [bookRecord()], folders: [], ready: true });
  useAnnotationStore.setState({ annotations: {}, ready: true });
  useReadingSettings.getState().reset();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function mountReader(search = `?book=${BOOK_ID}`) {
  return render(
    <MemoryRouter initialEntries={[`/reader${search}`]}>
      <ReaderPage />
    </MemoryRouter>,
  );
}

/** 等真实书挂载完成：骨架退场、页脚出现章数。 */
async function waitForReady() {
  await screen.findByText(/第 1 \/ 2 章/);
  const view = currentView();
  expect(view).toBeInstanceOf(FoliateViewStub);
  return view;
}

describe("ReaderPage 编排：真实书挂载与事件流", () => {
  it("桌面书挂载：读文件、建 foliate-view、open/init 恢复位置、注册 AI 桥", async () => {
    const { unmount } = mountReader();
    const view = await waitForReady();

    expect(readFile).toHaveBeenCalledWith("/mock/books/book-1.epub");
    expect(view.openFiles).toHaveLength(1);
    expect(view.openFiles[0].name).toBe("book-1.epub");
    expect(view.initOptions).toEqual([
      { lastLocation: "epubcfi(saved)", showTextStart: true },
    ]);
    // init 后下发阅读样式与分页布局。
    expect(view.renderer.setStyles).toHaveBeenCalled();
    expect(view.renderer.setAttribute).toHaveBeenCalled();
    // 阅读进度条反映 init 恢复到的 25%。
    expect(
      screen.getByRole("progressbar", { name: "全书阅读进度" }),
    ).toHaveAttribute("aria-valuenow", "25");
    // 打开即记 lastOpenedAt。
    expect(
      Number.isFinite(useBookStore.getState().books[0].lastOpenedAt),
    ).toBe(true);
    // AI 工具桥按书注册。
    const bridge = getReaderBridge();
    expect(bridge?.bookId).toBe(BOOK_ID);
    expect(bridge?.getToc()).toHaveLength(2);

    unmount();
    // 卸载清理：摘元素、关视图、摘桥。
    expect(document.querySelector("foliate-view")).toBeNull();
    expect(view.closeCalls).toBe(1);
    expect(getReaderBridge()).toBeNull();
  });

  it("relocate 事件驱动进度、章节高亮与书库写回；无 section 的早期事件被忽略", async () => {
    mountReader();
    const view = await waitForReady();

    act(() => {
      view.dispatchEvent(
        new CustomEvent("relocate", {
          detail: {
            section: { current: 1, total: 4 },
            fraction: 0.5,
            cfi: "epubcfi(pos)",
            tocItem: { href: "chap2.xhtml" },
          },
        }),
      );
    });
    expect(
      screen.getByRole("progressbar", { name: "全书阅读进度" }),
    ).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText(/第 2 \/ 2 章 · 第二章/)).toBeTruthy();
    expect(useBookStore.getState().books[0].progress).toBe(0.5);
    expect(useBookStore.getState().books[0].lastLocationCfi).toBe(
      "epubcfi(pos)",
    );

    // 首次布局前的 payload（无 section）不落任何状态。
    act(() => {
      view.dispatchEvent(
        new CustomEvent("relocate", { detail: { fraction: 0.9 } }),
      );
    });
    expect(
      screen.getByRole("progressbar", { name: "全书阅读进度" }),
    ).toHaveAttribute("aria-valuenow", "50");
  });

  it("打开失败展示错误态", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("磁盘没了"));
    mountReader();
    expect(await screen.findByText(/打开本书失败：磁盘没了/)).toBeTruthy();
    expect(stubInstances).toHaveLength(0);
  });
});

describe("ReaderPage 编排：翻页队列", () => {
  it("页脚按钮与键盘走同一收口；busy 窗口内的连点累加不丢弃", async () => {
    mountReader();
    const view = await waitForReady();

    // 让 next 卡住一次，制造翻页进行中的 busy 窗口；释放后恢复直通，
    // 否则后续每轮 drain 都会被新的 pending gate 挂死。
    let release!: () => void;
    view.nextImpl = () =>
      new Promise<void>((resolve) => {
        release = () => {
          view.nextImpl = null;
          resolve();
        };
      });

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(view.nextCalls).toBe(1);

    release();
    await waitFor(() => expect(view.nextCalls).toBe(2));

    // 键盘与页脚按钮同一收口。
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    await waitFor(() => expect(view.nextCalls).toBe(3));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    await waitFor(() => expect(view.prevCalls).toBe(1));
  });
});

describe("ReaderPage 编排：划选高亮链路", () => {
  const stubSelection = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => "划选的句子",
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ top: 30, left: 40, width: 120, height: 16 }),
      startContainer: {
        ownerDocument: {
          defaultView: {
            frameElement: { getBoundingClientRect: () => ({ top: 0, left: 0 }) },
          },
        },
      },
    }),
  };

  it("load 事件接线 doc，pointerup 弹划选菜单；点划线落 foliate 高亮与注解库", async () => {
    mountReader();
    const view = await waitForReady();

    const doc = makeFakeDoc(stubSelection);
    act(() => {
      view.dispatchEvent(
        new CustomEvent("load", { detail: { doc, index: 2 } }),
      );
    });
    // 初始无选区，菜单不弹。
    expect(screen.queryByText("划线")).toBeNull();

    doc.__fire("pointerup");
    expect(await screen.findByText("划线")).toBeTruthy();

    fireEvent.click(screen.getByText("划线"));
    // foliate 高亮与注解库双写。
    await waitFor(() => expect(view.addedAnnotations).toHaveLength(1));
    expect(view.addedAnnotations[0]).toEqual(
      expect.objectContaining({
        value: "epubcfi(stub)",
        color: DEFAULT_HIGHLIGHT_COLOR,
        style: DEFAULT_ANNOTATION_STYLE,
      }),
    );
    const stored = useAnnotationStore.getState().annotations[BOOK_ID];
    expect(stored).toHaveLength(1);
    expect(stored[0].cfi).toBe("epubcfi(stub)");
    expect(stored[0].excerpt).toBe("划选的句子");
    // marker 样式选中 Overlayer.highlight 策略并带上颜色。
    expect(view.lastDraw).toHaveBeenCalledWith(
      Overlayer.highlight,
      expect.objectContaining({ color: DEFAULT_HIGHLIGHT_COLOR }),
    );

    // 菜单就地切进编辑态，且划选菜单退场。
    expect(await screen.findByText("删除划线")).toBeTruthy();

    // 编辑菜单的「删除划线」：注解库与 foliate 高亮双删。
    fireEvent.click(screen.getByText("删除划线"));
    await waitFor(() => expect(view.deletedCfis).toContain("epubcfi(stub)"));
    expect(useAnnotationStore.getState().annotations[BOOK_ID]).toHaveLength(0);
  });

  it("已有注解回显：load 时重画，删除后差集摘除 foliate 高亮", async () => {
    mountReader();
    const view = await waitForReady();

    // 注解在 load 事件前落库（run() 的 load() 会覆盖挂载前预置的状态）。
    act(() =>
      useAnnotationStore.getState().add({
        bookId: BOOK_ID,
        cfi: "epubcfi(existing)",
        color: DEFAULT_HIGHLIGHT_COLOR,
        style: DEFAULT_ANNOTATION_STYLE,
      }),
    );

    const doc = makeFakeDoc(null);
    act(() => {
      view.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } }));
    });
    await waitFor(() =>
      expect(
        useAnnotationStore.getState().annotations[BOOK_ID],
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        view.addedAnnotations.some(
          (a) => a.value === "epubcfi(existing)",
        ),
      ).toBe(true),
    );

    // 注解库删除 → 编排层按差集调 foliate 摘除。
    const id = useAnnotationStore.getState().annotations[BOOK_ID][0].id;
    act(() => useAnnotationStore.getState().remove(id));
    await waitFor(() =>
      expect(view.deletedCfis).toContain("epubcfi(existing)"),
    );
  });

  it("划选问 Deer：草稿注入 AI 面板并自动展开，选区收口", async () => {
    mountReader();
    const view = await waitForReady();

    const doc = makeFakeDoc(stubSelection);
    act(() => {
      view.dispatchEvent(
        new CustomEvent("load", { detail: { doc, index: 2 } }),
      );
    });
    doc.__fire("pointerup");
    fireEvent.click(await screen.findByText("问 Deer"));

    const panel = screen.getByTestId("chat-panel");
    expect(panel).toHaveAttribute("data-open", "true");
    expect(panel.getAttribute("data-draft")).toContain("划选的句子");
    expect(screen.queryByText("划线")).toBeNull();
    expect(view.deselectCalls).toBe(1);
  });

  it("顶栏 AI 伴读只展开面板，不产生草稿", async () => {
    mountReader();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "AI 伴读" }));
    const panel = screen.getByTestId("chat-panel");
    expect(panel).toHaveAttribute("data-open", "true");
    expect(panel.getAttribute("data-draft")).toBe("");
  });
});

describe("ReaderPage 编排：浏览器演示模式", () => {
  it("非 Tauri 环境回落演示书", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    mountReader("");

    expect(await screen.findByText("山中来信")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "本章阅读进度" })).toBeTruthy();
    expect(stubInstances).toHaveLength(0);
    expect(getReaderBridge()).toBeNull();
  });
});
