# 桌面安全基线（CSP 与 Tauri 权限）

> ALNA-191 落地的桌面安全基线说明。决策背景：项目不走正式签名/公证（unsigned dmg + `xattr -cr` 指引暂保留），CSP 与权限最小化是当前唯一能落地的桌面安全防线。

## 生产 CSP

`apps/desktop/src-tauri/tauri.conf.json` → `app.security.csp`（生产构建注入）；`devCsp: null`，开发模式（vite dev + HMR + devtools）不受限。

按 Deer 实际用到的源逐条放行，没有照抄模板：

| 指令 | 值 | 为什么需要 |
| --- | --- | --- |
| `default-src` | `'self'` | 兜底；应用资源只来自打包产物（tauri:// 协议） |
| `script-src` | `'self' 'wasm-unsafe-eval'` | 打包后的 JS 足够；`wasm-unsafe-eval` 是 vendored PDF.js（`src/vendor/foliate-js/vendor/pdfjs`）编译 WASM 模块（qcms/OpenJPEG）所需。不放 `unsafe-eval`：PDF.js 检测到 eval 不可用会自动降级（字体渲染变慢但功能正常） |
| `style-src` | `'self' 'unsafe-inline' blob:` | `unsafe-inline`：foliate 分页器向 shadow DOM 注入 `<style>`、React 的内联 style 属性；`blob:`：FB2 渲染器把样式生成 blob URL 挂 `<link>` |
| `img-src` | `'self' blob: data:` | 封面与书内图片走 `readFile` → Blob → objectURL（`blob:`）；EPUB 内嵌 data URI 图片（`data:`） |
| `font-src` | `'self' blob: data:` | EPUB 可内嵌字体，foliate 以 blob URL 加载 |
| `media-src` | `'self' blob: data:` | EPUB/MOBI 内嵌音视频资源（foliate 解包为 blob URL） |
| `connect-src` | `'self' blob: https: http://localhost:* http://127.0.0.1:* ipc: http://ipc.localhost` | 见下方「已知的宽放行」 |
| `frame-src` | `'self' blob:` | foliate 用 sandbox iframe 渲染分节内容（EPUB/CBZ/FB2 固定版式），节内容以 blob URL 提供 |
| `worker-src` | `'self' blob:` | PDF.js worker（构建后从应用自身 origin 加载） |
| `object-src` | `'none'` | 禁用 `<object>`/`<embed>`，无使用场景 |
| `base-uri` | `'self'` | 防注入改写相对链接基准 |
| `form-action` | `'self'` | 无跨源表单提交场景 |

**不需要的源**：未启用 `assetProtocol`（书文件与封面一律 `plugin-fs` 读字节 → blob URL，不经过 asset 协议）；无内联 `<script>`（Vite 打包全部外链）；无远程前端资源。

### 已知的宽放行（有意为之）

- `connect-src https:`：AI 引擎的 base URL 是用户可配置的（默认 `https://open.bigmodel.cn/api/paas/v4`，另支持 Anthropic 兼容与自建网关），无法枚举。这是 CSP 里最宽的一条，接受它的原因是： Deer 是本地优先应用，webview 内没有服务端可打，主要敏感面（书籍数据）通过 Tauri IPC 读取，`fetch` 外发仅限用户自己填写的 AI 端点。
- `http://localhost:* http://127.0.0.1:*`：支持本地推理服务（如 Ollama）作为 openai-compatible 端点。

Tauri 会自动给注入的 IPC 初始化脚本加 nonce，无需为 IPC 放行内联脚本；`ipc: http://ipc.localhost` 写出来是为了显式记录 IPC 通道来源。

## Tauri capabilities 最小化

`apps/desktop/src-tauri/capabilities/default.json`。原则：只开前端实际调用的命令，且全部用 allow scope 限定到应用数据目录（`$APPDATA`，即 `~/Library/Application Support/com.catnuko.deer/`）。

| 当前授予 | 为什么需要 | 相对之前的收紧 |
| --- | --- | --- |
| `fs:allow-read-file`（scope `$APPDATA`、`$APPDATA/**`） | 读书库备份、书籍文件、封面（`bookStore` / `covers` / `ReaderPage`）；导入时读取的文件经 `plugin-dialog` 选定后由 dialog 插件自动扩展进 fs 运行时 scope，无需放宽静态 scope | 收紧 |
| `fs:allow-mkdir`（同上 scope） | 创建 `books/`、`covers/` 子目录 | 收紧 |
| `fs:allow-write-file`（同上 scope） | 写书籍文件、封面、`library.json.bak-v1` 备份 | 之前完全无 scope（= 应用数据目录树内任意写），现在限定 `$APPDATA` |
| `fs:allow-remove`（同上 scope） | 删除书籍时移除书文件与封面 | 同上 |
| `fs:deny-default` | 兜底拒绝 webview 数据目录（Windows/Linux），为未来跨平台留防线 | 新增 |
| `dialog:default` | 导入书籍的文件选择框 | 保留 |
| `store:default` | `library.json`、批注、聊天、概念图四个 store 的读写（plugin-store 自行落盘到 `$APPDATA`，不经 fs 插件 scope） | 保留 |
| `opener:allow-open-path`（scope `$APPDATA`） | 设置页「打开数据目录」按钮（`DataSection`） | 保留但收紧 |
| `core:default` | 窗口/事件/路径（`appDataDir`）等核心 IPC | 保留 |

**删除的条目**：

- `fs:default`：它等于「五个应用专属目录（AppData/AppConfig/AppLocalData/AppCache/AppLog）递归读 + mkdir + exists」的组合包，远超实际需要（真正用到的只有 `$APPDATA` 下的 read/mkdir/write/remove，且 write/remove 之前还是无 scope 的）。改为按命令显式授予。
- `opener:default`：含 `allow-open-url`（任意 URL 唤起浏览器/邮件应用）与 `allow-reveal-item-in-dir`，前端没有任何调用点。只保留 scoped 的 `opener:allow-open-path`。

**验证清单**（改动 fs scope 后回归的点）：导入书（任意目录选取）、阅读翻页、封面显示、高亮笔记、AI 面板聊天、设置页「打开数据目录」、删除书。
