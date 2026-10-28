# Deer 设计交接包（琥珀金 v2.1）

设计师：UI（OpenMausBot）· 出稿工具：Penpot · 交接日期：2026-10-28
配套规范：`deer/docs/deer-ux-spec.md` v1.1（token、状态清单、交互与文案以规范为准，本包是视觉对照物）
Penpot 源文件：「新建文件 1」`c6d3e82b-3288-80a2-8008-da48cbd04c22`（Page 1），全部板位于同一页画布。
只读分享链接（任何人有链接即可查看 + Inspect，无需账号）：
https://design.penpot.app/#/view?file-id=c6d3e82b-3288-80a2-8008-da48cbd04c22&page-id=c6d3e82b-3288-80a2-8008-da48cbd04c23&share-id=bdfa5f6c-e169-4278-b2ed-33c97b23c292&index=0

## 本包内容

| 文件 | 对应板块 | 尺寸 |
|---|---|---|
| `boards/00-design-system.png` | 🔧 Design System v2.1（琥珀金已定稿 + Dark token 条） | 1440×1080 |
| `boards/01-components-states.png` | 🧩 Components · §8 全状态矩阵 | 1440×1560 |
| `boards/02-home-bookshelf.png` | ① 首页 · 我的书架 | 1440×900 |
| `boards/03-reader-ai-companion.png` | ② 阅读页 · AI 伴读（含三块特写） | 1440×1560 |
| `boards/04-notes-highlights.png` | ③ 笔记与摘录（含笔记详情特写） | 1440×1280 |
| `boards/05-command-palette.png` | ④ ⌘K 全局命令面板（含过滤/无结果特写） | 1440×900 |
| `boards/06-settings.png` | ⑤ 设置（含通用/阅读偏好/数据特写） | 1440×1000 |

## 给 Dev 的使用方式

1. **先读规范再读图**：`deer-ux-spec.md` 的 §8 状态矩阵、§4.4 联网搜索占位、§P0 书籍独立空间是验收项来源；PNG 是视觉对照。
2. **查精确值**：`tokens.md` 是全部颜色/圆角/动效 token；`components-inspect.md` 是关键组件的 CSS 摘录（值直接取自 Penpot 图形，非目测）。
3. **没写的值找 UI**：交接包没覆盖的精确值（字阶、间距、具体阴影参数等），@UI 到 Penpot 原文补进文档，不要目测 PNG 抄色值。
4. **字体**：全局 Source Sans Pro（spec §5）；导入失败时回退系统 sans-serif。

## 需要注意的三个设计决定（与 spec 对应）

- **联网搜索只做占位**：composer 与设置页的联网搜索开关置灰 + 「占位」badge + 「搜索接口待接入」说明，不接真实搜索；来源引用样式照画（折叠/展开两态 + [1][2] 角标）。
- **书籍独立空间（P0）**：会话历史按书隔离，切书自动切换空间，弹层内直接切换、无弹窗确认（v1.0 的「是否新建会话，提示已废除」）。
- **⌘K 选中态底色偏差**：spec §6 写 `#F4F5F7`（冷灰），实际用暖色等值 `#F4F1EA` 与全套一致；catnuko 已知晓，若要求严格冷灰以 spec 为准。
