# Deer Design Tokens（琥珀金 v2.1）

来源：Penpot「新建文件 1」🔧 Design System 板（已定稿，catnuko 2026-10-28 拍板 B · 琥珀金）。
用法约束（三方向通用）：主色只用于大字、图标和图形；正文级文字一律用 deep 或 text 色，保证 ≥4.5:1。

## Light 亮色

| Token | 值 | 用途 |
|---|---|---|
| `--primary` | `#D97706` | 主色：主按钮底、选中态、链接（仅大字/图标/图形） |
| `--primary-deep` | `#B45309` | 按钮底（白字对比 5.0:1）、强调文字、正文级链接色 |
| `--primary-light` | `#FBEFDD` | 封面占位底、选中底色、引用高亮 |
| `--primary-hover` | `#C26A05` | 主按钮 hover（实测自 Components 板） |
| `--primary-active` | `#A85E04` | 主按钮 active（实测自 Components 板） |
| `--bg` | `#FAF7F2` | 页面底色、侧栏底 |
| `--surface` | `#FFFFFF` | 卡片、面板、弹窗 |
| `--border` | `#E7E0D6` | 描边、分隔线 |
| `--text` | `#292524` | 正文 |
| `--text-2` | `#78716C` | 次要文字、meta 信息 |
| `--danger` | `#DC2626` | 破坏性操作（从书架移除、删除）；danger 底 `#FEF2F2` |
| `--error` | `#DC2626` | 输入错误、失败态 |

## Dark 暗色

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#1C1917` | 页面底色（surface 下沉一档） |
| `--surface` | `#292524` | 卡片、面板 |
| `--border` | `#44403C` | 描边 |
| `--text` | `#E7E5E4` | 正文 |
| `--text-2` | `#A8A29E` | 次要文字 |
| `--primary` | `#F59E0B` | 提亮一档；正文级文字对比 ≥4.5:1 |

## 圆角

| 层级 | 值 | 用于 |
|---|---|---|
| 控件 | 8px | 按钮、输入框、toast、引用卡、工具条 |
| 卡片 | 12px | 书籍卡片、摘录卡、composer 输入区 |
| 弹层 | 16px | 确认弹窗、AI 面板浮层 |
| 菜单/气泡 | 10px | 下拉菜单、高亮操作气泡 |

## 动效

| 层级 | 时长 | 曲线 |
|---|---|---|
| 微交互（hover/active/focus） | 100–150ms | in cubic-bezier(0.2, 0, 0, 1) |
| 弹层 | 200–250ms | in cubic-bezier(0.2, 0, 0, 1) |
| 消失/退出 | out cubic-bezier(0.4, 0, 1, 1) | |
| toast | 成功 1.5s 消失；带撤销 5s | |
| 骨架屏 | shimmer 1.5s | |
| 流式光标 | 600ms 闪烁 | |
| 原则 | 尊重「减少动态效果」；偏好时动效退化为直接切换 | |

## 字体

- 全局：Source Sans Pro（spec §5），回退系统 sans-serif。
- 正文示例：Readable serif 15px（阅读页内文），次要信息 `#78716C`，边线 `#E7E0D6`。
