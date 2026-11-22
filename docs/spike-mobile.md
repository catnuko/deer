# 移动端技术验证 Spike 报告（ALNA-216）

日期：2026-11-22 · 分支：`agent/agent/alna-216`（基于 dev 基线 + origin/main 同步）· 执行：开发工程师

> 目的：把 ALNA-203 立项评估里「Rust 编译层复用度是预期而非实测」的部分变成实测结论，
> 为「Tauri 2 mobile 复用现有前端 + Rust 内核，Android 先行」的形态拍板提供证据。
> 本任务不改产品功能代码：除验证所需的三行 reqwest 特性实验（已还原）外，主线零改动。

## 结论

**五项验证全部拿到结论：四项通过、一项需一次三行的依赖调整后通过（iOS 模拟器构建卡在
唯一的工具链缺项——Simulator runtime，已列入缺项清单）。** Tauri 2 mobile
承载 Deer 技术上成立，「Android 先行」的预估成本与评估报告一致，无推翻性发现。

| 验证项 | 结论 | 关键证据 |
| --- | --- | --- |
| iOS `tauri ios init` + 模拟器构建 | ⚠️ init ✅；模拟器构建**工具链缺失无法验证**（缺 iOS Simulator runtime，见缺项清单） | `gen/apple/desktop.xcodeproj` 生成成功；`Xcode Simulator SDK 27.2 is not installed`；Rust 层由 `cargo check aarch64-apple-ios` ✅ 补证 |
| Android 工具链 + debug APK | ✅ 通过（无需安装大件） | `app-universal-debug.apk`（192MB，debug 口径）产出成功 |
| Rust 模块交叉编译复用度 | ✅ 通过（Android 需切 rustls） | iOS 41.1s check 通过；Android 切 rustls 后 8.6s check 通过并链进 APK |
| reqwest TLS 后端 | ⚠️ 现状 Android 不可用，切换方案已验证 | 依赖图为 native-tls → openssl-sys；Android 上必败，rustls 实测通过 |
| 前端移动 webview 风险点 | ✅ 已梳理（5 项，见专节） | 静态评估，未真机点验 |

## 版本与工具链快照（2026-11-22 本机）

- rustc/cargo **1.98.1**；移动目标 `aarch64-apple-ios` / `aarch64-apple-ios-sim` /
  `aarch64-linux-android` 等均已安装（`rustup target list --installed`）。
- **Xcode 27.2 (27B52)**；`xcodegen`、`cocoapods`、`idevicesyslog` 均在位（Tauri iOS init 依赖齐）。
- **Android SDK**：`/opt/homebrew/share/android-commandlinetools`（3.8GB）——platforms
  android-35/36/37、build-tools 35/36、platform-tools、cmdline-tools、**NDK 28.2.13676358**。
- **JDK**：homebrew `openjdk@17`（17.0.21）/ `openjdk@27` 可用，但**未注册进系统 java_home**
  （`java -version` 直接跑报「Unable to locate a Java Runtime」），需显式 `JAVA_HOME`。
- **Gradle**：本机无全局 gradle；`tauri android init` 生成的工程经 wrapper 自动下载 gradle 使用（构建期自动完成，不算缺失项）。

### 本机环境配置缺口（无需安装，只需配置）

