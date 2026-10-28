import { strFromU8, unzipSync } from "fflate";

/**
 * EPUB 元数据。只读解析，不改动归档内容。
 * 解析链路：META-INF/container.xml → OPF 的 <metadata> / <manifest>。
 */
export type EpubMeta = {
  title: string;
  author: string;
  identifier?: string;
  language?: string;
  opfPath: string;
  coverBytes?: Uint8Array;
  /** 封面文件扩展名（不含点，已小写），如 jpg / png */
  coverExtension?: string;
};

export class EpubParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubParseError";
  }
}

const CONTAINER_PATH = "META-INF/container.xml";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** 解 XML 实体（含数字字符引用）。 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      safeFromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** 去掉 CDATA/标签并压缩空白，用于标题、作者这类纯文本字段。 */
function cleanText(raw?: string | null): string {
  if (!raw) return "";
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutTags = withoutCdata.replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

/** 取第一个匹配的标签文本，允许任意命名空间前缀（dc:title / title 都行）。 */
function tagText(xml: string, localName: string): string | undefined {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`,
    "i",
  );
  const match = xml.match(re);
  return match ? cleanText(match[1]) : undefined;
}

/** 解析标签属性，键统一小写（命名空间前缀保留，如 opf:role）。 */
function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? "",
    );
  }
  return attributes;
}

function dirName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** 把 href 相对 OPF 目录解析成 zip 内的绝对条目名。 */
function resolveZipPath(baseDir: string, href: string): string {
  let decoded = href.split("#")[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // 非法转义就按原样使用
  }
  const segments: string[] = [];
  for (const segment of `${baseDir}/${decoded}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

function extensionFrom(mediaType: string | undefined, href: string): string {
  if (mediaType && IMAGE_EXTENSIONS[mediaType.toLowerCase()]) {
    return IMAGE_EXTENSIONS[mediaType.toLowerCase()];
  }
  const match = href.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  return match && IMAGE_EXTENSIONS[`image/${match[1]}`]
    ? IMAGE_EXTENSIONS[`image/${match[1]}`]
    : (match?.[1] ?? "jpg");
}

/**
 * 从 EPUB 字节流解析元数据与封面。
 * 失败一律抛 EpubParseError，调用方可降级为「文件名 + 无封面」。
 */
export function parseEpub(bytes: Uint8Array): EpubMeta {
  if (bytes.byteLength === 0) throw new EpubParseError("文件为空");

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new EpubParseError(
      `不是有效的 ZIP/EPUB 归档：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const containerBytes = entries[CONTAINER_PATH];
  if (!containerBytes) throw new EpubParseError("缺少 META-INF/container.xml");

  const containerXml = strFromU8(containerBytes);
  const rootfileTag = containerXml.match(/<rootfile\b[^>]*>/i);
  const opfPath = rootfileTag
    ? parseAttributes(rootfileTag[0])["full-path"]
    : undefined;
  if (!opfPath) throw new EpubParseError("container.xml 里没有 full-path");

  const opfBytes = entries[opfPath];
  if (!opfBytes) throw new EpubParseError(`OPF 不存在：${opfPath}`);
  const opfXml = strFromU8(opfBytes);

  const title = tagText(opfXml, "title") ?? "";
  const author = tagText(opfXml, "creator") ?? "";

  const manifestItems = (opfXml.match(/<item\b[^>]*>/gi) ?? []).map(
    (tag) => parseAttributes(tag) as {
      id?: string;
      href?: string;
      "media-type"?: string;
      properties?: string;
    },
  );

  // 封面：① properties 含 cover-image ② <meta name="cover" content="id"> 指向的项 ③ href 里带 cover 的图片
  let coverItem = manifestItems.find((item) =>
    (item.properties ?? "").split(/\s+/).includes("cover-image"),
  );

  if (!coverItem) {
    const metaTag = opfXml.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*>/i);
    const coverId = metaTag ? parseAttributes(metaTag[0]).content : undefined;
    if (coverId) coverItem = manifestItems.find((item) => item.id === coverId);
  }

  if (!coverItem) {
    coverItem = manifestItems.find(
      (item) =>
        (item["media-type"] ?? "").startsWith("image/") &&
        /cover/i.test(item.href ?? ""),
    );
  }

  let coverBytes: Uint8Array | undefined;
  let coverExtension: string | undefined;
  if (coverItem?.href) {
    const coverPath = resolveZipPath(dirName(opfPath), coverItem.href);
    const data = entries[coverPath];
    if (data?.byteLength) {
      coverBytes = data;
      coverExtension = extensionFrom(coverItem["media-type"], coverItem.href);
    }
  }

  return {
    title,
    author,
    identifier: tagText(opfXml, "identifier"),
    language: tagText(opfXml, "language"),
    opfPath,
    coverBytes,
    coverExtension,
  };
}
