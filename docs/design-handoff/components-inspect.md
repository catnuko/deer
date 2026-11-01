# 关键组件 Inspect CSS 摘录

值直接读取自 Penpot「新建文件 1」Page 1 的图形属性（2026-10-28 导出），非目测色值。组件名对应 Components 板与各页板上的图形命名，可在 Penpot 中按名检索对照。

## 按钮（高 40px，控件圆角 8，水平 padding 16）

主按钮（`导入书籍` 188×48 时圆角 8、padding 24×12，其余同规则）：

```css
.btn-primary            { background: #D97706; color: #fff; border-radius: 8px; height: 40px; }
.btn-primary:hover      { background: #C26A05; }
.btn-primary:active     { background: #A85E04; }
.btn-primary:focus-visible { outline: 2px solid #F5C57A; outline-offset: 2px; }  /* Penpot: 2px outer stroke */
.btn-primary:disabled   { background: #EDE8DF; color: #A8A29E; cursor: not-allowed; }
.btn-primary[data-loading] { background: #D97706; opacity: .8; /* + spinner，见 Components 板 */ }
```

次按钮：

```css
.btn-secondary            { background: #fff; border: 1px solid #E7E0D6; color: #292524; border-radius: 8px; height: 40px; }
.btn-secondary:hover      { background: #F4F1EA; }
.btn-secondary:disabled   { background: #fff; border-color: #E7E0D6; color: #A8A29E; }
```

危险按钮（danger 文字钮，如「从书架移除」）：

```css
.btn-danger { background: #FEF2F2; border: 1px solid #DC2626; color: #DC2626; border-radius: 8px; height: 40px; }
```

## 输入框（高 40px，圆角 8）

```css
.input           { background: #fff; border: 1px solid #E7E0D6; border-radius: 8px; height: 40px; }
.input:focus     { border: 2px solid #D97706; }   /* 内描边加粗到 2px，外尺寸不变 */
.input[aria-invalid="true"] { border: 1px solid #DC2626; }  /* 下方红字提示：请输入正确的章节号 */
.input:disabled  { border-color: #F0EAE0; color: #A8A29E; }
```

## 书籍卡片（271×280，卡片圆角 12）

```css
.book-card            { background: #fff; border: 1px solid #E7E0D6; border-radius: 12px; overflow: hidden; }
.book-card:hover      { box-shadow: 0 4px 16px rgba(0,0,0,.08); transform: translateY(-2px); }  /* hover 上浮 4x */
.book-card .cover     { background: #FBEFDD; }   /* 封面占位 pLight */
.book-card .progress  { height: 4px; background: #E7E0D6; }  /* 进度条填充 primary */
/* 未读徽章：右上 8px 圆点 primary + 「未读」text */
```

继续阅读卡（364×104，圆角 12）：白底 + `1px #E7E0D6`，左侧 56×56 封面占位，底部进度条，meta `2 小时前` 用 `#78716C`。

## 骨架屏 / 失败卡（160×216）

```css
.skeleton-card  { background: #F1EDE5; border-radius: 12px; animation: shimmer 1.5s infinite; }
@keyframes shimmer { /* 亮度扫过，见 Components 板 */ }
.import-failed-card { border: 1px solid #DC2626; border-radius: 12px; }  /* 「导入失败」+ 重试按钮 */
```

## 消息气泡（AI 面板 400px 宽内）

```css
.msg-user        { background: #F4F1EA; border-radius: 12px; padding: 8px 12px; margin-left: auto; }
.msg-ai          { background: #F1EFE9; border-radius: 12px; padding: 12px; }
.msg-quote-card  { background: #FAF7F2; border-radius: 8px; padding: 12px; border-left: 3px solid #D97706; }
/* 引用卡内：来源「《三体》· 第 3 章」+ 右侧「点击展开全文」链接 primary */
.msg-toolfold    { border: 1px dashed #E7E0D6; border-radius: 8px; padding: 8px 12px; }  /* 工具调用折叠条 */
.stream-cursor   { width: 2px; height: 16px; background: #B45309; animation: blink 600ms steps(1) infinite; }
```

## Composer（368×68 输入区，圆角 12）

