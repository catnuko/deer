# Deer 动效规范 v1.0

范围：Deer 动效专项 M1–M11 与新增 M1b（P0 八项：M1–M7 + M1b；P1 四项：M8–M11）。风格档位 **B 温和流动**。
依据：`docs/deer-ux-spec.md` §9、`docs/design-handoff/tokens.md`「动效」一节（沿用并细化，不另起一套）。
本文只定义可实现的数值与规则，不含代码改动。

---

## 0. 不变量（所有条目的前置约束）

1. 只动 `opacity` 与 `transform`。阅读路径上禁止过渡 `width`/`height`/`top`/`left`/`filter`（目录拖拽调宽是唯一的宽度变化，且必须无过渡，见 M11）。
2. 正文 iframe 内部零动画。所有动效施加在宿主侧容器（`foliate-view` 宿主、分层浮层、面板）上。
3. `document.hidden` 时不播动画，直接落到终态。
4. 不新增运行时依赖、不引入动画库，`package.json` 依赖变化必须为 0。
5. 系统开启「减少动态效果」时，全部降级见 §4；这是硬规则，不是建议。
6. 焦点环、选区高亮、正文排版重排不做过渡（它们承担可读性与可访问性，过渡反而延迟反馈）。
7. 单次翻页（按键按下 → relocate 落定）P95 ≤ 350ms；连翻 200 页不跳页、不白屏。

---

## 1. Token 表

### 1.1 时长

| Token（Tailwind 类） | 值 | 用途 |
|---|---|---|
| `duration-fast` | 120ms | 微交互、小浮层进出、列表项错峰入场、概念地图节点 |
| `duration-base` | 200ms | 面板/弹窗入场、主题与纸色切换、进度条宽度 |
| `duration-exit` | 150ms | 所有退出、翻页淡入档、Base UI 遮罩淡出 |
| `duration-slow` | 300ms | 翻页滑动档（上限，不再新增 300ms 以上的时长） |

### 1.2 缓动

