/**
 * Type declarations for the vendored foliate-js snapshot.
 *
 * 上游是纯 JavaScript，不带任何类型。本仓的 `tsconfig.json` 没有 `allowJs`，
 * 所以 `src/vendor/foliate-js/*.js` 不参与编译 —— 要想在 TS 里 import 它们，
 * 必须在本文件里先声明对应的 ambient module。
 *
 * 声明路径写成 `*vendor/foliate-js/<file>.js`（前导 `*`，非完整通配）：
 * 相对导入 `../vendor/foliate-js/view.js` 与绝对导入都能匹配到，
 * 又不会误捕获仓库里其他同名的 `view.js`。
 *
 * 所有签名对齐上游 commit `78914aef4466eb960965702401634c2cb348e9b1` 的源码，
 * 并与上游 `README.md` 的接口文档交叉核对。凡与直觉不符之处都在注释里写明依据。
 * 上游明确声明 API 不稳定，**bump commit 后必须回来重核**（见 VENDORED.md）。
 *
 * 未在此声明文件里覆盖的 foliate 模块（`opds.js` / `dict.js` / `ui/*` 等）
 * 一旦被 import，TS 会给出 TS7016（implicitly has an 'any' type）——
 * 这是刻意的：宁可显式报错要求补声明，也不要写一个错误的"精确"类型。
 */

// ---------------------------------------------------------------------------
// view.js
// ---------------------------------------------------------------------------

declare module "*vendor/foliate-js/view.js" {
    import type { Book } from "*vendor/foliate-js/epub.js";

    /** 上游把 `fetch` 得到非 2xx 响应时抛这个。 */
    export class ResponseError extends Error {}

    /** 文件为空（`file.size` 为 0）时抛出。 */
    export class NotFoundError extends Error {}

    /** `makeBook` 无法识别文件类型时抛出。 */
    export class UnsupportedTypeError extends Error {}

    /**
     * `View.open()` 接受的输入。
     *
     * 源码判断（`view.js` 的 `open()`）：`typeof book === 'string'`
     * （当作 URL 交给 `fetch`）、有 `arrayBuffer` 方法（`File`/`Blob`）、
     * 或 `isDirectory` 为真（未打包的目录，走 Directory 加载器）。
     * 其余情况当作已经实现 book 接口的对象直接使用。
     */
    export type OpenableFile =
        | string
        | Blob
        | Book
        | { isDirectory: true; [key: string]: unknown };

    /** TOC / pageList 的一项。`href` 可为 null（纯分组节点）。 */
    export interface TocItem {
        label: string;
        href: string | null;
        subitems?: TocItem[] | null;
        /** 由 `progress.js` 的 `assignIDs()` 在 `TOCProgress.init()` 中写入。 */
        id?: number;
        /** 受 landmarks 使用，如 `["bodymatter"]`。 */
        type?: string[];
    }

    /** `resolveHref()` / `resolveCFI()` / `resolveNavigation()` 的返回值。 */
    export interface ResolvedTarget {
        index: number;
        /**
         * 给定 `Document` 返回该位置对应的节点。
         * - `Element`：命中的锚点元素
         * - `Range`：CFI 范围
         * - `number`：没有片段标识符时的占位（`epub.js` 返回 `() => 0`，表示段首）
         */
        anchor?: (doc: Document) => Range | Element | number | null;
    }

    /** `goTo()` / `select()` / `showAnnotation()` 的入参。 */
    export type GoToTarget =
        | string
        | number
        | { fraction: number }
        | ResolvedTarget;

    /**
     * `relocate` 事件 payload，即 `View.lastLocation`。
     *
     * 由 `SectionProgress.getProgress()` 的返回值展开，再补上 `tocItem` /
     * `pageItem` / `cfi` / `range`。
     *
     * 字段全部声明为可选：`#onRelocate()` 里 `#sectionProgress?.getProgress(...) ?? {}`
     * 意味着在 `open()` 尚未完成（或该书不提供 `splitTOCHref`）时，这些字段会整体缺失。
     */
    export interface RelocateDetail {
        /** 全书进度，0..1。 */
        fraction?: number;
        section?: { current: number; total: number };
        location?: { current: number; next: number; total: number };
        /** 剩余阅读时间估算（来源是字节数，不是真实时长）。 */
        time?: { section: number; total: number };
        tocItem?: TocItem | null;
        pageItem?: TocItem | null;
        /** 当前可见区域的 CFI。 */
        cfi?: string;
        /** 当前可见区域的 `Range`。 */
        range?: Range;
    }

