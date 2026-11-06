// bookNotes.ts 的单测：纯规则层，不需要 DOM。
// 用例自 luxlore 的 bookNotes.test.ts 移植。

import { describe, expect, it } from "vitest";
import {
  NoteCache,
  collapseNoteText,
  isNoteReference,
  noteBodyElement,
  noteTypeOf,
  placeNoteCard,
  resolveHref,
  splitHref,
  stripLeadingMarker,
} from "./bookNotes";

describe("isNoteReference", () => {
  it("接受带命名空间的 epub:type 形态", () => {
    expect(isNoteReference({ epubType: "noteref" })).toBe(true);
    expect(isNoteReference({ epubType: "biblioref" })).toBe(true);
    expect(isNoteReference({ epubType: "glossref" })).toBe(true);
  });

  it("接受 Calibre/中文出版商的裸 type= 形态", () => {
    expect(isNoteReference({ type: "noteref" })).toBe(true);
  });

  it("接受 ARIA role 形态", () => {
    expect(isNoteReference({ role: "doc-noteref" })).toBe(true);
    expect(isNoteReference({ role: "doc-glossref" })).toBe(true);
  });

  it("无任何属性时，上标数字标记算引用", () => {
    expect(isNoteReference({ inSup: true, text: "[111]" })).toBe(true);
    expect(isNoteReference({ superScript: true, text: "3" })).toBe(true);
    expect(isNoteReference({ inSup: true, text: "（12）" })).toBe(true);
    expect(isNoteReference({ inSup: true, text: "①" })).toBe(true);
  });

  it("认得 Calibre 毛批的 〚116〛", () => {
    expect(isNoteReference({ inSup: true, text: "〚116〛" })).toBe(true);
  });

  it("拒绝上标的非数字链接", () => {
    expect(isNoteReference({ inSup: true, text: "see here" })).toBe(false);
  });

  it("拒绝不上标的普通数字链接", () => {
    // 正文里的章节交叉引用「[111]」不是注释。
    expect(isNoteReference({ text: "[111]" })).toBe(false);
  });

  it("拒绝注释体内的回链", () => {
    expect(
      isNoteReference({ epubType: "noteref backlink", inSup: true, text: "[111]" }),
    ).toBe(false);
    expect(
      isNoteReference({ role: "doc-backlink", inSup: true, text: "1" }),
    ).toBe(false);
  });

  it("多 token 取值按空格拆开看", () => {
    expect(isNoteReference({ epubType: "footnote noteref" })).toBe(true);
    expect(isNoteReference({ epubType: "z3998:roman noteref" })).toBe(true);
  });
});

describe("noteTypeOf", () => {
  it("分类尾注，含 Calibre 的裸 rearnote", () => {
    expect(noteTypeOf({ epubType: "endnote" })).toBe("endnote");
    expect(noteTypeOf({ type: "rearnote" })).toBe("endnote");
    expect(noteTypeOf({ role: "doc-endnote" })).toBe("endnote");
  });

  it("分类脚注与注释", () => {
    expect(noteTypeOf({ type: "footnote" })).toBe("footnote");
    expect(noteTypeOf({ epubType: "note" })).toBe("note");
  });

  it("分类参考文献与释义", () => {
    expect(noteTypeOf({ role: "doc-biblioentry" })).toBe("biblioentry");
    expect(noteTypeOf({ role: "definition" })).toBe("definition");
  });

  it("无标记的元素返回 null", () => {
    expect(noteTypeOf({})).toBe(null);
  });
});

describe("resolveHref", () => {
  it("裸 fragment 按当前 section 解析", () => {
    expect(resolveHref("text/ch1.xhtml", "#fn1")).toBe("text/ch1.xhtml#fn1");
  });

  it("解析同目录兄弟文件", () => {
    expect(resolveHref("text/ch1.xhtml", "notes.xhtml#fn1")).toBe(
      "text/notes.xhtml#fn1",
    );
  });

  it("处理父目录相对路径", () => {
    expect(resolveHref("text/ch1.xhtml", "../notes/fn.xhtml#n1")).toBe(
      "notes/fn.xhtml#n1",
    );
  });

  it("带前导斜杠的路径保持稳定", () => {
    expect(resolveHref("/text/ch1.xhtml", "notes.xhtml#fn1")).toBe(
      "/text/notes.xhtml#fn1",
    );
  });

  it("去掉 query 保留 fragment", () => {
    expect(resolveHref("text/ch1.xhtml", "notes.xhtml?v=2#fn1")).toBe(
      "text/notes.xhtml#fn1",
    );
  });

  it("解码百分号转义路径", () => {
    expect(resolveHref("text/ch1.xhtml", "part%2001.xhtml#fn1")).toBe(
      "text/part 01.xhtml#fn1",
    );
  });

  it("解析失败回落原 href", () => {
    expect(resolveHref("text/ch1.xhtml", "http://[bad")).toBe("http://[bad");
  });
});