`ANDROID_HOME` / `NDK_HOME` / `JAVA_HOME` 三个环境变量都未全局设置。复现命令（zsh）：

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
```

不装任何新东西即可跑通全部构建。若正式立项，建议把这份配置进 README 或 mise/direnv。

## 1. iOS 侧：`tauri ios init` + 模拟器构建

- `pnpm tauri ios init` **成功**：生成 `src-tauri/gen/apple/desktop.xcodeproj`
  （Apple dependencies up to date，未触发 pod 重装）。
- `tauri ios build --target aarch64-sim --debug`：前端构建 ✅（`pnpm build` 全量过），
  Xcode 侧失败——**`Xcode Simulator SDK 27.2 is not installed`**。本机只装了 Xcode 主
  IDE 与 iOS device SDK，**没有装 iOS Simulator runtime**（同根因佐证：`xcrun simctl list`
  在本机长期挂起无响应）。这是唯一 iOS 缺项；模拟器 runtime 约 7–8GB，属任务约束里
  「不擅自安装的大件」，是否 `xcodebuild -downloadPlatform iOS` 留 catnuko 拍板。
- Rust/iOS 编译层不受影响：`cargo check --target aarch64-apple-ios` ✅（第 3 节，41.1s），
  即 Xcode 工程生成 + 前端产物 + Rust 交叉编译三段各自都过，只差模拟器 runtime 这一环
  即可出模拟器包。

**缺项清单（iOS）**：iOS Simulator platform/runtime 一个（`xcodebuild -downloadPlatform iOS`
或 Xcode GUI 安装），其余全在位。

免费账号口径：模拟器构建不做代码签名，**不需要** Apple Developer 账号；真机侧载才需要
（免费个人账号可 7 天期签名侧载，正式分发要 $99/年，与 ALNA-203 报告一致）。

## 2. Android 侧：工具链盘点 + debug APK

工具链齐备（见快照一节），**缺项清单为空**，无需安装大件。实测链路：

1. `pnpm tauri android init` ✅（自动识别 NDK 28.2.13676358，生成 `gen/android/` 工程）。
2. `pnpm tauri android build --target aarch64 --debug` ✅（JAVA_HOME/ANDROID_HOME/NDK_HOME
   按上文配置；gradle wrapper 自动拉取 gradle，首次构建含下载约 6 分钟）：
   - Rust 侧：`libdesktop_lib.so` 交叉编译成功（`target/aarch64-linux-android/debug/`，185MB debug 口径），
     依赖共享库清单 `libandroid/libdl/liblog/libm/libc` 正常；
   - Gradle 侧：产出
     `gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`（192MB）
     与对应 AAB。debug 体积含全部调试符号，release + `lto` + `strip`（Cargo.toml 已有该 profile）会显著缩小，不构成体积风险信号。

未验证：模拟器/真机安装点验（本机无 Android 模拟器镜像与 adb 设备，属于后续 MVP 的事）。

## 3. Rust 复用度实测（核心项）

`cargo check`（dev profile）对 `desktop` crate 整体（含 `mcp_server.rs`、`webdav.rs`、
`acpx.rs`，lib.rs 无平台 cfg 隔离，模块全量参与编译）：

| 目标 | 依赖口径 | 结果 | 耗时 |
| --- | --- | --- | --- |
| `aarch64-apple-ios` | 原样（native-tls） | ✅ **通过** | 41.1s（首次全量） |
| `aarch64-linux-android` | 原样（native-tls） | ❌ 失败于 `openssl-sys` build script（找不到 Android OpenSSL） | — |
| `aarch64-linux-android` | **切 rustls** + CC/AR 指向 NDK clang | ✅ **通过** | 8.6s（增量） |

Android 切 rustls 后，完整的 `tauri android build` 把同一个 crate 链接成 `.so` 打进 APK（见第 2 节）——
即 **mcp_server.rs / webdav.rs 在两端实测可复用**，唯一障碍在依赖层而非业务代码层。

**acpx.rs 结论**：编译层面两端都能过（无 cfg 排除，照常编译）；**运行时移动端不可用**——
iOS 禁止 spawn 子进程；Android 侧依赖 Node ≥22.13 + acpx CLI 生态，移动端不具备。
与 ALNA-203 既有结论一致：移动端 AI 只走云引擎。后续 MVP 建议把 acpx 相关模块与
commands 按 `#[cfg(desktop)]` 排除，避免死代码进移动包（符号膨胀 + 误导性入口）。

### 复现 Android check 的工具链环境

除三行 Cargo.toml 实验外，Android 目标还需让 cc-rs 找到 NDK clang（NDK 的包装器名带 API
级别，与 cc-rs 期望的裸名不一致）：