    /** `load` 事件：某个 section 的文档已加载。 */
    export interface LoadDetail {
        doc: Document;
        index: number;
    }

    /**
     * `draw-annotation` 事件：请调用方自己画。
     *
     * `draw` 是绑定好的绘制入口 —— 调用它等价于 `overlayer.add(value, range, draw, opts)`。
     * 本仓的划线与批注渲染就挂在这里。
     */
    export interface DrawAnnotationDetail {
        draw: (
            draw: (rects: DOMRectList, options?: Record<string, unknown>) => SVGElement,
            opts?: Record<string, unknown>,
        ) => void;
        annotation: Annotation;
        doc: Document | null;
        range: Range;
    }

    /** 注解对象。上游只强制要求 `value` 字段（CFI 字符串）。 */
    export interface Annotation {
        value: string;
        [key: string]: unknown;
    }

    /** 搜索产出的单条结果。 */
    export interface SearchResult {
        cfi?: string;
        excerpt?: { pre: string; match: string; post: string };
        label?: string;
        index?: number;
        subitems?: Array<{ cfi: string; excerpt: SearchResult["excerpt"] }>;
        /** 本书内的扫描进度，0..1。 */
        progress?: number;
    }

    export interface SearchOptions {
        query: string;
        /** 只搜某个 section；省略则搜全书。 */
        index?: number;
        matchCase?: boolean;
        matchDiacritics?: boolean;
        matchWholeWords?: boolean;
        /** 自定义绘制函数，默认 `Overlayer.outline`。 */
        draw?: (rects: DOMRectList, options?: Record<string, unknown>) => SVGElement;
        drawOptions?: Record<string, unknown>;
        [key: string]: unknown;
    }

    /** `View` 派发的自定义事件。 */
    export interface ViewEventMap extends HTMLElementEventMap {
        /** 阅读位置变化。这是本仓跟踪进度的主要来源。 */
        relocate: CustomEvent<RelocateDetail>;
        /** 某个 section 加载完成，可以注入样式了。 */
        load: CustomEvent<LoadDetail>;
        /** 某个 section 的 overlayer 已创建，可在此注册高亮。 */
        "create-overlay": CustomEvent<{ index: number }>;
        /** 用户点到了已有注解，或 `showAnnotation()` 被调用。 */
        "show-annotation": CustomEvent<{
            value: string;
            index: number;
            range: Range;
        }>;
        /**
         * 该书内部指向外部链接。**可取消**：`preventDefault()`
         * （或在 handler 里 `return false`，上游用 `Promise.resolve(...).then` 接返回值）
         * 可阻止上层打开新窗口。
         */
        "external-link": CustomEvent<{ a: HTMLAnchorElement; href_: string }>;
        /** 书内跳转链接，同样可取消。 */
        link: CustomEvent<{ a: HTMLAnchorElement; href: string }>;
        /** 请求调用方绘制注解。 */
        "draw-annotation": CustomEvent<DrawAnnotationDetail>;
    }

    /** 渲染器接口（`paginator.js` / `fixed-layout.js` 都实现它）。 */
    export interface Renderer extends HTMLElement {
        open(book: Book): void;
        goTo(target: ResolvedTarget & { select?: boolean }): Promise<void>;
        prev(distance?: number): Promise<void>;
        next(distance?: number): Promise<void>;
        getContents(): Array<{
            doc: Document;
            index: number;
            overlayer?: unknown;
        }>;
        destroy(): void;
    }

    export class View extends HTMLElement {
        /**
         * @param file URL 字符串、`File`/`Blob`、未打包目录，或 book 对象。
         *   前三种会先过 `makeBook()` 做格式嗅探。
         */
        open(file: OpenableFile): Promise<void>;

