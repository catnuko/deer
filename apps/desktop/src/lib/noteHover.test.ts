// @vitest-environment happy-dom
// noteHover.ts 的单测：DOM 适配与悬浮接线。
// resolveNote 用假 book（createDocument 返回 DOMParser 文档）；
// wireNoteHover 的 doc 用 DOMParser 文档加桩 defaultView（happy-dom 拿不到同步 iframe）。

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHref } from "./bookNotes";
import {
  NOTE_CLOSE_DELAY_MS,
  NOTE_HOVER_DELAY_MS,
  createNoteHoverCaches,
  resolveNote,
  wireNoteHover,
  type NoteHoverHost,
} from "./noteHover";

const EPUB_NS = "http://www.idpf.org/2007/ops";

const parseDoc = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

/** 两节假书：第 0 节是正文，第 1 节是注释页。createDocument 计数可查。 */
function fakeBook(ch1Html: string, notesHtml: string) {
  let docCount = 0;
  const docs = [parseDoc(ch1Html), parseDoc(notesHtml)];
  const book = {
    sections: [
      {
        id: "text/ch1.xhtml",
        createDocument: () => {
          docCount += 1;
          return docs[0];
        },
        resolveHref: (href: string) => resolveHref("text/ch1.xhtml", href),
      },
      {
        id: "text/notes.xhtml",
        createDocument: () => {
          docCount += 1;
          return docs[1];
        },
        resolveHref: (href: string) => resolveHref("text/notes.xhtml", href),
      },
    ],
  };
  return { book, docCount: () => docCount };
}

describe("resolveNote", () => {
  it("解析 aside 形态的脚注（元素本身就是正文）", async () => {
    const { book } = fakeBook(
      "<p>正文<sup><a href='notes.xhtml#fn1'>[1]</a></sup></p>",
      "<aside id='fn1'>[1] 六合：天地四方。</aside>",
    );
    const note = await resolveNote(book as never, 0, "notes.xhtml#fn1", createNoteHoverCaches());
    expect(note).toEqual({ text: "[1] 六合：天地四方。", type: null });
  });

  it("认出目标上的 epub:type=footnote（命名空间属性）", async () => {
    const notes = parseDoc("<aside id='fn1'>六合：天地四方。</aside>");
    notes
      .getElementById("fn1")
      ?.setAttributeNS(EPUB_NS, "type", "footnote");
    const book = {
      sections: [
        { id: "text/ch1.xhtml", createDocument: () => parseDoc("<p>x</p>") },
        { id: "text/notes.xhtml", createDocument: () => notes },
      ],
    };
    const note = await resolveNote(book as never, 0, "notes.xhtml#fn1", createNoteHoverCaches());
    expect(note?.type).toBe("footnote");
  });

  it("解析 Calibre 毛批形态：fragment 锚住标记，正文在块级元素里", async () => {
    const { book } = fakeBook(
      "<p>正文<sup><a href='notes.xhtml#pnote1'>〚1〛</a></sup></p>",
      "<p><a id='pnote1'>〚1〛</a>曹真只因要夺司马懿之功。</p>",
    );
    const note = await resolveNote(book as never, 0, "notes.xhtml#pnote1", createNoteHoverCaches());
    expect(note).toEqual({ text: "曹真只因要夺司马懿之功。", type: null });
  });

  it("裸 #frag 按引用所在文件解析，正文剥掉开头标记", async () => {
    const { book } = fakeBook(
      "<div>正文<sup><a href='#note-1'>[1]</a></sup></div><div><a id='note-1'>[1]</a>六合：天地四方。</div>",
      "<p></p>",
    );
    const note = await resolveNote(book as never, 0, "#note-1", createNoteHoverCaches());
    expect(note?.text).toBe("六合：天地四方。");
  });

  it("同一目标重复解析走缓存，不再 createDocument", async () => {
    const { book, docCount } = fakeBook(
      "<p>正文<sup><a href='notes.xhtml#fn1'>[1]</a></sup></p>",
      "<aside id='fn1'>六合：天地四方。</aside>",
    );
    const caches = createNoteHoverCaches();
    const first = await resolveNote(book as never, 0, "notes.xhtml#fn1", caches);
    const second = await resolveNote(book as never, 0, "notes.xhtml#fn1", caches);
    expect(second).toEqual(first);
    expect(docCount()).toBe(1);
  });

  it("fragment 不存在时返回 null", async () => {
    const { book } = fakeBook(
      "<p>正文</p>",
      "<aside id='fn1'>六合</aside>",
    );
    const note = await resolveNote(book as never, 0, "notes.xhtml#missing", createNoteHoverCaches());
    expect(note).toBeNull();
  });
});