describe("splitHref", () => {
  it("拆路径与 fragment", () => {
    expect(splitHref("text/notes.xhtml#fn1")).toEqual({
      path: "text/notes.xhtml",
      fragment: "fn1",
    });
  });

  it("没有 fragment 时返回空串", () => {
    expect(splitHref("text/notes.xhtml")).toEqual({
      path: "text/notes.xhtml",
      fragment: "",
    });
  });
});

describe("collapseNoteText", () => {
  it("折叠标记空白", () => {
    expect(collapseNoteText("\n  [111] 六合：\n  天地四方。  ")).toBe(
      "[111] 六合： 天地四方。",
    );
  });
});

describe("stripLeadingMarker", () => {
  it("剥掉原样的开头标记", () => {
    expect(stripLeadingMarker("〚2321〛曹真只因要夺司马懿之功。", "〚2321〛")).toBe(
      "曹真只因要夺司马懿之功。",
    );
  });

  it("正文把括号规范化后同样剥掉", () => {
    expect(stripLeadingMarker("[111] 六合：天地四方。", "〚111〛")).toBe(
      "六合：天地四方。",
    );
  });

  it("数字只出现在正文中间时不动", () => {
    expect(stripLeadingMarker("见第 111 回。", "〚111〛")).toBe("见第 111 回。");
  });

  it("没有标记时原样返回", () => {
    expect(stripLeadingMarker("正文", null)).toBe("正文");
  });
});

describe("noteBodyElement", () => {
  // 最小化桩：函数只走 matches/parentElement，一条假链覆盖两种形态。
  const fake = (
    tag: string,
    parent: { matches: (sel: string) => boolean; parentElement: unknown } | null,
  ): Element =>
    ({
      matches: (sel: string) => sel.split(", ").includes(tag),
      parentElement: parent,
    }) as unknown as Element;

  it("从行内包装爬到块级元素", () => {
    const p = fake("p", null);
    const sup = fake("sup", p as never);
    const a = fake("a", sup as never);
    expect(noteBodyElement(a)).toBe(p);
  });

  it("本身是注释体时返回自己", () => {
    const aside = fake("aside", null);
    expect(noteBodyElement(aside)).toBe(aside);
  });
});

describe("NoteCache", () => {
  it("取回存储值并刷新新鲜度", () => {
    const cache = new NoteCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    // "a" 现在最新；插入 "c" 驱逐的应是 "b" 而不是 "a"。
    cache.set("c", 3);
    expect(cache.get("b")).toBe(undefined);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("超限驱逐最旧条目", () => {
    const cache = new NoteCache<number, string>(2);
    cache.set(1, "one");
    cache.set(2, "two");
    cache.set(3, "three");
    expect(cache.size).toBe(2);
    expect(cache.get(1)).toBe(undefined);
  });

  it("覆盖已有 key 不增长", () => {
    const cache = new NoteCache<string, number>(2);
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("clear 清空", () => {
    const cache = new NoteCache<string, number>(2);
    cache.set("a", 1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("delete 删除单个 key", () => {
    const cache = new NoteCache<string, number>(2);
    cache.set("a", 1);
    cache.delete("a");
    expect(cache.get("a")).toBe(undefined);
  });
});

describe("placeNoteCard", () => {
  const anchor = { left: 500, top: 300, width: 24, height: 18 };

  it("默认放引用下方并居中", () => {
    const p = placeNoteCard({
      anchor,
      width: 320,
      height: 120,
      viewportWidth: 1200,
      viewportHeight: 800,
    });
    expect(p.above).toBe(false);
    expect(p.left).toBe(512 - 160);
    expect(p.top).toBe(300 + 18 + 8);
  });

  it("下方放不下时翻到上方", () => {
    const p = placeNoteCard({
      anchor: { ...anchor, top: 740 },
      width: 320,
      height: 120,
      viewportWidth: 1200,
      viewportHeight: 800,
    });
    expect(p.above).toBe(true);
    expect(p.top).toBe(740 - 120 - 8);
  });

  it("夹进右边缘", () => {
    const p = placeNoteCard({
      anchor: { ...anchor, left: 1150 },
      width: 320,
      height: 120,
      viewportWidth: 1200,
      viewportHeight: 800,
    });
    expect(p.left).toBe(1200 - 320 - 10);
  });

  it("夹进左边缘", () => {
    const p = placeNoteCard({
      anchor: { ...anchor, left: 4 },
      width: 320,
      height: 120,
      viewportWidth: 1200,
      viewportHeight: 800,
    });
    expect(p.left).toBe(10);
  });

  it("卡片比视口还高时贴顶边保底", () => {
    const p = placeNoteCard({
      anchor: { left: 500, top: 100, width: 24, height: 18 },
      width: 320,
      height: 700,
      viewportWidth: 1200,
      viewportHeight: 400,
    });
    expect(p.above).toBe(false);
    expect(p.top).toBe(10);
  });
});