        /** 渲染完成后调用，恢复上次位置或跳到正文开头。 */
        init(options: {
            lastLocation?: string | null;
            showTextStart?: boolean;
        }): Promise<void>;

        close(): void;
        goToTextStart(): Promise<ResolvedTarget | undefined>;
        goTo(target: GoToTarget): Promise<ResolvedTarget | undefined>;
        goToFraction(fraction: number): Promise<void>;
        /** 跳转并选中目标（用于定位到批注）。 */
        select(target: GoToTarget): Promise<void>;
        deselect(): void;
        prev(distance?: number): Promise<void>;
        next(distance?: number): Promise<void>;
        goLeft(): Promise<void>;
        goRight(): Promise<void>;

        /** 由 index + 可选 `Range` 生成 CFI。 */
        getCFI(index: number, range?: Range | null): string;
        resolveCFI(cfi: string): ResolvedTarget;
        /** 接受 href 字符串 / section 序号 / CFI / `{ fraction }`。 */
        resolveNavigation(target: GoToTarget): ResolvedTarget | undefined;
        /** 每个 section 的起止进度，长度比 section 数多一。 */
        getSectionFractions(): number[];
        getProgressOf(
            index: number,
            range?: Range | null,
        ): { tocItem?: TocItem | null; pageItem?: TocItem | null };
        getTOCItemOf(target: GoToTarget): Promise<TocItem | undefined>;

        /**
         * 添加注解。
         *
         * 第二个参数为 `true` 时是「移除」语义（`deleteAnnotation` 就是
         * 这么转发的）——上游用它复用同一套解算逻辑。
         *
         * @returns 解算出的 section 序号与该节 TOC 标签；无法解算时为 `undefined`。
         */
        addAnnotation(
            annotation: Annotation,
            remove?: boolean,
        ): Promise<{ index: number; label: string } | undefined>;
        deleteAnnotation(
            annotation: Annotation,
        ): Promise<{ index: number; label: string } | undefined>;
        /** 跳转到注解位置并派发 `show-annotation`。 */
        showAnnotation(annotation: Annotation): Promise<void>;

        search(options: SearchOptions): AsyncGenerator<SearchResult | "done">;
        clearSearch(): void;

        initTTS(
            granularity?: "word" | "sentence",
            highlight?: (range: Range) => void,
        ): Promise<void>;
        startMediaOverlay(): Promise<void>;

        /** 当前书的元数据语言解析结果。 */
        language: {
            canonical?: string;
            locale?: Intl.Locale;
            isCJK?: boolean;
            direction?: string;
        };
        book: Book;
        renderer: Renderer;
        isFixedLayout: boolean;
        lastLocation: RelocateDetail | null;

        // 事件重载：先给自定义事件表，再兜底到标准签名，
        // 这样 `"click"` 等标准事件仍然可用。
        addEventListener<K extends keyof ViewEventMap>(
            type: K,
            listener: (this: View, ev: ViewEventMap[K]) => void,
            options?: boolean | AddEventListenerOptions,
        ): void;
        addEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions,
        ): void;

        removeEventListener<K extends keyof ViewEventMap>(
            type: K,
            listener: (this: View, ev: ViewEventMap[K]) => void,
            options?: boolean | EventListenerOptions,
        ): void;
        removeEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | EventListenerOptions,
        ): void;
    }

    /**
     * 格式嗅探 + 加载器选择：EPUB / FB2 / MOBI / KF8 / CBZ / PDF（实验性）。
     * `View.open()` 内部就是调它。
     */
    export const makeBook: (
        file: string | Blob | { isDirectory: true },
    ) => Promise<Book>;

    declare global {
        interface HTMLElementTagNameMap {
            /** `view.js` 末尾有 `customElements.define('foliate-view', View)`。 */
            "foliate-view": View;
        }
    }
}

// ---------------------------------------------------------------------------
// epub.js
// ---------------------------------------------------------------------------

