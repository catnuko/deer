# 动效批次 2 实测证据（2026-11-04）

## 环境

- 代码：`apps/desktop`，dev 分支，批次 2 五个提交 + 一个 lint 修复提交。
- 浏览器：本机 Chromium（Vite dev），`prefers-color-scheme: dark`，`prefers-reduced-motion: no-preference`。
- Tauri：`pnpm tauri dev` 窗口在跑（进程 `target/debug/desktop`，窗口 1800×1064 @ (0,39)），但 `screencapture -l` / `-R` 均返回 `could not create image from window / rect`——本机没有给调用进程「屏幕录制」权限，**真机截图/录屏无法产出**。下面的数值全部来自浏览器里跑同一份 React 代码的真实计算样式，不是文字推断。

## 浮层进出（M2，概念地图为例）

同一元素上按时间采样 `getComputedStyle`：

| 时点 | className 尾部 | animation-name | duration | opacity |
| --- | --- | --- | --- | --- |
| 打开后 | `deer-overlay-in-scale` | `deer-overlay-scale-in` | 0.2s | 1 |
| 关闭 +14ms | `deer-overlay-out-scale` | `deer-overlay-scale-out` | 0.15s | 1 |
| +31ms | 同上 | 同上 | 0.15s | 0.9775 |
| +120ms | 同上 | 同上 | 0.15s | 0.4791 |
| +204ms | 元素已从 DOM 摘除 | — | — | — |

进入 200ms、退场 150ms、退场结束后帧内摘除，没有留下残影节点。
`screencapture` 打不开，截图来自浏览器：`conceptmap-open-dark.png`（概念地图 L1 浮层，`z-index: 20`、`position: absolute`）。

## 主题切换（M3）

- `document.startViewTransition` 存在，切换主题时被调用 1 次。
- 期间 `::view-transition-new(root)` / `::view-transition-old(root)` 的 fade 动画时长为 **200ms**（= `--transition-duration-base`）。
- `<html>` / `<body>` 的 `transition-duration` 均为 **0s**（没有全局过渡）。

## token 实测值（`:root`）

`--transition-duration-fast: 120ms`、`--transition-duration-base: 200ms`、`--transition-duration-exit: 150ms`、`--motion-stagger: 40ms`、`--ease-enter: cubic-bezier(0.2, 0, 0, 1)`、`--ease-exit: cubic-bezier(0.4, 0, 1, 1)`。

## 布局内面板（M2）

页面里 `.deer-content-fade` 恰好 2 处：AI 侧栏内容容器与目录 dock（`ASIDE` / `DIV.flex.h-full`），120ms 淡入。

## 构建产物（dist/assets/index-*.css）

```css
.deer-overlay-out-drop{animation:deer-overlay-drop-out var(--transition-duration-exit) var(--ease-exit)}
.deer-list-item{animation:deer-list-item-in var(--transition-duration-base) var(--ease-enter) both;animation-delay:calc(var(--deer-index,0) * var(--motion-stagger))}
::view-transition-old(root){animation-duration:var(--transition-duration-base);animation-timing-function:var(--ease-enter)}
@media (prefers-reduced-motion:reduce){:root{--transition-duration-fast:0s;--transition-duration-base:0s;--transition-duration-exit:0s;--transition-duration-slow:0s;--motion-shift-*:0px;--motion-stagger:0s} ...}
```

keyframes 齐全：`deer-overlay-drop-in/out`、`deer-overlay-scale-in/out`、`deer-pop-in-above/below`、`deer-content-fade-in`、`deer-list-item-in`、`deer-page-turn`。

## 单测断言（无法肉眼验证的部分）

`ReaderOverlay.test.tsx` 4 例：关闭时不渲染、`user` 关闭先加 `deer-overlay-out-drop` 且 150ms 后才摘除、`immediate`（navigation）关闭同帧摘除不播退场、Esc 与点外关闭 / 点内不关。