| Token（Tailwind 类） | 值 | 用途 |
|---|---|---|
| `ease-enter` | `cubic-bezier(0.2, 0, 0, 1)` | 所有进入、翻页淡入 |
| `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | 所有退出 |
| `ease-panel` | `cubic-bezier(0.33, 0.7, 0.2, 1)` | 仅 AI 侧栏进出（起步即有速度、收尾柔和；不改全局 `ease-enter`/`ease-exit`） |
| `duration-panel-in` / `duration-panel-out` | `240ms` / `160ms` | 仅 AI 侧栏进出 |

不做弹簧、不做 overshoot、不做 back/elastic。分页器内部滑动档使用 foliate 自带的 `easeOutQuad`（`1-(1-x)²`），不改写，它与 `ease-enter` 同为减速曲线，观感一致。

### 1.3 位移与错峰

| CSS 变量 | 值 | 用途 |
|---|---|---|
| `--motion-shift-panel` | `6px` | 面板类浮层的入场位移（允许 4–8px，本期定 6px） |
| `--motion-shift-list` | `2px` | 列表项、书籍卡片的入场位移 |
| `--motion-shift-hover` | `2px` | 卡片 hover 抬升 |
| `--motion-stagger` | `40ms` | 列表错峰步长 |
| `--motion-stagger-max` | `12` | 错峰只作用于前 12 项，第 13 项起延迟固定为 0 |

### 1.4 写入位置（Tailwind v4，已按 4.3.3 核实命名空间）

时长走 `--transition-duration-*`（生成 `duration-*`），缓动走 `--ease-*`（生成 `ease-*`）。**必须新建一个非 `inline` 的 `@theme` 块**——现有 `@theme inline` 不输出 CSS 变量，运行时无法被减少动效统一覆盖。

```css
/* src/index.css：新增独立 @theme 块，不要并进上面那个 @theme inline */
@theme {
  --transition-duration-fast: 120ms;
  --transition-duration-base: 200ms;
  --transition-duration-exit: 150ms;
  --transition-duration-slow: 300ms;

  --ease-enter: cubic-bezier(0.2, 0, 0, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}

/* 位移与错峰没有 Tailwind 命名空间，放现有 :root 块 */
:root {
  --motion-shift-panel: 6px;
  --motion-shift-list: 2px;
  --motion-shift-hover: 2px;
  --motion-stagger: 40ms;
  --motion-stagger-max: 12;
}
```

不要覆盖 Tailwind 内置的 `--ease-in/--ease-out/--ease-in-out`，新增名字，避免影响 shadcn 组件既有类。

---

## 2. 层级（z 顺序）

| 层 | z | 内容 | 规则 |
|---|---|---|---|
| L0 | 0 / auto | 正文、页眉页脚、页脚进度条、目录 dock | 不做任何进入动画 |
| L1 | `z-20` | 快捷设置、概念地图、划选工具条、高亮操作菜单、脚注预览卡 | **同一时刻最多一个**；L1 不得在 L1 之上再开 |
| L2 | `z-50` | 目录/笔记窄窗 Sheet、设置 Dialog、确认弹窗 | 打开时强制关闭所有 L1 |
| L3 | `z-50`（后渲染） | L2/L1 内部触发的 Select / DropdownMenu | 只能由 L2/L1 内部触发，不自带进出动画（沿用 Base UI 150ms） |
| L4 | `z-50` | Tooltip | 顶层，出现 100ms 淡入 + 2px 位移，不参与错峰 |

L1 内部优先级（同时触发时后者关闭前者）：脚注卡 < 快捷设置 / 概念地图 < 划选工具条 / 高亮操作菜单。

---

## 3. 逐项规格

### M1 翻页三档（P0）

| 字段 | 规格 |
|---|---|
| 触发 | 翻页模式下：正文左右边缘点击、←/→、PageUp/PageDown、页脚上/下一页按钮、目录跳章 |
| 形态 | 三档见 §3.1 |
| 时长 | 关闭 0ms；淡入 150ms；滑动 300ms |
| 曲线 | 淡入 `ease-enter`；滑动 `easeOutQuad`（foliate 内置） |
| 位移 | 滑动档由分页器滚动一整页宽度，无额外位移；淡入档不位移 |
| 层级 | L0（宿主容器 `viewerRef`），不新增层 |
| 联动 | relocate 落定时关闭全部 L1（`reason=navigation`，0ms，不播 150ms 退出，否则残影盖在翻页动画上），并清空选区（现有逻辑保留） |
| 实现 | `ReaderPage.tsx:517` 现有淡入分支改成分档；滑动档对 `viewerRef` 的 renderer 元素 `setAttribute("animated", "")`，关闭/淡入档 `removeAttribute` |
| 目录跳章 | **固定按「关闭」处理**，不跟随当前档位：走 TOC 的 `#scrollToAnchor`（`navigation`），分页器只对 `snap`/`smooth` 两种行为播动画。理由：跨章 300ms 滚动会让页码先扫过中间章节，误导位置感 |

### M1b 连翻不丢键（P0，清单外新增，0.5 天）

清单外新增项，2026-11-04 已向 catnuko 报备（可随时砍）。为 M1 暴露的连按丢键补的收口层，**不改分页器本体**。

| 字段 | 规格 |
|---|---|
| 问题 | 滑动档分页器内部串行锁约 300ms，关闭/淡入档固定 `wait(100)`，窗口内到达的翻页请求一律被丢弃。鼠标快速连点（人间隔 120–200ms）约 2/3 丢键；按住 ←/→（macOS 重复约 30–50ms）约 5/6 丢键 |
| 触发 | 正文左右边缘点击、←/→、PageUp/PageDown、页脚 ‹ › 四个入口统一收口，先入队再翻页 |
| 规则 | 锁窗口内到达的请求**累加不丢弃**（前进与后退自相抵消）；窗口结束时按累计页数一次性跳到位，**该次不带动画**（单页仍走 `next/prev`，多页走 `goTo` 且不加 `animated`）；burst 结束后 400ms 恢复逐页动画 |
| 观感 | 快速连翻＝跟手跳页，慢下来＝恢复逐页动画 |
| 三档 | 都适用：滑动档窗口约 300ms，关闭/淡入档窗口约 100ms。合并跳转期间抑制 `deer-page-turn` 淡入，避免淡入档连按时闪一串 |
| 减少动态效果 | 同样生效（合并跳转本就无动画），不额外处理 |
| 不采用的方案 | 「全部改走 `goTo` 逐页定位、不播动画」——那会让滑动档形同虚设，不取 |
| 必过 | N 次请求最终恰好前进 N 页，无漂移/重复/回弹；单次翻页观感与 P95 不变；合并跳转只落一次 relocate（中间页不写 CFI，属期望行为）；滚动模式不受影响 |
| 层级 | L0，不新增层 |

### M2 面板浮层进出（P0）

通用：进入用 `opacity 0→1` + 位移，禁止缩放与位移叠加（概念地图除外，它无锚点，用 0.98→1 缩放）。手写浮层本期无完整 presence 机制：**快捷设置**、**概念地图**做 150ms `ease-exit` 退出，**脚注卡**做 120ms 原地淡出（加一个 `closing` 类，`animationend` 后摘除 DOM，不做完整 presence 状态），其余手写浮层退出 0ms 直接移除；带 Base UI 生命周期的弹层走 `duration-exit` + `ease-exit`。

关闭原因决定时序（`onRelocate` 路径）：`reason=navigation`（翻页、跳章）→ **0ms 立即关**，否则 150ms 残影会盖在翻页动画上；`reason=user`（点浮层外、Esc）→ 按该浮层自己的退出规格。目录跳章固定按「关闭」处理（走 `#scrollToAnchor`，分页器只对 `snap`/`smooth` 走动画），不跟随翻页档位。

| 浮层 | 进入 | 位移 | 退出 | 层级 | 联动 |
|---|---|---|---|---|---|
| 快捷设置 `QuickSettingsPanel` | 200ms `ease-enter` | `translateY(-4px)→0`（自上缘落入） | user：150ms `ease-exit`，`translateY(0)→-4px`；navigation：0ms | L1 | 打开时关闭脚注卡；翻页/跳章按 navigation 0ms 关闭 |
| 概念地图 `ConceptMapPanel` | 200ms `ease-enter` | `scale(.98)→1`，无位移 | user：150ms `ease-exit`，`scale(1)→.98`；navigation：0ms | L1 | 打开时关闭快捷设置与脚注卡 |
| 划选工具条 `SelectionPopover` | 120ms `ease-enter` | 从选区方向进入：位于选区上方时 `translateY(4px)→0`，下方时 `translateY(-4px)→0` | 0ms 移除（`navigation` 与 `user` 均瞬时） | L1 | 打开时关闭脚注卡；翻页关闭；其内部切换到色板/笔记输入为 120ms 高度自适应**不做动画**（直接换内容） |
| 高亮操作菜单（选中已有高亮） | 120ms `ease-enter` | 同上 | 0ms 移除 | L1 | 与划选工具条互斥 |
| 脚注预览卡 `NotePeekCard` | 120ms `ease-enter`，**原地淡入，无位移** | 无 | 120ms `ease-exit` 原地淡出，播完摘除；退出期间 `pointer-events: none`，指针回到卡片/引用则取消退出 | L1 | 划选工具条出现即关闭；指针离开即开始淡出（现有 300ms 延时关闭保留）；reduce 下 0ms | 
| AI 面板 `ChatPanel`（布局内 `aside class="w-96"`，**不是浮层**） | 布局 0ms（宽度瞬时到位，**禁止宽度过渡**：会让正文逐帧重排）；内容 240ms `ease-panel`，`translateX(12px)→0` + 淡入 | 12px（只在内容层，布局不动，且不得溢出任何滚动容器） | 160ms `ease-panel`，`translateX(0)→8px` 淡出，播完摘除；离开入口路由立即摘除不播退出 | L0（布局内联，不叠层） | 打开时关闭其余 L1；Esc 关闭；`navigation` 0ms；reduce 下进出 0ms、无位移 |
| 目录/笔记窄窗（Sheet） | 200ms `ease-enter`，自左侧滑入 24px + 遮罩 150ms 淡入 | 24px | 150ms `ease-exit`，滑出 24px（Sheet 自带） | L2 | 窄窗下打开时关闭 L1 |

Sheet 现有实现是 200ms `ease-in-out`、位移 40px（`sheet.tsx`）；本期改为 24px + `ease-enter`，属共享组件改动，所有 Sheet 一起变。

**退出范围（2026-11-04 更新，取代本版原始取舍）**：快捷设置、概念地图做 150ms 退出；AI 面板 160ms `ease-panel` 退出；脚注预览卡 120ms 原地淡出（catnuko 真机反馈「不要从下面闪弹出来，原地淡出淡入」）；划选工具条、高亮操作菜单、两个窄窗 Sheet 退出即时（Sheet 本身已自带进出）。「小浮层瞬消可接受」的原始判断对脚注卡不再成立，已改。对称化与 `SelectionPopover` 的 presence 拆分仍留 v2，见 §7。

**设置 Dialog 遮罩**：遮罩与弹窗同一条退出节奏（150ms `ease-exit`）；遮罩上不得有在退出过程中被移除的 `backdrop-filter` 图层（WKWebView 下会闪暗一帧），见 §9 变更记录。

### M3 主题与纸色切换（P0）

| 字段 | 主题切换 | 纸色切换 |
|---|---|---|
| 触发 | 设置 → 外观切浅色/深色/跟随系统；系统主题变化（theme=system） | 设置 → 阅读点选纸色；快捷设置点选纸色 |
| 实现 | 优先 `document.startViewTransition()`，CSS 内 `::view-transition-old/new(root)` 各 200ms 交叉淡出/淡入；不可用时给 `<html>` 挂 `deer-theme-fading` 200ms，仅过渡 `body` 的 `background-color` 与 `color` | `foliate-view::part(filter)` 的 `background` 200ms `ease-enter`；正文文字颜色不参与过渡 |
| 时长/曲线 | 200ms / `ease-enter` | 200ms / `ease-enter` |
| 位移 | 无 | 无 |
| 层级 | L0 | L0 |
| 降级 | 两路都不可用 → 直接切换 | 观感割裂时（文字与底色不同步）直接切换，不补动画 |

主题切换的 View Transition 与「减少动态效果」冲突时一律不启用。切换期间不加全屏遮罩层（会挡住正文可读性）。

### M4 列表增删与书架切换（P0）

| 字段 | 规格 |
|---|---|
| 触发 | 书架网格首次加载完成、导入书籍成功、删除书籍、切换书架/排序 |
| 新增项 | `opacity 0→1` + `translateY(2px)→0`，200ms `ease-enter`，前 12 项错峰 40ms（`animation-delay: min(index, 12) × 40ms`，超过 12 项延迟 0） |
| 删除项 | **0ms 直接摘除 DOM**。不做淡出：淡出后仍需一次重排，会先「留空位再跳」，观感更差；FLIP 需要额外方案，本期不做 |
| 切换书架/排序 | 容器内容 150ms `ease-enter` 淡入 + 2px 上移；不做交叉淡出（两套列表同时在场会抖动）；排序重排 0ms |
| 层级 | L0 |
| 实现 | 动画挂在卡片容器的 key 变更上，绝不动 `.grid` 的列宽 |

### M5 hover / active 补全（P0）

| 触点 | 规格 |
|---|---|
| 按钮（所有 `Button` 变体） | `background-color` / `color` / `border-color` 120ms `ease-enter`；active 维持现有 `translate-y-px`，不加过渡（按下要立刻有反馈） |
| 书籍卡片 | `box-shadow` + `translateY(-2px)` 120ms `ease-enter`；不做 scale（封面位图缩放会重采样发虚） |
| 目录条目 | 背景/文字色 120ms；折行与宽度不参与过渡 |
| 设置左栏分组 | 120ms 背景/文字色 |
| 书籍卡片角上的移除按钮（现为 `opacity-0 group-hover:opacity-100`） | 120ms 淡入，不改位移 |
| 纸色色块 | `box-shadow`（选中环）150ms `ease-exit`，色块本身不缩放 |
| Switch / 分段控件 | 滑块与选中态 120ms；开关不做弹跳 |
| 目录拖拽分隔条 | 颜色 120ms，**拖拽期间（`resizing`）过渡必须为 `none`** |
| Tooltip | 100ms 淡入 + 朝锚点 2px；不设延迟（保持现有 Base UI delay） |

### M6 骨架屏与加载态（P0）

| 场景 | 规格 |
|---|---|
| 书架加载 | 现有 6 张卡片骨架保留；`opacity 0.5↔1` 1.5s `ease-in-out` 无限循环（即 `animate-pulse` 现状，token 化为 `--animate-deer-skeleton`）；不加扫光渐变（避免持续横向运动） |
| 阅读页加载（现为纯文字「正在加载书籍…」） | 版心位置放 1 条 16px 标题骨架 + 6 条正文骨架（高 14px、行距对齐当前 `lineHeight`），`opacity` 脉冲同书架；100ms 淡入 |
| 阅读页就绪 | 骨架 150ms `ease-exit` 淡出后移除，正文容器 150ms `ease-enter` 淡入；两者不等高就不做交叉过渡，改为骨架先移除、正文再淡入 |
| 加载失败 | 错误态 120ms 淡入，不做抖动动画 |

骨架屏是「加载反馈」不是「装饰背景」，不计入 §5 反面清单。

### M7 降级底座（P0）

见 §4。要求：全站一条全局规则 + 一个 `useReducedMotion()` 钩子（`matchMedia("(prefers-reduced-motion: reduce)")`，监听 `change`），阅读页据此决定翻页实际档位。

### M8 设置弹窗七组切换（P1）

| 字段 | 规格 |
|---|---|
| 触发 | 点击设置左栏/顶部分段任一未选中分组 |
| 进入 | 右栏内容 `opacity 0→1` + `translateY(4px)→0`，120ms `ease-enter` |
| 退出 | 0ms（旧内容立刻换掉，不叠出） |
| 外框 | 完全不动：尺寸 900×640（窄窗 94vw×86vh）、标题、分组栏不参与动画 |
| 滚动 | 切换分组时右栏 `scrollTop` 立即归零，不做平滑滚动 |
| 首次打开 | 只播弹窗自身入场（200ms 淡入 + `scale(.98)→1`），右栏内容不重复播 |
| 层级 | L2 |
| 实现 | 右栏内容包一层 keyed div；`DialogContent` 的 `duration-100 zoom-in-95` 改为 `duration-base` + `zoom-in-98` |

### M9 进度条与页码（P1）

| 触点 | 规格 |
|---|---|
| 全书进度条宽度 | 200ms `ease-enter`（现为 150ms，统一到 token） |
| 进度百分比文字 | 0ms，不做数字滚动 |
| 页脚「第 x / y 章」 | 0ms，不做交叉淡入（翻页时同时发生，会抢注意力） |
| 页码/百分比更新时机 | 跟随 relocate，不节流额外延迟 |

### M10 概念地图节点（P1）

| 字段 | 规格 |
|---|---|
| 节点入场 | `opacity 0→1` + `scale(.96)→1`，120ms `ease-enter`，按渲染顺序错峰 40ms、最多前 12 个 |
| 连线 | 与节点同批出现，仅 `opacity 0→1` 120ms；**不做路径描边（stroke-dashoffset）动画**，长图会掉帧 |
| 节点 hover | 描边/底色 120ms |
| 节点选中/聚焦 | 120ms 底色；不位移 |
| 退出 | 0ms（关面板时整块移除） |
| 重排 | 节点位置变化 0ms，直接跳（力导向布局若存在，其持续抖动不在本次范围） |

### M11 目录栏开合（P1）

| 字段 | 规格 |
|---|---|
| dock 开/合（宽窗） | **布局变化 0ms**（分页器会立即按新宽度重排）；目录内容 `opacity 0→1` 120ms `ease-enter`。**禁止写宽度过渡**：任何 `width` 过渡都会让正文逐帧重排并抖动，违反 §0 第 1 条 |
| 拖拽调宽 | 宽度直接赋值，`transition: none`（拖拽中与松手后都不补过渡） |
| 拖拽分隔条 | 颜色 120ms；`resizing` 期间 `transition-duration: 0ms` |
| 窄窗 Sheet | 走 M2 的 Sheet 规格（200ms 滑入 / 150ms 滑出，24px） |
| 互斥 | 目录开合导致正文重排，等同于 relocate 的前置条件（`reason=navigation`，0ms）：关闭划选工具条、脚注卡、高亮菜单；快捷设置可保留（锚定在容器内仍有效） |
| 键盘 | ←/→ 步进 8px、Shift 24px、Home/End 到边界，均为即时生效，无过渡 |

---

## 3.1 翻页三档的形态定义

设置在「设置 → 阅读 → 翻页动效」，形态为**三档分段控件**（不是开关）：

- width 160px、height 28px、圆角 8px，三段等宽，标签 `关闭` / `淡入` / `滑动`，字号 12px。
- 选中段：`bg-muted` + `font-medium` + `text-foreground`；未选中：`text-muted-foreground`。切换 120ms。
- 语义：`role="radiogroup"` + 三个 `role="radio"`，←/→ 切换，Tab 进出整组（对齐现有「阅读背景色」radiogroup 的做法）。
- `pageFlow === "scrolled"` 时整组置灰 `opacity-50` + `aria-disabled`，说明文字注明「仅翻页模式生效」。
- 固定版式（CBZ、PDF、固定版式 EPUB）**不按书置灰**：分段控件保持可用，改为在设置项下方常驻一行说明「漫画、PDF 与固定版式书籍不支持翻页动画」（12px、`text-muted-foreground`）。理由：用户可能在多本书之间切换，按当前书置灰会让控件状态跳变；常驻说明更稳定。
- 设置项标题 `翻页动效`，描述「滑动最接近纸书手感；淡入更克制。」

三档观感：

| 档位 | 实现 | 观感 | 连按行为 |
|---|---|---|---|
| 关闭 | 分页器无 `animated` 属性，不挂淡入类 | 一帧内换页，零延迟 | 约 100ms 保护间隔，间隔更短的连按会被丢弃；M1b 统一收口后不再丢 |
| 淡入 | 无 `animated`；relocate 时给 `viewerRef` 挂 `deer-page-turn`（150ms，`opacity .4→1`，`ease-enter`） | 新页在 150ms 内由浅变实，位置不移动 | 单次走 150ms 淡入；约 100ms 保护间隔内的连按累加到窗口结束后一次性跳页且不播淡入（M1b） |
| 滑动 | 分页器带 `animated`，内部 300ms `easeOutQuad` 滚动 | 纸页横向滑过 | 约 300ms 串行锁；锁窗内连按由 M1b 累加不丢，窗口结束一次性跳到位；验收按 400ms/次节奏测 P95，连按另按 N 次=N 页判 |

一致性：边缘点击、键盘、页脚按钮、目录跳章都走同一条 `view.next()/view.prev()` 或 `goTo()` 路径，所以三档在四个入口观感一致。例外：目录跳章是跨章定位，只按「关闭」直跳，不播滑动（跨章 300ms 滚动会让页码先扫过中间章节，误导）。

滚动模式（`pageFlow === "scrolled"`）下三档均不生效，翻页动效设置置灰。

---

## 4. 减少动态效果降级

### 4.1 全局规则

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --transition-duration-fast: 0ms;
    --transition-duration-base: 0ms;
    --transition-duration-exit: 0ms;
    --transition-duration-slow: 0ms;
    --motion-shift-panel: 0px;
    --motion-shift-list: 0px;
    --motion-shift-hover: 0px;
    --motion-stagger: 0ms;
  }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    scroll-behavior: auto !important;
  }
}
```

用 `0.01ms` 而非 `0`：部分组件靠 `animationend` 收尾，置 0 会让事件不触发。

**无限循环动画必须单独收掉**：上面那段只对 `transition` 与「有限次」动画成立。凡声明了 `animation-iteration-count: infinite` 的元素（书架骨架 `animate-pulse`、阅读加载骨架、概念地图若有循环动效），`0.01ms + iteration-count: 1` 会把它压成高频闪烁——比不降级更糟。这类元素必须单独写：

```css
@media (prefers-reduced-motion: reduce) {
  .deer-skeleton, .deer-skeleton * {
    animation: none !important;
    opacity: .6;            /* 静态占位，保留「这里在加载」的可读性 */
  }
}
```

同理，`scroll-behavior: smooth` 一律回落为 `auto`（已在全局块里）。新增任何 `infinite` 动画时，必须在同一处配一条静态替代样式，否则不许合入。

### 4.2 逐触点降级表

| 触点 | 常态 | 降级后 |
|---|---|---|
| M1 翻页 · 滑动 | 300ms 滚动 | 直接跳页（等效「关闭」）；连按仍走 M1b 队列，不丢键 |
| M1 翻页 · 淡入 | 150ms 淡入 | 直接换页 |
| M2 面板进出 | 120/200ms + 位移 | 直接出现 / 消失，位置不变 |
| M3 主题切换 | View Transition 200ms | 直接切换，不用 View Transition |
| M3 纸色切换 | 200ms 底色过渡 | 直接切换 |
| M4 列表入场 | 200ms + 2px + 40ms 错峰 | 直接出现，无错峰 |
| M5 hover/active | 120ms 颜色/位移 | 直接变色，无抬升（`translateY(0)`），active 的 `translate-y-px` 也取消 |
| M6 书架骨架 | 1.5s 脉冲（infinite） | `animation: none` + 静态 `opacity .6`，不闪 |
| M6 阅读加载 | 脉冲骨架 + 150ms 交叉 | 静态骨架，就绪即换 |
| M8 设置分组切换 | 120ms 淡入上移 | 直接换内容 |
| M9 进度条 | 200ms 宽度过渡 | 宽度直接跳 |
| M10 概念地图 | 120ms 淡入 + 错峰 | 全部直接显示 |
| M11 目录开合 | 120ms 内容淡入 | 直接开合 |

### 4.3 运行时行为与文案

- `useReducedMotion()` 为 true 时：翻页实际档位强制为「关闭」，但**不改写用户存储的偏好**；系统偏好关掉后自动恢复原档位。
- 设置 → 阅读 →「翻页动效」下方显示一行提示（12px、`text-muted-foreground`）：
  > 系统已开启「减少动态效果」，翻页会直接跳转。
- 其余设置项不额外加提示；降级是静默的，避免设置页堆满说明。
- 提示用普通文本，不加 `aria-live`（用户主动进入设置页，不需要播报）。

---

## 5. 反面清单（明确不做）

1. **弹簧 / 回弹 / overshoot 曲线**（`cubic-bezier` 含负值或 >1 的 y）。
2. **共享元素转场**（书封从书架飞到阅读器、面板间元素接续）。
3. **3D 翻页、透视、视差、纸张卷曲**。
4. **任何装饰性循环动画**：粒子、呼吸光晕、缓慢缩放的封面、持续流动的背景渐变。
5. **正文 iframe 内的任何 CSS 动画或 transition**，包括文字淡入、行出现。
6. **新增动画库**（framer-motion、GSAP、motion、auto-animate 等一律不加）。
7. **骨架屏扫光（shimmer 横向渐变位移）**：只做透明度脉冲。
8. **数字滚动 / 页码翻牌**。
9. **列表重排 FLIP 动画**。
10. **theme 切换的全屏遮罩淡入**（挡可读性）。
11. **toast**：本期不做，M12 单独立项。
12. 不提供「动效强度」用户开关：只有系统「减少动态效果」与翻页三档两个入口。

---

## 6. 实现锚点（给开发对照真实文件）

| 项 | 文件 / 位置 |
|---|---|
| token 与新 keyframes | `apps/desktop/src/index.css`（新增非 inline `@theme` 块、`:root` 变量、`@layer components` 动画类、`prefers-reduced-motion` 块） |
| 现有翻页淡入 | `apps/desktop/src/routes/reader/ReaderPage.tsx:517`、`index.css` 的 `.deer-page-turn` |
| 翻页设置项 | `apps/desktop/src/components/settings/ReadingSection.tsx:251`（Switch → 三段分段控件） |
| 翻页偏好存储 | `apps/desktop/src/store/readingSettings.ts:60`（`pageTurnAnimation: boolean` → `pageTurn: "off" | "fade" | "slide"`） |
| 浮层 | `components/reader/QuickSettingsPanel.tsx`、`ConceptMapPanel.tsx`、`SelectionPopover.tsx`、`NotePeekCard.tsx` |
| Sheet / Dialog | `components/ui/sheet.tsx`、`components/ui/dialog.tsx` |
| 目录 | `components/reader/ReaderToc.tsx`（拖拽段），`routes/reader/ReaderPage.tsx:1131` 起的 dock/sheet 分支 |
| 骨架 | `components/ui/skeleton.tsx`、`routes/bookshelf/BookshelfPage.tsx:438`、`ReaderPage.tsx:1201` 加载态 |
| 进度条 | `ReaderPage.tsx:1282` 与 `:1575` |

迁移规则：本地存储里没有 `pageTurn` 时，**旧布尔值 `true` 与 `false` 一律 → `slide`**；缺失、`null`、非法值（不是三档之一）也一律 → `slide`。即除用户在新设置里显式选过以外，所有存量用户与新装一律落「滑动」。代价：曾主动关过动画的老用户升级后需手动切一次「关闭」或「淡入」；此代价已由 catnuko 认可，不做一次性提示。

---

## 7. 后续建议（不在本期）

1. 其余手写浮层（划选工具条、高亮菜单、脚注卡）补完整 presence（`closing` 态）以获得 80–150ms 退出动画，并把 `SelectionPopover` 的进出拆开；成本约每层 0.5 天，建议 v2 统一做一次。
2. 书封与阅读页之间的共享元素转场（需重新评估性能，且与 minimizable 窗口交互耦合）。
3. 目录条目滚动定位时的高亮跟随（`scrollIntoView` 平滑滚动），注意与「减少动态效果」联动。
4. 主题切换改用 View Transition 的「圆形扩散」变体，需单独设计评审。

---

## 8. 三处风险（提交前请 catnuko 一起拍）

1. **退出动画只做一半（2026-11-04 部分收敛）**：快捷设置、概念地图做 150ms `ease-exit`；AI 面板 240ms 入 / 160ms 出（`ease-panel`）；脚注卡 120ms 原地淡出。划选工具条、高亮操作菜单、两个窄窗 Sheet 仍为退出即时。大面积面板「进有出无」比不加动画更扎眼，小浮层瞬消可接受；换来是不给每个浮层加完整 presence 状态（省约 1.5 天，也避免旧浮层残留干扰翻页点击判定）。对称化与 `SelectionPopover` 的 presence 拆分排 v2，不是本期待办。
2. **老用户迁移**：所有存量用户（含 `pageTurnAnimation: true` 与 `false`）升级后一律落到「滑动」，与部分用户当前体感不同，属明显行为变化。已由 catnuko 拍板接受，不做一次性提示；曾主动关动画的用户需手动切一次。
3. **滑动档 300ms 锁（已由 M1b 解决）**：间隔 <300ms 的连按原本会被丢弃（分页器内部串行锁，`paginator.js:1059`），关闭/淡入档的 100ms 保护间隔同样丢键。**由 M1b 解决**：四个翻页入口统一收口，锁窗内请求累加不丢弃，窗口结束按累计页数一次性跳到位（不带动画），burst 后 400ms 恢复逐页动画。**不采用**「全部改走 `goTo` 逐页定位、不播动画」的方案，那会让滑动档形同虚设。验收：P95 仍按 400ms/次节奏测，连按另按「N 次请求 = 前进 N 页」判。
---

## 9. 变更记录

- **2026-11-04 · AI 面板进出补齐**（catnuko 真机反馈「右侧聊天面板生硬弹出」）：原表为「内容 120ms 淡入 + 退出 0ms 直接摘除」，现改为布局仍 0ms（宽度过渡依旧禁止）、内容 `translateX(12px)→0` + 淡入 200ms `ease-enter`、退出 `translateX(0)→8px` 淡出 150ms `ease-exit` 播完摘除，离开入口路由立即摘除、reduce 下 0ms 无位移。实现提交 `13cb14c`（dev 分支，未 push）。
- **2026-11-04 · AI 面板缓动与时长修订**（catnuko 真机反馈「先慢后快，希望平缓」+ 阅读页底部横向滚动条 + 书架页收起抖动）：新增面板专用缓动 `--ease-panel: cubic-bezier(0.33, 0.7, 0.2, 1)`（起步即有速度，不复用全局 `ease-enter` 的 y1=0），入场 240ms、退场 160ms；位移 12px / 8px 不变，且必须由面板自身 `overflow-hidden` 兜住，不得溢出任何滚动容器（原实现让 `main` 短暂出现 12px 横向滚动条）。书架页 AI 面板改为覆盖式抽屉（浮在内容上，主区宽度恒定），消除 384px 归还导致的网格重排抖动。实现提交 `c3ee73d`（溢出与缓动）与后续抽屉提交（dev 分支，未 push）。
- **2026-11-04 · 脚注卡改为原地淡入淡出**（catnuko 真机反馈「不要从下面闪弹出来，而是从原地淡出淡入」）：取消 `translateY` 位移，进入 `opacity 0→1` 120ms `ease-enter`，退出 `opacity 1→0` 120ms `ease-exit` 播完摘除；退出期间 `pointer-events: none`，指针回到卡片或引用则取消退出。原先「脚注卡退出即时」的取舍作废。
- **2026-11-04 · 设置 Dialog 遮罩退出对齐**（catnuko 真机反馈「关闭时屏幕闪一下，好像变暗」）：遮罩退出统一为 150ms `ease-exit`，与弹窗同步收尾；遮罩不得在退出时移除 `backdrop-filter` 图层（WKWebView 下会闪暗一帧），需要模糊时用独立静态层承载。
- **2026-11-04 · 概念地图改为屏幕居中**（catnuko 真机反馈「不是始终居于屏幕中心」）：面板由铺满阅读区改为视口居中，尺寸与设置弹窗一致（宽窗 900×640，窄窗 94vw×86vh），居中用网格容器而不是 `translate(-50%,-50%)`，避免与 `scale` 入场动画的 `transform` 打架；进出时长与 `scale(.98)` 规格不变。