declare module "*vendor/foliate-js/epub.js" {
    /**
     * book 接口的 loader 部分。由调用方提供（`view.js` 用 zip.js / Directory
     * 各实现了一套）。
     *
     * 只有 `loadText` / `loadBlob` 允许返回 Promise（上游 README 明确写
     * "May be async"）。
     */
    export interface Loader {
        /**
         * 返回指定路径的文本内容。
         *
         * `null` 是合法返回：上游在多处直接 `if (!str) return null`，
         * 例如 `META-INF/encryption.xml` 与 `com.apple.ibooks.display-options.xml`
         * 这类可选文件缺失时。
         */
        loadText: (
            name: string,
        ) => string | null | Promise<string | null>;
        /** 返回指定路径的二进制内容。`type` 供 zip.js 的 `BlobWriter` 使用。 */
        loadBlob: (
            name: string,
            type?: string,
        ) => Blob | null | Promise<Blob | null>;
        /**
         * 返回文件字节数，用于 `.sections[].size` 与阅读进度估算。
         *
         * **同步返回 `number`，不是 Promise。** 依据两点：
         * 1. 上游 README 只给 `loadText` / `loadBlob` 标了 "May be async"，
         *    `getSize` 的说明是 "returns the file size in bytes"；
         * 2. `epub.js` 里是 `size: this.getSize(item.href)` —— 直接赋值、**不 await**；
         *    `comic-book.js` 同样是 `size: getSize(name)`。
         *
         * 因此若传入异步实现，`.size` 会变成 Promise 对象，而
         * `SectionProgress` 构造函数里的 `s.size > 0` 判断对 Promise 恒为 false，
         * 该 section 会被当成 0 字节 —— 进度条静默错乱。
         */
        getSize?: (name: string) => number;
        /**
         * 覆盖默认的 Web Crypto SHA-1 实现，用于 IDPF 字体去混淆。
         * 默认实现在非安全上下文（非 HTTPS）不可用，Tauri 里应按需注入。
         */
        sha1?: (str: string) => Uint8Array | Promise<Uint8Array>;
    }

    /** 一本书的一个 section（一个 spine item）。 */
    export interface Section {
        /** 返回可被渲染的 URL 字符串。 */
        load: () => string | Promise<string>;
        /** 若存在，可用于释放该 section 占用的资源。 */
        unload?: () => void;
        /** 解析为 `Document`，供搜索使用。 */
        createDocument?: () => Document | Promise<Document>;
        /** 字节数，用于进度估算。 */
        size?: number;
        /** 为 `"no"` 时表示不在线性阅读序列内（EPUB `linear` 属性）。 */
        linear?: string;
        /** 该 section 的基础 CFI（CFI 中 `!` 之前的部分）。 */
        cfi?: string;
        /** 标识符，需能作为 `Map` 的键。 */
        id?: unknown;
        pageSpread?: string;
        resolveHref?: (href: string) => string;
        mediaOverlay?: unknown;
    }

    /**
     * 书籍元数据。
     *
     * 上游注明「大致遵循 Readium webpub manifest 的 schema」，且
     * **标题与作者等字段可能是字符串，也可能是多语言对象**
     * （如 `{ ja: "草枕", en: "Kusamakura" }`）或它们的数组。
     * 这里用联合类型如实表达，读取时务必先窄化。
     */
    export interface BookMetadata {
        title?: string | Record<string, string>;
        subtitle?: string | Record<string, string>;
        identifier?: string;
        language?: string | string[];
        publisher?: string | string[];
        author?: LocalizedValue | LocalizedValue[];
        contributor?: LocalizedValue | LocalizedValue[];
        translator?: LocalizedValue | LocalizedValue[];
        editor?: LocalizedValue | LocalizedValue[];
        illustrator?: LocalizedValue | LocalizedValue[];
        /** 出版日期，字符串形式。 */
        published?: string;
        modified?: string;
        description?: string;
        subject?: string | string[];
        [key: string]: unknown;
    }

    export type LocalizedValue = string | { name: string | Record<string, string>; [key: string]: unknown };

