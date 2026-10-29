import { describe, expect, it } from "vitest";
import {
  ebookFormatOf,
  fileExtensionOf,
  makeBookFile,
  readingStyles,
} from "./foliate";

describe("fileExtensionOf", () => {
  it("取小写扩展名，兼容 Windows 路径与大小写", () => {
    expect(fileExtensionOf("/Users/me/Books/三国演义.EPUB")).toBe("epub");
    expect(fileExtensionOf("C:\\Books\\Novel.Mobi")).toBe("mobi");
  });

  it("没有扩展名或点号出现在目录名里时返回空串", () => {
    expect(fileExtensionOf("/Users/me/v1.2/noext")).toBe("");
    expect(fileExtensionOf("/Users/me/Books/")).toBe("");
  });
});

describe("ebookFormatOf", () => {
  it("识别全部受支持格式", () => {
    for (const format of ["epub", "mobi", "azw3", "fb2", "cbz", "pdf"]) {
      expect(ebookFormatOf(`/books/sample.${format}`)).toBe(format);
    }
  });

  it("不支持的格式与无扩展名返回 null", () => {
    expect(ebookFormatOf("/books/notes.txt")).toBeNull();
    expect(ebookFormatOf("/books/README")).toBeNull();
  });
});

describe("makeBookFile", () => {
  it("按扩展名带上 MIME，让 foliate 走对应的解析器", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(makeBookFile(bytes, "a.epub", "epub").type).toBe(
      "application/epub+zip",
    );
    expect(makeBookFile(bytes, "a.pdf", "pdf").type).toBe("application/pdf");
  });

  it("未指定格式时留空 MIME，交给 foliate 自己嗅探", () => {
    expect(makeBookFile(new Uint8Array([1]), "a.bin").type).toBe("");
  });

  it("保留字节内容与文件名", async () => {
    const file = makeBookFile(new Uint8Array([0xff, 0x00, 0x7f]), "书.mobi", "mobi");
    expect(file.name).toBe("书.mobi");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0x00, 0x7f]),
    );
  });
});

describe("readingStyles", () => {
  it("字号与行高都带 !important，避免被书内 CSS 覆盖", () => {
    const css = readingStyles(19, 2);
    expect(css).toContain("html { font-size: 19px !important; }");
    expect(css).toMatch(/line-height: 2 !important;/);
  });

  it("数值原样带入（小数行高不被截断）", () => {
    expect(readingStyles(15, 1.6)).toContain("line-height: 1.6 !important;");
  });
});