```css
.composer        { background: #fff; border: 1px solid #E7E0D6; border-radius: 12px; padding: 12px; }
.composer:focus-within { border-color: #D97706; }
.composer .hint  { font-size: 12px; color: #78716C; }  /* Enter 发送 · Shift+Enter 换行 */
.composer .net-search { color: #A8A29E; cursor: not-allowed; }  /* 🌐联网搜索(置灰)·@引用书页，tooltip「搜索接口待接入」 */
.composer .send  { width: 36px; height: 36px; border-radius: 50%; background: #D97706; color: #fff; }
```

## 划选工具条 / 高亮

```css
.selection-toolbar { background: #111827; color: #fff; border-radius: 8px; height: 44px; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
.selection-toolbar .active { background: #D97706; border-radius: 6px; }  /* 「问 AI」选中块 */
.highlight-palette .swatch { width: 20px; height: 20px; border-radius: 50%; }  /* 5 色 + 清除 */
/* 高亮气泡菜单：白底 1px #E7E0D6 圆角 10 阴影 0 8px 24px rgba(0,0,0,.2)，删除红字，删后 5s 可撤销 */
```

## Toast（240×40，圆角 8）

```css
.toast      { background: #111827; color: #fff; border-radius: 8px; height: 40px; padding: 0 16px; }
.toast.success { }           /* ✓ 已复制 — 1.5s 后消失 */
.toast.error   { color: #FCA5A5; }  /* ⚠ 回答生成失败 — 短暂显示 */
.toast.undo    { }           /* 已删除 + 右侧「撤销」primary 链接 — 5s */
```

## 确认弹窗（300×150，弹层圆角 16）

```css
.dialog { background: #fff; border: 1px solid #E7E0D6; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
/* 进入：缩放 40%→100% + 淡入 98%→100%，200ms */
```

## 下拉菜单 / 会话操作（168×118，圆角 10）

```css
.dropdown { background: #fff; border: 1px solid #E7E0D6; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
.dropdown .danger { color: #DC2626; }   /* 删除 */
.dropdown [data-placeholder] { color: #A8A29E; }  /* 「导出为 Markdown (占位)」*/
```

## 侧栏导航（220px 宽）

```css
.sidebar        { width: 220px; background: #FAF7F2; border-right: 1px solid #E7E0D6; }
.sidebar .item.active { background: #F4F1EA; border-left: 3px solid #D97706; color: #B45309; }
.sidebar .logo  { width: 48px; height: 48px; border-radius: 8px; background: #D97706; color: #fff; }
```

## AI 伴读面板（400×900，白底）

```css
.ai-panel { width: 400px; background: #fff; border-left: 1px solid #E7E0D6; }
.ai-panel .header { height: 56px; }  /* 《书名》· AI 伴读 + 当前会话名(点击重命名) + 历史按钮 */
.ai-panel .suggestion-chip { border: 1px solid #E7E0D6; border-radius: 16px; padding: 4px 12px; }
```

## ⌘K 命令面板（560px 弹窗）

```css
.cmdk-overlay { background: rgba(41,37,36,.5); }
.cmdk-panel   { width: 560px; background: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
.cmdk-item[data-selected] { background: #F4F1EA; border-left: 3px solid #D97706; }
/* #F4F1EA 已获 catnuko 2026-10-28 批准，spec §6 已同步回填为暖色 */
.cmdk-footer  { border-top: 1px solid #E7E0D6; color: #78716C; font-size: 12px; }
```

## 设置页控件

```css
.settings-select  { height: 40px; border: 1px solid #E7E0D6; border-radius: 8px; background: #fff; }
.settings-toggle[disabled] { opacity: .4; cursor: not-allowed; }  /* 联网搜索开关 + 「占位」badge */
.badge-placeholder { background: #FBEFDD; color: #B45309; border-radius: 4px; font-size: 12px; padding: 2px 8px; }
.segmented    { background: #F4F1EA; border-radius: 8px; }  /* 主题分段选择器：浅色/深色/跟随系统 */
.segmented [data-selected] { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.slider::-webkit-slider-thumb { width: 20px; height: 20px; border-radius: 50%; background: #fff; border: 2px solid #D97706; }
.slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, #D97706 var(--pct), #E7E0D6 var(--pct)); }
```