    /**
     * book 接口（各格式处理器统一返回这个形状）。
     * `EPUB` 是其中之一，`comic-book.js` / `fb2.js` / `mobi.js` / `pdf.js`
     * 返回的对象也满足它。
     */
    export interface Book {
        sections: Section[];
        /** 翻页方向，`"rtl"` 或 `"ltr"`。 */
        dir?: string;
        toc?: TocItem[] | null;
        pageList?: TocItem[] | null;
        landmarks?: TocItem[] | null;
        metadata?: BookMetadata;
        /** 与 EPUB rendition properties 对应；`.layout === 'pre-paginated'` 走固定版式渲染器。 */
        rendition?: { layout?: string; [key: string]: unknown };
        media?: { activeClass?: string; playbackActiveClass?: string; [key: string]: unknown };

        resolveHref?: (href: string) => ResolvedTarget | null;
        resolveCFI?: (cfi: string) => ResolvedTarget | null;
        /** 为 `true` 时该链接应在外部打开。 */
        isExternal?: (href: string) => boolean;
        /**
         * 把 TOC href 切成 `[sectionId, fragment]`，供 `progress.js`
         * 计算 TOC / 页列表归属。可异步。
         */
        splitTOCHref?: (href: string) => string[] | Promise<string[]>;
        /**
         * 由 fragment 取回节点，供 `progress.js` 定位 TOC 项。
         *
         * fragment 声明为 `string | null` 而非 `unknown`：上游 README 说它
         * "can be any type"，但 `epub.js` 的 `splitTOCHref()` 产出的是
         * `string[]`，`getTOCFragment()` 又直接把它交给 `getElementById`
         * 与 `CSS.escape` —— 只能是字符串或 null（`comic-book.js` 的
         * `splitTOCHref` 正是 `[href, null]`）。用 `unknown` 会让
         * `EPUB implements Book` 因函数参数逆变而无法成立。
         */
        getTOCFragment?: (doc: Document, id: string | null) => Node | null;
        getCover?: () => Promise<Blob | null>;
        destroy?: () => void;
        /** 若存在，可用于在内容加载时改写资源。 */
        transformTarget?: EventTarget;
    }

    /** 与 `view.js` 共享的结构（`ResolvedTarget` / `TocItem`），此处重复声明以免跨模块循环。 */
    interface ResolvedTarget {
        index: number;
        anchor?: (doc: Document) => Range | Element | number | null;
    }
    interface TocItem {
        label: string;
        href: string | null;
        subitems?: TocItem[] | null;
        id?: number;
        type?: string[];
    }

    /** EPUB 解析器：实现 book 接口。 */
    export class EPUB implements Book {
        constructor(loader: Loader);

        /**
         * 解析 `META-INF/container.xml` 与 OPF，填充 `sections` / `toc` / `metadata` 等。
         * @returns `this`，因此可以直接 `await new EPUB(loader).init()`。
         */
        init(): Promise<this>;

        /** 解析单个 spine item 为 `Document`。 */
        loadDocument(item: unknown): Promise<Document>;

        getMediaOverlay(): unknown;
        resolveCFI(cfi: string): ResolvedTarget | null;
        resolveHref(href: string): ResolvedTarget | null;
        /** 在 `#` 处切分 TOC href。 */
        splitTOCHref(href: string): string[];
        /** 与 `Book.getTOCFragment` 同一份契约；`id` 为 null 时返回 null。 */
        getTOCFragment(doc: Document, id: string | null): Element | null;
        isExternal(uri: string): boolean;
        getCover(): Promise<Blob | null>;
        /** 读取 Calibre 写入的 `calibre_bookmarks.txt`（若有）。 */
        getCalibreBookmarks(): Promise<unknown>;
        destroy(): void;

        sections: Section[];
        toc: TocItem[] | null;
        pageList: TocItem[] | null;
        landmarks: TocItem[] | null;
        metadata: BookMetadata;
        rendition: { layout?: string; [key: string]: unknown };
        media: { activeClass?: string; playbackActiveClass?: string; [key: string]: unknown };
        dir: string;
        loadText: Loader["loadText"];
        loadBlob: Loader["loadBlob"];
        getSize: Loader["getSize"];
        transformTarget: EventTarget;
        resources: unknown;
    }
}

// ---------------------------------------------------------------------------
// epubcfi.js
// ---------------------------------------------------------------------------

