// EPUB 脚注/尾注引用识别与文本清洗的纯函数层（自 luxlore 移植）。
//
// 正文渲染在 foliate 的同源 iframe 里，本模块不碰 DOM：判断一个 <a> 是否
// 脚注引用、目标元素是什么类型的注释、章节相对 href 如何解析，全部只吃
// 属性快照（plain object），因此可以在 node 环境下直接单测。
// 摸真实元素的适配层与悬浮接线在 noteHover.ts。
//
// 为什么不用 foliate 自带的 footnotes.js：它面向「点击后开第二个
// foliate-view 弹窗」的重交互，且只认带命名空间的 epub:type；Calibre 与
// 大量中文电子书写的是裸 type="noteref" / type="rearnote"，foliate 的分支
// 根本不触发。isNoteReference 两种形态都认。

/** 注释目标类型，用于卡片上的小标签。 */
export type NoteType =
  | "footnote"
  | "endnote"
  | "note"
  | "biblioentry"
  | "definition";

/** 判断「是否脚注引用」所需的属性快照。 */
export interface NoteRefAttrs {
  /** 带命名空间的 epub:type。 */
  epubType?: string | null;
  /** 裸 type= —— Calibre/旧式写法。 */
  type?: string | null;
  /** role，如 doc-noteref。 */
  role?: string | null;
  /** 元素本身或其父级是 <sup>。 */
  inSup?: boolean;
  /** 计算 styles 的 vertical-align 是上标形态。 */
  superScript?: boolean;
  /** 去首尾空白的文本内容，供纯数字标记启发式使用。 */
  text?: string | null;
}

/** 判断「目标元素是什么注释」所需的属性快照。 */
export interface NoteTargetAttrs {
  epubType?: string | null;
  type?: string | null;
  role?: string | null;
}

const REF_TYPES = ["biblioref", "glossref", "noteref"];
const REF_ROLES = ["doc-biblioref", "doc-glossref", "doc-noteref"];
const BACKLINK_TYPES = ["backlink"];
const BACKLINK_ROLES = ["doc-backlink"];

/**
 * 注释标记的文本形态：[111]、111、(3)、【2】、全角括号、中文电子书常见的
 * Calibre 毛批 〚116〛（U+301A/301B），以及带圈数字。开闭括号宽松匹配，
 * 配合「上标链接」这一前置条件足够安全。
 */
const NUMERIC_MARK =
  /^[[（【〚]?\s*(?:\d{1,4}|[①-⑳]|[❶-❿])\s*[\])）】〛]?$/;

const tokens = (value?: string | null): Set<string> =>
  new Set((value ?? "").split(/\s+/).filter(Boolean));

const hasAny = (set: Set<string>, wanted: string[]): boolean =>
  wanted.some((w) => set.has(w));

/**
 * 这个链接是不是注释引用（目标为脚注/尾注/注释）。
 *
 * epub:type / role 的显式标记是权威信号；启发式回落覆盖 Calibre 输出与
 * 大量中文 EPUB（两者都什么属性都不标）：只有「上标 + 括号数字」同时
 * 成立才认为是引用，上标词链接与正文里的普通数字链接都被排除。
 */
export function isNoteReference(attrs: NoteRefAttrs): boolean {
  const epub = tokens(attrs.epubType);
  const bare = tokens(attrs.type);
  const roles = tokens(attrs.role);

  // 注释体内部的回链不是引用；当成引用会让注释卡片指向它自己。
  if (hasAny(epub, BACKLINK_TYPES) || hasAny(bare, BACKLINK_TYPES)) return false;
  if (hasAny(roles, BACKLINK_ROLES)) return false;

  if (hasAny(epub, REF_TYPES) || hasAny(bare, REF_TYPES)) return true;
  if (hasAny(roles, REF_ROLES)) return true;

  const superscripted = Boolean(attrs.inSup || attrs.superScript);
  return superscripted && NUMERIC_MARK.test((attrs.text ?? "").trim());
}

/**
 * 给注释目标元素分类；元素没有任何注释语义时返回 null（调用方回落为
 * 无标签卡片）。rearnote 是 Calibre 对尾注的拼写，裸写法同样接受。
 */
export function noteTypeOf(attrs: NoteTargetAttrs): NoteType | null {
  const epub = tokens(attrs.epubType);
  const bare = tokens(attrs.type);
  const roles = tokens(attrs.role);

  if (
    hasAny(roles, ["doc-biblioentry"]) ||
    hasAny(epub, ["biblioentry"]) ||
    hasAny(bare, ["biblioentry"])
  )
    return "biblioentry";
  if (
    hasAny(roles, ["definition"]) ||
    hasAny(epub, ["glossdef"]) ||
    hasAny(bare, ["glossdef"])
  )
    return "definition";
  if (
    hasAny(roles, ["doc-endnote"]) ||
    hasAny(epub, ["endnote", "rearnote"]) ||
    hasAny(bare, ["endnote", "rearnote"])
  )
    return "endnote";
  if (
    hasAny(roles, ["doc-footnote"]) ||
    hasAny(epub, ["footnote"]) ||
    hasAny(bare, ["footnote"])
  )
    return "footnote";
  if (hasAny(roles, ["note"]) || hasAny(epub, ["note"]) || hasAny(bare, ["note"]))
    return "note";
  return null;
}

/**
 * 把 section 内找到的 href 按 section 自身的 manifest href 解析。
 *
 * 与 foliate 内部的 resolveURL 行为一致：去掉 query、保留 fragment、
 * 结果是 manifest 相对路径；裸 #frag 按当前文件解析（同页脚注的常见
 * 形态）。解析失败原样返回。
 */