/** 在 happy-dom 里搭一个接线环境：happy-dom 的 iframe.contentDocument
 *  拿不到同步文档，用 DOMParser 文档 + 桩 defaultView.frameElement。
 *  touchQuery=true 时 defaultView.matchMedia 桩成触屏（hover:none+coarse）。 */
function wireFixture(chHtml: string, host: Partial<NoteHoverHost>, touchQuery = false) {
  const doc = parseDoc(chHtml);
  const fakeFrame = {
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect,
  };
  const fakeView = {
    frameElement: fakeFrame,
    getComputedStyle: window.getComputedStyle.bind(window),
    ...(touchQuery
      ? { matchMedia: () => ({ matches: true }) as unknown as MediaQueryList }
      : {}),
  };
  Object.defineProperty(doc, "defaultView", { value: fakeView });
  const fullHost: NoteHoverHost = {
    getContainerRect: () =>
      ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect,
    resolve: async () => ({ text: "六合：天地四方。", type: "footnote" as const }),
    onPeek: () => {},
    onClose: () => {},
    isCancelled: () => false,
    ...host,
  };
  const handle = wireNoteHover(doc, 0, fullHost);
  const ref = () => doc.body.querySelector("#ref") as HTMLAnchorElement;
  return { doc, handle, ref };
}

