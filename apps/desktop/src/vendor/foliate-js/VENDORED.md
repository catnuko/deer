# Vendored: foliate-js

本目录是第三方代码的**整仓快照**，不是本项目的代码。**不要手改本目录下的任何文件** ——
改动会在下次 bump 上游时被整体覆盖，而且会让"我们跑的是哪个版本的 foliate"变得不可追溯。
要修补上游行为，在本仓自己的模块里包一层（`src/lib/foliate.ts` 是包装层）。

## 快照信息

| 项 | 值 |
|---|---|
| 上游 | https://github.com/johnfactotum/foliate-js |
| 锁定 commit | `78914aef4466eb960965702401634c2cb348e9b1` |
| 获取日期 | 2026-10-29 |
| 许可证 | MIT |
| 体积 | 约 5.7 MB |

快照来源：本机另一个 Tauri 2 + macOS WKWebView 项目（`~/Documents/projects/luxlore`）
中同一 commit 的 vendor 副本，已用于线上，删减范围与本仓需求一致。
上游原始仓库为 13 MB / 231 个文件，本目录为 5.7 MB。

### 相对上游的删减

| 删除项 | 体积 | 理由 |
|---|---|---|
| `vendor/pdfjs/*.map` | 7.4 MB | PDF.js 的 source map，只用于调试 PDF.js 源码。运行时不需要。 |
| `tests/` | 20 KB | 上游自己的测试页，本仓不跑。 |
| `ui/` | 12 KB | 上游 demo 阅读器的 TOC 树与菜单，只被 `reader.js` 使用。 |
| `package-lock.json` | 40 KB | 上游 rollup 打包脚本的依赖树，本仓不用。 |

**已知副作用**：`reader.js` 仍 import 已删的 `./ui/tree.js` 与 `./ui/menu.js`，
所以上游 demo 阅读器在本目录里跑不起来。这不影响本仓（我们不加载 `reader.js` / `reader.html`）。

## 为什么是整仓快照而不是只拷核心文件

`view.js` 在运行时用**动态 `import()`** 加载下列同目录模块，路径写死：

```
./epub.js  ./comic-book.js  ./fb2.js  ./fixed-layout.js  ./mobi.js
./paginator.js  ./pdf.js  ./search.js  ./tts.js
./vendor/fflate.js  ./vendor/pdfjs/pdf.mjs  ./vendor/zip.js
```

少任何一个是**运行时**才炸（`pnpm build` 期间 Vite 不会静态解析到全部动态 import），
报错发生在用户打开某本特定格式的书时。Deer 支持 EPUB / MOBI / AZW3 / FB2 / CBZ / PDF，
这些运行时模块一个都不能省。

不用 git submodule：CI 的 `actions/checkout` 默认不拉子模块，会让构建静默失败。

## 本仓如何使用它

- `foliate.d.ts` 是本仓自带的类型声明（上游是纯 JS）。tsconfig 没有 `allowJs`，
  所以这些 `.js` 不参与编译；真正被编译的是 `.d.ts` 和引用它的 TS 模块。
- `src/lib/foliate.ts` 是包装层：格式嗅探、`File` 构造、目录展平、阅读样式、元数据读取。
- 喂入方式：**File 直喂，不开 assetProtocol**。`view.open(file)` 里 `makeBook()`
  只在字符串时才 fetch，传 `File` 直接走 `BlobReader` + zip.js，且 zip.js 已
  `configure({ useWebWorkers: false })` —— 没有 blob: 的 XHR，也没有 worker。

## 更新步骤（bump 到新 commit）

```bash
set -e
NEW_SHA=<新的完整 40 位 sha>

rm -rf /tmp/foliate-update
git clone https://github.com/johnfactotum/foliate-js.git /tmp/foliate-update
git -C /tmp/foliate-update checkout "$NEW_SHA"
git -C /tmp/foliate-update rev-parse HEAD   # 必须是完整 sha

rsync -a --delete \
  --exclude='.git/' --exclude='foliate.d.ts' --exclude='VENDORED.md' \
  --exclude='tests/' --exclude='ui/' --exclude='package-lock.json' \
  --exclude='*.map' \
  /tmp/foliate-update/ apps/desktop/src/vendor/foliate-js/

rm -rf /tmp/foliate-update
```

bump 后**必须**重新核对：

1. 本文件顶部的 commit sha、获取日期、体积。
2. `foliate.d.ts` 是否仍与源码一致（上游明确声明 API 不稳定）。重点比对
   `View` 的方法与事件、`makeBook` 接受类型、`relocate` 的 payload 结构。
3. 动态 `import()` 列表 —— 上游新增格式会引入新文件，rsync 会带进来。
4. `pnpm --filter deer-desktop build`。

## 许可证

上游为 MIT，`LICENSE` 原件随快照保留在本目录。

`vendor/` 子目录是上游二次内联的第三方代码（`vendor/pdfjs/` 为 PDF.js，
`vendor/zip.js` 为 zip.js，`vendor/fflate.js` 为 fflate），它们自带
`LICENSE_FOXIT` / `LICENSE_LIBERATION` 等许可文件，随快照一并保留。
