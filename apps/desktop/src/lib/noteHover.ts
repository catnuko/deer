// 脚注/尾注悬浮预览的 DOM 适配与事件接线（自 luxlore 移植）。
//
// bookNotes.ts 是不碰 DOM 的规则层；这里负责摸真实元素：把属性快照喂给
// 规则、在 section document 上委托 mouseover/mouseout、解析目标章节并
// 通过回调把卡片数据交给 ReaderPage。
//
// 引用形如 [111] 是 <sup> 里一个普通的 <a href="notes.xhtml#rearnote_111">。
// foliate 只处理点击（且只认带命名空间的 epub:type——多数 Calibre 输出用
// 裸 type=，点了没有任何有用的行为）。这里给它接上悬浮：停顿一小会后把
// 目标 fragment 在自己的章节里解析出来弹卡片，不打断当前阅读位置。

import type { Book } from "@/vendor/foliate-js/epub.js";
import {
  NoteCache,
  collapseNoteText,
  isNoteReference,
  noteBodyElement,
  noteTypeOf,
  resolveHref,
  splitHref,
  stripLeadingMarker,
  type NoteRefAttrs,
  type NoteTargetAttrs,
  type NoteType,
} from "./bookNotes";

/** 悬浮停顿：快速扫过一页标记时不应逐个触发解析。 */
export const NOTE_HOVER_DELAY_MS = 220;

/** 离开引用后延迟收卡，给「从引用移进卡片」留出时间窗（卡片可滚动）。 */
export const NOTE_CLOSE_DELAY_MS = 140;

/** 悬浮卡片的数据：锚点矩形已在正文容器坐标系内。 */
export interface NotePeekData {
  anchor: { left: number; top: number; width: number; height: number };
  text: string;
  type: NoteType | null;
  href: string;
}

export interface NoteResolveResult {
  text: string;
  type: NoteType | null;
}

/** 每个 effect 周期一份（换书即弃），缓存 key 不跨书。 */
export interface NoteHoverCaches {
  notes: NoteCache<string, NoteResolveResult>;
  docs: NoteCache<number, Document>;
}

export function createNoteHoverCaches(): NoteHoverCaches {
  return {
    notes: new NoteCache(64),
    docs: new NoteCache(3),
  };
}

/** 把引用元素的属性快照成规则层的输入。 */
function noteRefAttrs(a: HTMLAnchorElement): NoteRefAttrs {
  const view = a.ownerDocument.defaultView;
  const style = view?.getComputedStyle(a);
  const verticalAlign = style?.verticalAlign ?? "";
  return {
    epubType: a.getAttributeNS("http://www.idpf.org/2007/ops", "type"),
    type: a.getAttribute("type"),
    role: a.getAttribute("role"),
    inSup: Boolean(a.closest("sup")),
    superScript:
      verticalAlign === "super" ||
      verticalAlign === "top" ||
      verticalAlign === "text-top" ||
      /^\d/.test(verticalAlign),
    text: a.textContent,
  };
}

/** 把目标元素快照成注释类型规则的输入。 */
function noteTargetAttrs(el: Element): NoteTargetAttrs {
  return {
    epubType: el.getAttributeNS("http://www.idpf.org/2007/ops", "type"),
    type: el.getAttribute("type"),
    role: el.getAttribute("role"),
  };
}

/**
 * 解析一个引用指向的注释体。
 *
 * `index` 是引用所在的 spine item，裸 #frag 按该文件解析；目标章节经
 * sections[i].createDocument() 打开——与渲染器读的是同一份文本，但不惊动
 * 正在显示的那份。结果按 `spine + fragment` 缓存。
 */