declare module "*vendor/foliate-js/epubcfi.js" {
    /**
     * CFI 的一个「part」，对应 CFI 里一步 + 偏移。
     * 形如 `{ index, id, offset, temporal, spatial, text, side }`。
     */
    export interface Part {
        index: number;
        id?: string | null;
        /** 字符偏移。**仅对 `index` 为奇数的 step 有效**（上游 `partToString` 里的 `index % 2`）。 */
        offset?: number | null;
        temporal?: number;
        spatial?: number[];
        text?: string[];
        side?: string;
    }

    /** 一条完整路径：一串 part。 */
    export type Path = Part[];

    /** 折叠后的（无范围的）CFI 解析结果：路径的数组（`!` 分隔的间接引用）。 */
    export type CollapsedCFI = Path[];

    /** 范围 CFI 的解析结果。 */
    export interface RangeCFI {
        parent: CollapsedCFI;
        start: CollapsedCFI;
        end: CollapsedCFI;
    }

    export type ParsedCFI = CollapsedCFI | RangeCFI;

    /** 测试字符串是否为 `epubcfi(...)` 形式。带 `g` 以外的状态，注意别复用 `lastIndex`。 */
    export const isCFI: RegExp;

    /** 用 `!` 连接已折叠的 CFI（输入可以带或不带 `epubcfi()` 外壳）。 */
    export const joinIndir: (...parts: string[]) => string;

    /** 解析 CFI 字符串为结构化对象。 */
    export const parse: (cfi: string) => ParsedCFI;

    /** 折叠为起点（默认）或终点。接受字符串则返回字符串，接受解析结果则返回解析结果。 */
    export function collapse(cfi: string, toEnd?: boolean): string;
    export function collapse(cfi: ParsedCFI, toEnd?: boolean): CollapsedCFI;

    /** 比较两个 CFI 的先后：`-1` / `0` / `1`。 */
    export const compare: (a: string | ParsedCFI, b: string | ParsedCFI) => number;

    /**
     * 由 `Range` 生成 CFI。
     *
     * @param filter 与 `TreeWalker` 的 filter 类似，返回
     *   `NodeFilter.FILTER_ACCEPT` / `FILTER_REJECT` / `FILTER_SKIP`。
     *   用于让本仓注入的节点（如高亮标记）不影响 CFI 编号。
     */
    export const fromRange: (range: Range, filter?: NodeFilter) => string;

    /** 由解析后的 CFI 与 `Document` 还原 `Range`。 */
    export const toRange: (doc: Document, parts: ParsedCFI, filter?: NodeFilter) => Range;

    /** 为同一父节点下、已按文档顺序排列的元素批量生成 CFI（比逐个 `fromRange` 快）。 */
    export const fromElements: (elements: Element[]) => string[];

    /** 由解析后的 CFI 与 `Document` 还原单个元素。 */
    export const toElement: (doc: Document, parts: ParsedCFI) => Node;

    /**
     * 在没有真实 package document 时，用 spine 序号伪造标准 CFI。
     * `fromIndex(index)` 产出 `epubcfi(/6/<2*(index+1)>)`。
     */
    export const fake: {
        fromIndex: (index: number) => string;
        toIndex: (parts: Path) => number;
    };

    /** 从 Calibre 的位置字符串还原 CFI。 */
    export const fromCalibrePos: (pos: string) => string;
    /** 从 Calibre 的高亮记录还原范围 CFI。 */
    export const fromCalibreHighlight: (highlight: {
        spine_index: number;
        start_cfi: string;
        end_cfi: string;
    }) => string;
}

// ---------------------------------------------------------------------------
// overlayer.js
// ---------------------------------------------------------------------------

declare module "*vendor/foliate-js/overlayer.js" {
    /** 绘制函数的通用选项。各静态方法只取用自己需要的字段。 */
    export interface DrawOptions {
        color?: string;
        /** 线宽（像素）。注意上游内部叫 `strokeWidth`，对外键名是 `width`。 */
        width?: number;
        /** `vertical-rl` / `vertical-lr` 时按竖排方式绘制。 */
        writingMode?: string;
        /** 仅 `outline` 使用。 */
        radius?: number;
        /** 仅 `copyImage` 使用。 */
        src?: string;
        [key: string]: unknown;
    }

