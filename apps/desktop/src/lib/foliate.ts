import type { Book, BookMetadata } from "../vendor/foliate-js/epub.js";
import {
  flattenToc,
  type RawTocNode,
  type TocItem,
} from "@/routes/reader/epubToc";
import type { BookFormat } from "@/lib/types";

/**
 * 书籍格式与 foliate-js 之间的桥接层。
 *
 * 喂入方式：把文件字节包成 `File` 直喂 `view.open(file)`。foliate 的
 * `makeBook()` 只在字符串时才 fetch，传 Blob/File 走 `BlobReader` + zip.js，
 * 且 zip.js 已 `configure({ useWebWorkers: false })` —— 不需要 blob: 的 XHR、
 * 不需要 worker、不需要 tauri 的 assetProtocol。
 */
export const EBOOK_FORMATS = [
  "epub",
  "mobi",
  "azw3",
  "fb2",
  "cbz",
  "pdf",
] as const satisfies readonly BookFormat[];

export type EbookFormat = BookFormat;

/** 从路径取小写扩展名（不含点）；无扩展名返回空串。 */
export function fileExtensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1]?.toLowerCase() ?? "";
}

/** 支持的电子书格式；不支持的返回 null（导入时据此拒绝）。 */
export function ebookFormatOf(path: string): EbookFormat | null {
  const ext = fileExtensionOf(path);
  return (EBOOK_FORMATS as readonly string[]).includes(ext)
    ? (ext as EbookFormat)
    : null;
}

const MIME_BY_FORMAT: Record<EbookFormat, string> = {
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  fb2: "application/x-fictionbook+xml",
  cbz: "application/vnd.comicbook+zip",
  pdf: "application/pdf",
};

/** 把从磁盘读到的字节包成 foliate 能直接嗅探的 File。 */
export function makeBookFile(
  bytes: Uint8Array,
  fileName: string,
  format?: EbookFormat,
): File {
  const type = format ? MIME_BY_FORMAT[format] : "";
  return new File([bytes as BlobPart], fileName, { type });
}

/** foliate 的目录项结构 → 阅读页使用的扁平目录（复用 epubToc 的展平逻辑）。 */
export function bookToc(book: Book): TocItem[] {
  return flattenToc((book.toc ?? []) as unknown as RawTocNode[]);
}

export type ReadingStyleOptions = {
  fontSize: number;
  lineHeight: number;
  /** 传入时压掉书自带背景（护眼纸色）；不传保持书原样。 */
  paperColor?: string;
  /** 深色主题：书文档注入深底浅字（书自带白底不压会露出白页）。 */
  dark?: boolean;
  /** 系统字体栈；不传（跟随书籍排版）不注入 font-family。 */
  fontFamilyCss?: string;
  /** 正文左右内边距（px）；不传保持书自带边距。 */
  pageMarginPx?: number;
  /** 脚注悬浮提示样式；关闭时不注入（同时不接线，见 ReaderPage）。 */
  footnotePreview?: boolean;
};

/**
 * 注入正文 iframe 的阅读设置样式。foliate 把它追加在书自带 CSS 之后，
 * 用 !important 保证字号/行高不被书内样式覆盖（这是验收 3 的落点）。
 *
 * paperColor 传入时同时压掉书自带的 html/body 背景（护眼纸色）；
 * 不传保持书原样。paginator 的视口底色由 index.css 的 ::part(filter) 规则
 * 读取同一个 --deer-paper 变量补齐，避免书页四周露出书原背景。
 * dark 时注入深底浅字（阅读区跟随应用深色主题），与 paperColor 互斥使用。
 */
export function readingStyles({
  fontSize,
  lineHeight,
  paperColor,
  dark,
  fontFamilyCss,
  pageMarginPx,
  footnotePreview = true,
}: ReadingStyleOptions): string {
  const paper = paperColor
    ? `
html, body { background: ${paperColor} !important; }
`
    : "";
  // 色值对应应用深色 token：--background oklch(0.145 0 0)、--foreground oklch(0.985 0 0)。
  // 正文文本容器强制继承，压掉书自带的深色字（如 #333），否则深底配深字不可读。
  const darkPaper = dark
    ? `
html, body { background: #0a0a0a !important; color: #fafafa !important; }
h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dt, dd, td, th { color: inherit !important; }
`
    : "";
  const fontFamily = fontFamilyCss
    ? `body, p, div, span { font-family: ${fontFamilyCss} !important; }
`
    : "";
  const pageMargin =
    typeof pageMarginPx === "number"
      ? `body { padding-left: ${pageMarginPx}px !important; padding-right: ${pageMarginPx}px !important; }
`
      : "";
  const footnote = footnotePreview
    ? `
/* 脚注/尾注引用的悬浮提示：接线时盖章 data-papr-note（裸 type= 与纯上标
   形 CSS 选不到，见 noteHover.ts），help 光标 + 悬浮点状下划线。非 EPUB
   不接线不盖章，规则自然失效。 */
a[data-papr-note] { cursor: help; }
a[data-papr-note]:hover {
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-thickness: 1px;
}
`
    : "";
  // 触屏：压掉 iOS 长按弹出的系统级菜单（拷贝/查询），避免与自家的
  // 划选菜单叠加；只动 touch-callout，不碰 user-select（选择手柄必须保留）。
  const touchCallout = `
@media (hover: none) and (pointer: coarse) {
  body, body * { -webkit-touch-callout: none; }
}
`;
  return `
${paper}${darkPaper}html { font-size: ${fontSize}px !important; }
body, p, div, span { line-height: ${lineHeight} !important; }
${fontFamily}${pageMargin}${footnote}${touchCallout}`;
}

export type ImportedMetadata = {
  title?: string;
  author?: string;
  coverBytes?: Uint8Array;
  coverExtension?: string;
};

/** foliate 的元数据字段可能是字符串、多语言对象或它们的数组。 */
function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textOf(item);
      if (text) return text;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string") return record.name.trim();
    for (const item of Object.values(record)) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  return "";
}

const COVER_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function coverExtensionOf(mimeType: string): string {
  return COVER_EXTENSIONS[mimeType.toLowerCase()] ?? "jpg";
}

/** 按图片魔数认真实格式；认不出返回 undefined，由调用方兜底。 */
export function imageExtensionOf(bytes: Uint8Array): string | undefined {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "gif";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return undefined;
}

/**
 * 用 foliate 读非 EPUB 格式的元数据与封面。
 * 解析失败由调用方降级为「文件名 + 未知作者 + 无封面」，不阻断导入。
 */
export async function readImportedMetadata(
  file: File,
): Promise<ImportedMetadata> {
  const { makeBook } = await import("../vendor/foliate-js/view.js");
  const book = await makeBook(file);
  try {
    const metadata = (book.metadata ?? {}) as BookMetadata;
    let coverBytes: Uint8Array | undefined;
    let coverExtension: string | undefined;
    if (typeof book.getCover === "function") {
      const cover = await book.getCover();
      if (cover?.size) {
        coverBytes = new Uint8Array(await cover.arrayBuffer());
        // foliate 对 MOBI/KF8/CBZ 的封面常不带 MIME，按 MIME 兜底成 jpg 会把
        // PNG 封面写错扩展名；魔数嗅探是准的，MIME 只作认不出时的兜底。
        coverExtension =
          imageExtensionOf(coverBytes) ?? coverExtensionOf(cover.type || "");
      }
    }
    return {
      title: textOf(metadata.title) || undefined,
      author: textOf(metadata.author) || undefined,
      coverBytes,
      coverExtension,
    };
  } finally {
    book.destroy?.();
  }
}