export async function resolveNote(
  book: Book,
  index: number,
  rawHref: string,
  caches: NoteHoverCaches,
): Promise<NoteResolveResult | null> {
  const section = book.sections[index];
  if (!section) return null;
  // 优先用 foliate 自己的 per-section 解析器：它知道该 section 的 manifest
  // href 与前导斜杠约定；没有该能力的 section 对象回落手写解析。
  const base = section.id != null ? String(section.id) : "";
  const resolved = section.resolveHref
    ? section.resolveHref(rawHref)
    : resolveHref(base, rawHref);
  const { path, fragment } = splitHref(resolved);
  const targetIndex = book.sections.findIndex((s) => {
    const id = s.id != null ? String(s.id) : "";
    return id === path || id.replace(/^\//, "") === path.replace(/^\//, "");
  });
  if (targetIndex < 0) return null;
  const cacheKey = `${targetIndex}#${fragment}`;
  const cached = caches.notes.get(cacheKey);
  if (cached) return cached;
  const target = book.sections[targetIndex];
  if (!target.createDocument) return null;
  let doc = caches.docs.get(targetIndex);
  if (!doc) {
    doc = await target.createDocument();
    if (!doc) return null;
    caches.docs.set(targetIndex, doc);
  }
  const el = fragment
    ? (doc.getElementById(fragment) ??
      doc.querySelector(`[name="${CSS.escape(fragment)}"]`))
    : null;
  if (!el) return null;
  // 标记锚定型（Calibre 毛批：<a id="pnote116">〚116〛</a>正文…）的
  // fragment 锚住标记本身，正文在所在块级元素里；aside 形态的元素自己
  // 就是正文。
  const bodyEl = noteBodyElement(el);
  const raw = bodyEl.textContent ?? "";
  const markerText = bodyEl === el ? null : (el.textContent ?? "");
  const text = collapseNoteText(
    markerText ? stripLeadingMarker(raw, markerText) : raw,
  );
  if (!text) return null;
  const value: NoteResolveResult = {
    text,
    type: noteTypeOf(noteTargetAttrs(el)) ?? noteTypeOf(noteTargetAttrs(bodyEl)),
  };
  caches.notes.set(cacheKey, value);
  return value;
}

export interface NoteHoverHost {
  /** 正文容器的外框，用于把 iframe 内矩形换算成容器坐标。 */
  getContainerRect: () => DOMRect | null;
  resolve: (index: number, href: string) => Promise<NoteResolveResult | null>;
  /** 停顿到期且解析成功，弹出卡片。 */
  onPeek: (peek: NotePeekData) => void;
  /** 收起卡片（移开/点击/滚动/翻页共用）。 */
  onClose: () => void;
  /** effect 已被拆除（换书/卸载），丢弃一切在途解析。 */
  isCancelled: () => boolean;
}

export interface NoteHoverHandle {
  /** 立即收卡并取消在途悬浮与延迟收卡。 */
  close: () => void;
  /** 取消已排期的延迟收卡（指针移进卡片时由卡片侧调用）。 */
  cancelScheduledClose: () => void;
  /** 摘掉本 doc 上的全部监听。 */
  dispose: () => void;
}

/**
 * 给一个 section document 接上悬浮预览，返回操作句柄。
 *
 * mouseover 冒泡，一个 document 一个监听器覆盖整章所有标记；引用靠事件
 * 目标识别，不做属性盖章以外的任何 DOM 改写（盖章的 data-papr-note 供
 * 注入样式加悬浮提示，见 readingStyles）。
 */
export function wireNoteHover(
  doc: Document,
  index: number,
  host: NoteHoverHost,
): NoteHoverHandle {
  // 盖章在接线时一次完成：注入的样式表只能按普通属性选择（见
  // bookNotes.ts 里对三种引用拼形的说明），裸 type= 与纯上标形 CSS 选不到。
  for (const a of Array.from(
    doc.querySelectorAll<HTMLAnchorElement>("a[href]"),
  )) {
    if (isNoteReference(noteRefAttrs(a))) a.setAttribute("data-papr-note", "");
  }

  let hover: HTMLAnchorElement | null = null;
  let hoverTimer = 0;
  let closeTimer = 0;
  let seq = 0;

  const clearHoverTimer = () => {
    window.clearTimeout(hoverTimer);
    hoverTimer = 0;
  };
  const clearCloseTimer = () => {
    window.clearTimeout(closeTimer);
    closeTimer = 0;
  };

  const close = () => {
    clearHoverTimer();
    clearCloseTimer();
    hover = null;
    seq += 1;
    host.onClose();
  };

  const onOver = (e: Event) => {
    const target = e.target as Element | null;
    const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || !isNoteReference(noteRefAttrs(a))) return;
    clearCloseTimer();
    if (hover === a) return;
    clearHoverTimer();
    hover = a;
    const current = ++seq;
    hoverTimer = window.setTimeout(() => {
      hoverTimer = 0;
      if (host.isCancelled() || hover !== a) return;
      const href = a.getAttribute("href") ?? "";
      void host
        .resolve(index, href)
        .then((note) => {
          if (!note || host.isCancelled()) return;
          // 章节解析期间指针可能已移到别的标记或翻页。
          if (current !== seq || hover !== a) return;
          const rect = a.getBoundingClientRect();
          const frame = doc.defaultView?.frameElement as HTMLElement | null;
          const frameRect = frame?.getBoundingClientRect();
          const containerRect = host.getContainerRect();
          if (!frameRect || !containerRect) return;
          host.onPeek({
            anchor: {
              left: rect.left + frameRect.left - containerRect.left,
              top: rect.top + frameRect.top - containerRect.top,
              width: rect.width,
              height: rect.height,
            },
            ...note,
            href,
          });
        })
        .catch(() => undefined);
    }, NOTE_HOVER_DELAY_MS);
  };

  const onOut = (e: Event) => {
    if (!hover) return;
    const target = e.target as Element | null;
    if (!target?.closest?.("a[href]")) return;
    const related = (e as MouseEvent).relatedTarget as Node | null;
    // 在同一标记内部移动（比如移到内层文本节点）不算离开；移到另一个
    // 标记由下一个 mouseover 重新武装计时器。
    if (related && hover.contains(related)) return;
    // 离开即作废在途悬浮（在途解析完成时 seq 已对不上）；收卡本身延迟
    // 一小会，给「引用 → 卡片」的指针移动留时间窗，卡片侧用
    // cancelScheduledClose 接住；扫向别处时这点延迟肉眼不可见。
    clearHoverTimer();
    hover = null;
    seq += 1;
    clearCloseTimer();
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      close();
    }, NOTE_CLOSE_DELAY_MS);
  };

  // 翻页/滚动/点击都会让锚点矩形失效，卡片必须收起。mousedown（而非
  // click）保证卡片在链接自身跳转发生前就消失。
  const onMouseDown = () => close();
  const onWheel = () => close();

  doc.addEventListener("mouseover", onOver);
  doc.addEventListener("mouseout", onOut);
  doc.addEventListener("mousedown", onMouseDown);
  doc.addEventListener("wheel", onWheel, { passive: true });

  return {
    close,
    cancelScheduledClose: clearCloseTimer,
    dispose: () => {
      seq += 1;
      clearHoverTimer();
      clearCloseTimer();
      hover = null;
      doc.removeEventListener("mouseover", onOver);
      doc.removeEventListener("mouseout", onOut);
      doc.removeEventListener("mousedown", onMouseDown);
      doc.removeEventListener("wheel", onWheel);
    },
  };
}