    /** 把一个 `Range` 画成某种 SVG 元素。返回的元素会被插入 overlayer 的 `<svg>`。 */
    export type DrawFunction = (
        rects: DOMRectList,
        options?: DrawOptions,
    ) => SVGElement;

    /**
     * 通用 SVG 叠加层，用于实现批注高亮。
     *
     * 它本身**不监听任何事件**：命中测试要由调用方在需要时主动调 `hitTest()`。
     */
    export class Overlayer {
        /** 叠加层的根 `<svg>`，由渲染器负责插入、定位与缩放。 */
        get element(): SVGSVGElement;

        /**
         * 添加一个叠加项。
         *
         * @param key 唯一键。重复添加同 key 会先移除旧的。
         * @param range `Range`，或「给定根节点返回 `Range`」的惰性函数。
         * @param draw 绘制函数。
         */
        add(
            key: string,
            range: Range | ((root: Node) => Range),
            draw: DrawFunction,
            options?: DrawOptions,
        ): void;

        /** 移除指定 key 的叠加项。不存在时安静返回。 */
        remove(key: string): void;

        /** 重绘全部叠加项（渲染器在版面变化时调用）。 */
        redraw(): void;

        /**
         * 命中测试。
         *
         * @param point 视口坐标（通常是鼠标事件的 `clientX` / `clientY`）。
         * @returns 命中时 `[key, range]`，未命中返回空数组。
         *   注意判定用的是 `Range` 的 client rect，不是 `draw()` 返回的元素。
         */
        hitTest(point: { x: number; y: number }): [string, Range] | [];

        /** 下划线：横排画在底部，竖排画在右侧。 */
        static underline(rects: DOMRectList, options?: DrawOptions): SVGElement;
        /** 删除线：横排画在中线，竖排画在中列。 */
        static strikethrough(rects: DOMRectList, options?: DrawOptions): SVGElement;
        /** 波浪线。 */
        static squiggly(rects: DOMRectList, options?: DrawOptions): SVGElement;
        /** 半透明高亮块（默认透明度走 CSS 变量 `--overlayer-highlight-opacity`）。 */
        static highlight(rects: DOMRectList, options?: DrawOptions): SVGElement;
        /** 圆角描边。`View.search()` 的默认绘制函数。 */
        static outline(rects: DOMRectList, options?: DrawOptions): SVGElement;
        /** 原图副本，便于对整块施加 CSS filter。 */
        static copyImage(rects: DOMRectList, options?: DrawOptions): SVGElement;
    }
}

// ---------------------------------------------------------------------------
// progress.js
// ---------------------------------------------------------------------------

declare module "*vendor/foliate-js/progress.js" {
    import type { Book, Section } from "*vendor/foliate-js/epub.js";
    import type { TocItem } from "*vendor/foliate-js/view.js";

    /** 阅读进度：位置、页码、剩余时间估算。 */
    export interface Progress {
        /** 全书进度，0..1。 */
        fraction: number;
        section: { current: number; total: number };
        location: { current: number; next: number; total: number };
        /** 剩余时间估算。单位由 `sizePerTimeUnit` 决定，并非真实秒数。 */
        time: { section: number; total: number };
    }

    /**
     * 根据当前位置反查所属的 TOC / 页列表项。
     *
     * `init()` 必须在使用前调用；未初始化时 `getProgress()` 返回 `undefined`。
     */
    export class TOCProgress {
        init(options: {
            toc: TocItem[];
            /** 各 section 的 `id`，顺序与 `sections` 一致。 */
            ids: unknown[];
            /** 把 TOC href 切成 `[sectionId, fragment]`。可异步。 */
            splitHref: (href: string) => string[] | Promise<string[]>;
            /**
             * 由 fragment 取回节点。`view.js` 传入的就是
             * `book.getTOCFragment`（已 `bind`），故与 `Book["getTOCFragment"]` 同契约。
             */
            getFragment: NonNullable<Book["getTOCFragment"]>;
        }): Promise<void>;

