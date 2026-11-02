import { describe, expect, it } from "vitest";
import {
  ebookFormatOf,
  fileExtensionOf,
  imageExtensionOf,
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

describe("imageExtensionOf", () => {
  it("按魔数识别 png/jpeg/gif/webp", () => {
    expect(imageExtensionOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("png");
    expect(imageExtensionOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(imageExtensionOf(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe("gif");
    expect(
      imageExtensionOf(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe("webp");
  });

  it("认不出与非图片字节返回 undefined", () => {
    expect(imageExtensionOf(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    // RIFF 头但不是 WEBP（WAV 等）
    expect(
      imageExtensionOf(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
        ]),
      ),
    ).toBeUndefined();
    expect(imageExtensionOf(new Uint8Array())).toBeUndefined();
  });
});

describe("readingStyles", () => {
  it("字号与行高都带 !important，避免被书内 CSS 覆盖", () => {
    const css = readingStyles({ fontSize: 19, lineHeight: 2 });
    expect(css).toContain("html { font-size: 19px !important; }");
    expect(css).toMatch(/line-height: 2 !important;/);
  });

  it("数值原样带入（小数行高不被截断）", () => {
    expect(
      readingStyles({ fontSize: 15, lineHeight: 1.6 }),
    ).toContain("line-height: 1.6 !important;");
  });

  it("传入纸色时压掉书自带的 html/body 背景，不传保持书原样", () => {
    const withPaper = readingStyles({
      fontSize: 15,
      lineHeight: 1.8,
      paperColor: "#c7edcc",
    });
    expect(withPaper).toContain(
      "html, body { background: #c7edcc !important; }",
    );
    expect(readingStyles({ fontSize: 15, lineHeight: 1.8 })).not.toContain(
      "background",
    );
  });

  it("字体跟随书籍时不注入 font-family，衬线/无衬线才注入系统字体栈", () => {
    expect(
      readingStyles({ fontSize: 15, lineHeight: 1.8 }),
    ).not.toContain("font-family");
    expect(
      readingStyles({
        fontSize: 15,
        lineHeight: 1.8,
        fontFamilyCss: '"Songti SC", Georgia, serif',
      }),
    ).toContain('font-family: "Songti SC", Georgia, serif !important;');
  });

  it("页边距按 px 注入 body 左右 padding", () => {
    const css = readingStyles({
      fontSize: 15,
      lineHeight: 1.8,
      pageMarginPx: 40,
    });
    expect(css).toContain("padding-left: 40px !important;");
    expect(css).toContain("padding-right: 40px !important;");
    expect(readingStyles({ fontSize: 15, lineHeight: 1.8 })).not.toContain(
      "padding-left",
    );
  });

  it("关闭脚注预览时不注入悬浮提示样式", () => {
    expect(
      readingStyles({ fontSize: 15, lineHeight: 1.8 }),
    ).toContain("a[data-papr-note]");
    expect(
      readingStyles({ fontSize: 15, lineHeight: 1.8, footnotePreview: false }),
    ).not.toContain("a[data-papr-note]");
  });
});