const waitFor = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wireNoteHover", () => {
  it("接线时给引用盖章 data-papr-note，普通链接不盖", () => {
    const { doc, handle } = wireFixture(
      "<p><sup><a href='notes.xhtml#fn1' id='ref'>[1]</a></sup><a href='ch2.xhtml' id='plain'>下一章</a></p>",
      {},
    );
    expect(doc.body.querySelector("#ref")?.hasAttribute("data-papr-note")).toBe(true);
    expect(doc.body.querySelector("#plain")?.hasAttribute("data-papr-note")).toBe(
      false,
    );
    handle.dispose();
  });

  it("悬浮停顿后弹出卡片，解析完成前移开则不弹", async () => {
    const onPeek = vi.fn();
    const { doc, handle } = wireFixture(
      "<p><sup><a href='notes.xhtml#fn1' id='ref'>[1]</a></sup></p>",
      { onPeek },
    );
    const ref = doc.body.querySelector("#ref") as HTMLAnchorElement;
    ref.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await waitFor(NOTE_HOVER_DELAY_MS + 100);
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(onPeek.mock.calls[0][0].text).toBe("六合：天地四方。");
    expect(onPeek.mock.calls[0][0].href).toBe("notes.xhtml#fn1");
    handle.dispose();

    // 解析完成前移开：seq 已推进，卡片不弹。
    const onPeek2 = vi.fn();
    const { doc: doc2, handle: handle2 } = wireFixture(
      "<p><sup><a href='notes.xhtml#fn1' id='ref2'>[1]</a></sup></p>",
      { onPeek: onPeek2 },
    );
    const ref2 = doc2.body.querySelector("#ref2") as HTMLAnchorElement;
    ref2.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await waitFor(NOTE_HOVER_DELAY_MS / 2);
    ref2.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await waitFor(NOTE_HOVER_DELAY_MS + 200);
    expect(onPeek2).not.toHaveBeenCalled();
    handle2.dispose();
  });

  it("移开后延迟收卡，cancelScheduledClose 接住则不收", async () => {
    const onClose = vi.fn();
    const { doc, handle } = wireFixture(
      "<p><sup><a href='notes.xhtml#fn1' id='ref3'>[1]</a></sup></p>",
      { onClose },
    );
    const ref = doc.body.querySelector("#ref3") as HTMLAnchorElement;
    ref.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await waitFor(NOTE_HOVER_DELAY_MS + 100);
    ref.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await waitFor(NOTE_CLOSE_DELAY_MS + 100);
    expect(onClose).toHaveBeenCalledTimes(1);

    // 第二轮：延迟窗口内移进卡片（cancelScheduledClose），不收卡。
    ref.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await waitFor(NOTE_HOVER_DELAY_MS + 100);
    ref.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    handle.cancelScheduledClose();
    await waitFor(NOTE_CLOSE_DELAY_MS + 100);
    expect(onClose).toHaveBeenCalledTimes(1);
    handle.close();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("mousedown 立即收卡", async () => {
    const onClose = vi.fn();
    const { doc, handle } = wireFixture(
      "<p><sup><a href='notes.xhtml#fn1' id='ref4'>[1]</a></sup></p>",
      { onClose },
    );
    const ref = doc.body.querySelector("#ref4") as HTMLAnchorElement;
    ref.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await waitFor(NOTE_HOVER_DELAY_MS + 100);
    ref.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it("dispose 后不再响应悬浮", async () => {
    const onPeek = vi.fn();
    const { doc, handle } = wireFixture(
      "<p><sup><a href='notes.xhtml#fn1' id='ref5'>[1]</a></sup></p>",
      { onPeek },
    );
    handle.dispose();
    const ref = doc.body.querySelector("#ref5") as HTMLAnchorElement;
    ref.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await waitFor(NOTE_HOVER_DELAY_MS + 100);
    expect(onPeek).not.toHaveBeenCalled();
  });
});

describe("wireNoteHover（触屏）", () => {
  const touchDoc = (html: string, host: Partial<NoteHoverHost>) =>
    wireFixture(html, host, true);

  it("点引用立即弹卡并拦下后续 click（不跳转）", async () => {
    const onPeek = vi.fn();
    const { doc, handle } = touchDoc(
      "<p><sup><a href='notes.xhtml#fn1' id='ref'>[1]</a></sup></p>",
      { onPeek },
    );
    const bubbleClick = vi.fn();
    doc.addEventListener("click", bubbleClick);
    const ref = doc.body.querySelector("#ref") as HTMLAnchorElement;
    ref.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(bubbleClick).not.toHaveBeenCalled();
    // 立即弹卡：不等 220ms 悬浮停顿。
    await waitFor(50);
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(onPeek.mock.calls[0][0].href).toBe("notes.xhtml#fn1");
    doc.removeEventListener("click", bubbleClick);
    handle.dispose();
  });

  it("点非引用不拦截，冒泡 click 照常", () => {
    const onPeek = vi.fn();
    const { doc, handle } = touchDoc(
      "<p><sup><a href='notes.xhtml#fn1' id='ref'>[1]</a></sup><a href='ch2.xhtml' id='plain'>下一章</a></p>",
      { onPeek },
    );
    const bubbleClick = vi.fn();
    doc.addEventListener("click", bubbleClick);
    const plain = doc.body.querySelector("#plain") as HTMLAnchorElement;
    plain.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(bubbleClick).toHaveBeenCalledTimes(1);
    expect(onPeek).not.toHaveBeenCalled();
    doc.removeEventListener("click", bubbleClick);
    handle.dispose();
  });

  it("触屏滚动收卡", async () => {
    const onClose = vi.fn();
    const { doc, handle } = touchDoc(
      "<p><sup><a href='notes.xhtml#fn1' id='ref'>[1]</a></sup></p>",
      { onClose },
    );
    const ref = doc.body.querySelector("#ref") as HTMLAnchorElement;
    ref.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    doc.dispatchEvent(new Event("scroll"));
    expect(onClose).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it("桌面（非触屏）不走点按拦截，scroll 也不收卡", async () => {
    const onPeek = vi.fn();
    const onClose = vi.fn();
    const { doc, handle } = wireFixture(
      "<p><sup><a href='notes.xhtml#fn1' id='ref'>[1]</a></sup></p>",
      { onPeek, onClose },
    );
    const ref = doc.body.querySelector("#ref") as HTMLAnchorElement;
    ref.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    doc.dispatchEvent(new Event("scroll"));
    await waitFor(100);
    expect(onPeek).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    handle.dispose();
  });
});