export function resolveHref(base: string, href: string): string {
  try {
    if (base.includes(":")) return new URL(href, base).href;
    const root = "https://invalid.invalid/";
    const url = new URL(href, root + base);
    url.search = "";
    return decodeURI(url.href.replace(root, ""));
  } catch {
    return href;
  }
}

/** 把解析好的 href 拆成 manifest 路径与 fragment。 */
export function splitHref(href: string): { path: string; fragment: string } {
  const at = href.indexOf("#");
  if (at < 0) return { path: href, fragment: "" };
  return { path: href.slice(0, at), fragment: href.slice(at + 1) };
}

/** 折叠书内标记在提取文本时留下的空白。 */
export function collapseNoteText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * 注释体有两种形态：
 * - aside/脚注体（<aside id="rearnote_111">…</aside>）：元素本身就是注释，
 *   全文即正文；
 * - 标记锚定型（Calibre 毛批：<a id="pnote116">〚116〛</a>曹真只因…）：
 *   fragment 锚住的是标记链接本身，正文在它所在的块级元素剩余部分。
 *   只取 el.textContent 会得到「卡片只显示 〚116〛」的 bug。
 */

/**
 * 从注释体开头剥掉一次标记。仅当正文以标记开头（原文或同数字的括号
 * 变体）才剥；正文后面才出现这个数字的情况不动。
 */
export function stripLeadingMarker(
  body: string,
  markerText: string | null | undefined,
): string {
  const trimmed = body.trimStart();
  if (!markerText) return trimmed;
  const marker = markerText.trim();
  if (marker && trimmed.startsWith(marker)) {
    return trimmed.slice(marker.length).trimStart();
  }
  // 括号数字变体：正文把 〚111〛 规范成了 [111] 这类，同数字即可剥。
  const num = marker.replace(/\D+/g, "");
  if (num) {
    const m = new RegExp(`^[[（【〚]\\s*0*${num}\\s*[\\])）】〛]`).exec(trimmed);
    if (m) return trimmed.slice(m[0].length).trimStart();
  }
  return trimmed;
}

/** 标记可以呆在哪些行内元素里而不把这些容器当成注释体。 */
export const NOTE_INLINE_SELECTOR =
  "a, span, sup, sub, em, strong, i, b, small, big";

/**
 * 注释体所在的元素：锚点自带块级语义（<aside> 体）就是它自己，否则向上
 * 找最近的非行内祖先（毛批形态里的 <p class="calibre16">）。走到头没有
 * 块级祖先时停在锚点，永不返回 null。
 */
export function noteBodyElement(anchor: Element): Element {
  let el: Element | null = anchor;
  while (el && el.matches(NOTE_INLINE_SELECTOR)) {
    el = el.parentElement;
  }
  return el ?? anchor;
}

/**
 * 按访问顺序驱逐的迷你 LRU。
 *
 * 注释体可能躺在另一个 spine item 里（要 createDocument 解析），重复悬浮
 * 或连着一串尾注的章节不应重复解析，大书也不能把摸过的章节全攒着。
 * get 刷新新鲜度，set 超限驱逐最旧。
 */
export class NoteCache<K, V> {
  readonly #map = new Map<K, V>();

  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key) as V;
    // 重新插入，把 key 挪到 Map 顺序的年轻端。
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.limit) {
      const oldest = this.#map.keys().next().value as K;
      this.#map.delete(oldest);
    }
  }

  delete(key: K): void {
    this.#map.delete(key);
  }

  clear(): void {
    this.#map.clear();
  }

  get size(): number {
    return this.#map.size;
  }
}

// ── 卡片定位 ────────────────────────────────────────────────────────────────

/** 定位计算需要的矩形切片。 */
export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NotePlacement {
  left: number;
  top: number;
  /** 卡片被迫放到引用上方时为 true。 */
  above: boolean;
}

export interface PlacementInput {
  /** 引用的矩形，已换算到容器坐标系。 */
  anchor: AnchorRect;
  /** 卡片测量尺寸；未测量前传预期宽度与估计高度，首帧后再重放。 */
  width: number;
  height: number;
  /** 定位参照视口的宽高（Deer 里是正文容器）。 */
  viewportWidth: number;
  viewportHeight: number;
  /** 引用与卡片的间距。 */
  gap?: number;
  /** 视口边缘的保底留白。 */
  margin?: number;
}

/**
 * 把注释卡片放在引用附近：默认下方，下方放不下且上方放得下时翻到上方，
 * 水平以引用为中心，最后整体夹进视口。
 */
export function placeNoteCard({
  anchor,
  width,
  height,
  viewportWidth,
  viewportHeight,
  gap = 8,
  margin = 10,
}: PlacementInput): NotePlacement {
  const centre = anchor.left + anchor.width / 2;
  const left = centre - width / 2;
  const below = anchor.top + anchor.height + gap;
  const aboveTop = anchor.top - height - gap;
  // 优先下方；只有下方溢出且上方放得下才翻。
  const flip = below + height > viewportHeight - margin && aboveTop >= margin;
  const rawTop = flip ? aboveTop : below;
  const clampedLeft = Math.max(
    margin,
    Math.min(left, viewportWidth - width - margin),
  );
  const clampedTop = Math.max(
    margin,
    Math.min(rawTop, viewportHeight - height - margin),
  );
  return { left: clampedLeft, top: clampedTop, above: flip };
}