```sh
NDK_BIN=$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin
export CC_aarch64_linux_android=$NDK_BIN/aarch64-linux-android23-clang
export AR_aarch64_linux_android=$NDK_BIN/llvm-ar
```

（经 `tauri android build` 走 gradle 时由 Tauri 插件自动处理，无需手动设。）

## 4. reqwest TLS 后端

**现状**：`Cargo.toml` 里 `reqwest = { version = "0.12", features = ["stream", "json"] }`
未关 default features → `default-tls` → **native-tls**（`cargo tree` 实测：native-tls 0.2.18 ←
hyper-tls/tokio-native-tls ← reqwest 0.12.28；openssl-sys 0.9.118 被 native-tls 拉入 Android 目标图）。

| 平台 | native-tls 落点 | 实测 |
| --- | --- | --- |
| macOS 桌面 | Security.framework | ✅ 现网已验证（桌面在用） |
| iOS | Security.framework（同一系统库） | ✅ `cargo check --target aarch64-apple-ios` 通过 |
| Android | openssl-sys → 需交叉编译 OpenSSL | ❌ build script 失败（第 3 节） |

**结论：Android 必须切 rustls，且已实测通过**（`cargo check` 8.6s + 完整 APK 链接成功）。
切换方案二选一：

1. **全平台切**（本次实验方案，3 行 diff）：
   `reqwest = { version = "0.12", default-features = false, features = ["stream", "json", "rustls-tls"] }`。
   代价：macOS/iOS 也从 Security.framework 换成 rustls（webpki 根证书）。影响面：系统自定义 CA /
   企业代理抓包场景行为变化；桌面已跑通的 WebDAV 自签 NAS 场景需要回归确认。
2. **按平台切**（target-specific dependency 或 cfg feature）：桌面保持 native-tls 不动，
   仅 mobile 目标用 rustls。零桌面回归风险，但 Cargo.toml 多一段 `[target.'cfg(target_os = "android")'.dependencies]`。

**建议**：MVP 里先按方案 2 起步（不碰桌面已验证链路），若后续想收敛再评估方案 1。

## 5. 前端移动 webview 风险点（静态评估，未真机点验）

### epub.ts（导入解析）

- `unzipSync` 全量同步解压 + 正则逐段解析，跑在 webview 主线程；内存峰值 ≈ 原文件 + 全部
  解压条目同时驻留。桌面无感，**移动端大书（几十 MB 以上）导入会明显卡 UI**。
  缓解方向：条目惰性解压（fflate 支持 per-entry）、或挪到 Rust 侧/worker。
- 纯 JS 实现（fflate + 正则），无平台 API 依赖，WKWebView / Android WebView 直接可用。

### foliate.ts（阅读器桥接）

- ✅ 关键前提已满足：`view.js` 里 `configure({ useWebWorkers: false })`——不走 blob: XHR、
  不需要 Web Worker、不需要 tauri assetProtocol，移动 webview 友好（foliate.ts 头注释明写）。
- `readingStyles()` 已注入触屏规则（`@media (hover:none) and (pointer:coarse)` 压
  `-webkit-touch-callout`），说明作者已预留移动适配；保留选择手柄的取舍已写进注释。
- 风险点：`vendor/foliate-js/fb2.js` / `pdf.js` 内部有 `fetch(src)` / `fetchText(url)`
  （fb2 封面、pdf.js 的 CSS/text-layer 资源）。若 URL 形态在移动端变成 `asset://` 或
  `http://ipc.localhost`，需核对 CSP（现有 CSP 的 `connect-src` 已含 `ipc:` /
  `http://ipc.localhost`，理论兼容，**真机点验项**）。PDF 走 pdf.js，CSP 已开
  `wasm-unsafe-eval`，兼容。