        /**
         * @param range 当前位置；省略时返回该 section 的第一个条目。
         * @returns 命中为 TOC 项，该 section 无对应项时为 `null`，未初始化时为 `undefined`。
         */
        getProgress(index: number, range?: Range | null): TocItem | null | undefined;
    }

    /**
     * 根据各 section 的字节数计算全书进度。
     *
     * `sizePerLoc` / `sizePerTimeUnit` 把字节数换算成「位置数」与「时间」，
     * `view.js` 用的是 1500 / 1600。
     */
    export class SectionProgress {
        constructor(
            sections: Array<Pick<Section, "linear" | "size">>,
            sizePerLoc: number,
            sizePerTimeUnit: number,
        );

        /** 各 section 的起始进度，长度比 section 数多一，首项为 0。 */
        sectionFractions: number[];

        getProgress(
            index: number,
            fractionInSection: number,
            pageFraction?: number,
        ): Progress;

        /** `getProgress()` 的逆运算：由全书进度反推 `[index, 节内进度]`。 */
        getSection(fraction: number): [number, number];
    }
}

// ---------------------------------------------------------------------------
// search.js / text-walker.js —— 搜索相关，本仓的全文检索可能直接复用
// ---------------------------------------------------------------------------

declare module "*vendor/foliate-js/text-walker.js" {
    /**
     * 把 `Range` / `Document` / `DocumentFragment` 里的文本节点收集成字符串数组，
     * 交给 `func` 处理，并把字符串下标还原成 `Range`。
     *
     * `func` 是生成器：它 `yield` 什么，本函数就 `yield` 什么。
     */
    export const textWalker: (
        target: Range | Document | DocumentFragment,
        func: (
            strings: string[],
            makeRange: (
                startIndex: number,
                startOffset: number,
                endIndex: number,
                endOffset: number,
            ) => Range,
        ) => Generator<unknown>,
        filterFunc?: (node: Node) => number,
    ) => Generator<unknown>;
}

declare module "*vendor/foliate-js/search.js" {
    import { textWalker } from "*vendor/foliate-js/text-walker.js";

    export interface Excerpt {
        pre: string;
        match: string;
        post: string;
    }

    export interface Match {
        range: Range;
        excerpt: Excerpt;
    }

    /** 在字符串数组里查找 `query`，产出带上下文的匹配。可当作通用字符串搜索用。 */
    export const search: (
        strings: string[],
        query: string,
        options: {
            locales?: string | string[];
            granularity?: "grapheme" | "word" | "sentence";
            sensitivity?: "base" | "accent" | "case" | "variant";
        },
    ) => Generator<{
        range: {
            startIndex: number;
            startOffset: number;
            endIndex: number;
            endOffset: number;
        };
        excerpt: Excerpt;
    }>;

    /**
     * 把 `textWalker` 与 `search` 组合成「在 `Document` 里搜」的匹配器。
     * `view.js` 的 `search()` 用的就是它。
     */
    export const searchMatcher: (
        walker: typeof textWalker,
        options: {
            defaultLocale?: string;
            matchCase?: boolean;
            matchDiacritics?: boolean;
            matchWholeWords?: boolean;
            acceptNode?: (node: Node) => number;
        },
    ) => (doc: Document, query: string) => Generator<Match>;
}

// ---------------------------------------------------------------------------
// tts.js
// ---------------------------------------------------------------------------

declare module "*vendor/foliate-js/tts.js" {
    /**
     * 文本转语音的**标记**层：产出 SSML 字符串，实际的语音合成由调用方负责。
     */
    export class TTS {
        constructor(
            doc: Document,
            walker: unknown,
            highlight?: (range: Range) => void,
            granularity?: "word" | "sentence",
        );
        /** 从头开始朗读。 */
        start(): void;
        stop(): void;
        /** 当前朗读位置。 */
        get current(): { range: Range; text: string } | null;
        seek(offset: number): void;
        /** 取回当前及后续的 SSML 文档。 */
        getSSML(): Promise<{ ssml: string; range: Range }>;
        /** 按粒度切分待朗读单元。 */
        setMark(range: Range): void;
    }
}