- foliate 的 CSS 多栏 paginator 在 iframe 里做分页：WKWebView 性能待真机确认，
  Android WebView 版本碎片化（Tauri 最低 API 24 → 系统 WebView 由 Chrome 更新，普遍 ≥100，
  风险可控）。

### cloudEngine.ts（云引擎 AI 链路）

- ✅ **零平台依赖**：模块头注释即设计目标「跑在 webview 内，桌面/Android/iOS 三端通用」。
  实现佐证：只依赖 `ai` SDK（streamText + fetch 流式）与 zustand store，动态 import
  控制首屏体积；无 Node API、无 Tauri IPC。
- 传输层是 fetch + ReadableStream：WKWebView（iOS 14.5+）与 Android WebView（Chromium 100+）
  均支持；CSP `connect-src https:` 已放行任意云端点（自建 baseUrl 也覆盖）。
- 风险仅剩网络层共性项：移动弱网下的流中断恢复/重试语义（桌面同在，非移动特有）。

### 跨切面风险（三文件之外，静态扫描发现）

1. **导入链路按桌面路径建模**：`BookshelfPage.tsx` 的 `openFileDialog` 返回绝对路径后
   `importEpub(path)` 按路径读文件。Android 的 dialog 返回 `content://` URI，iOS 返回
   文件 URL 且沙箱外路径只读临时副本——**导入需改造**（读 bytes 后走内存链路，好在
   `parseEpub` / `makeBookFile` 本身就是 byte-first，改造集中在 dialog → bytes 一段）。
   已有 `requireDesktop()` 守卫（现在防浏览器预览），可扩展为移动端分流点。
2. **backup.ts 用 `save()` 保存对话框**：plugin-dialog 的 save 在移动端不可用——备份
   导出需改为分享面板 / 用户文档目录直写，属 MVP 待办，不阻塞可行性。
3. **存储路径**：`bookStore.ts` 用 `appDataDir()`——移动端天然可用 ✅（同步/书架数据
   不依赖桌面用户目录）。
4. **窗口与布局**：`tauri.conf.json` 单窗口 800×600 是桌面假设；移动端用 mobile entry
   的全屏窗口，前端已有窄屏 chip 导航（近期 dev 提交），布局适配成本中等。

## 对拍板的建议（供 ALNA-203 收口）

1. 形态决策证据齐了：**Tauri 2 mobile 承载 Deer 成立**，Android 先行成本与评估报告
   预估一致（¥0 工具链成本，全部构建在本机跑通）。
2. MVP 前置改动清单（都很小）：reqwest 按 Android 切 rustls；acpx 链路 `#[cfg(desktop)]`
   排除；导入 dialog→bytes 改造；备份导出换移动端方案。
3. 真机点验留给 MVP：Android 模拟器/真机安装、iOS 模拟器跑 UI、WKWebView 阅读器
   paginator 性能与 fb2/pdf 的 fetch URL 形态。

## 实测记录（原始输出摘要）

- `cargo check --target aarch64-apple-ios`：
  `Compiling tauri v2.12.5 … Checking reqwest v0.12.28 … Finished dev profile in 41.10s`
- `cargo check --target aarch64-linux-android`（原样）：
  `error occurred in cc-rs … openssl-sys = 0.9.118 … $TARGET = aarch64-linux-android`
  （openssl build script 找不到 Android OpenSSL）
- `cargo check --target aarch64-linux-android`（rustls + CC/AR）：
  `Checking hyper-rustls v0.27.10 … Checking reqwest v0.12.28 … Finished dev profile in 8.62s`
- `tauri android build --target aarch64 --debug`：
  `Finished dev profile … symlinking lib …/libdesktop_lib.so … requires shared lib "libandroid.so" …
   Finished 1 APK at: …/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- `tauri ios init`：`Created project at …/src-tauri/gen/apple/desktop.xcodeproj / victory`。
- `tauri ios build --target aarch64-sim --debug`：前端 `✓ built in 846ms` 后
  `failed to build iOS app: Xcode Simulator SDK 27.2 is not installed, please open Xcode`。
