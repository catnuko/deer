# 应用内自动更新方案评估（tauri-plugin-updater）

2026-11-06 调研。目标：装好 Deer 后软件里能直接更新，不用重新安装。

## 现状核对（与简报口径的差异）

- `tauri.conf.json` 未配置 updater；Cargo 与前端都未引入 updater 插件。
- `.github/workflows/release.yml` 实际只做「读版本 → 打 tag → 建 GitHub Release」，**不构建安装包、不上传 Supabase Storage**。安装包目前只能本机手工 `pnpm tauri build`。此前「release.yml 上传 Supabase」的说法与仓库现状不符。
- CI（ci.yml）只在 ubuntu 上跑 lint/test/build，没有任何 macOS 构建产物。
- 本机钥匙串只有一枚 **Apple Development** 证书（`Apple Development: 346746061@qq.com (9S4R34YT6Z)`，免费账号档）。它只能开发期真机调试，**不能用于对外分发**。

## 关键结论

1. Tauri 2 updater 校验的是更新包的 **minisign 签名**（`TAURI_SIGNING_PRIVATE_KEY`），与 Apple 证书无关，零成本可配。
2. 但 macOS 分发没有 **Developer ID Application 证书 + 公证（notarization）** 的话，用户首次安装和每次更新都会撞 Gatekeeper（「已损坏，无法打开」「无法验证开发者」）；Apple Silicon 上未签名应用默认直接拒开。所以 Apple Developer Program（$99/年）是 macOS 正式分发的硬前置，updater 本身绕不开它。
3. 更新清单 `latest.json` 放 **GitHub Releases 资产**最省事（现有流程已自动建 Release），不需要新引入 Supabase 基建；Supabase Storage 公开桶也可以，作为备选。

## 前置条件清单（需 catnuko 本人操作或决策）

1. [ ] 注册 Apple Developer Program（$99/年），生成 **Developer ID Application** 证书并导入本机钥匙串（现有的 Apple Development 证书不能用于分发）。
2. [ ] 拍板更新清单托管：GitHub Releases 资产（推荐，零新增基建）或 Supabase Storage 公开桶。
3. [ ] 生成 minisign 密钥对：`pnpm tauri signer generate -w ~/.tauri/deer.key`。口令自留；**私钥只进 GitHub Secrets，绝不进仓库**。
4. [ ] 配置 GitHub Secrets：
   - `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（updater 必需）；
   - 走 Apple 签名公证时再加：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`（App 专用密码）、`APPLE_TEAM_ID`。
5. [ ] 拍板检查时机：启动静默检查 / 设置页手动「检查更新」/ 两者都要。

## 落地方案（前置齐了照此执行）

### 1. tauri.conf.json

```json
"plugins": {
  "updater": {
    "pubkey": "<minisign 公钥，第 3 步生成>",
    "endpoints": [
      "https://github.com/catnuko/deer/releases/latest/download/latest.json"
    ]
  }
}
```

用 GitHub Releases 的 `latest/download` 路径：每次发版把 `latest.json` 作为 Release 资产上传，客户端永远拿到最新清单。

### 2. Rust 侧（apps/desktop/src-tauri）

- `Cargo.toml`：`tauri-plugin-updater = "2"`、`tauri-plugin-process = "2"`（更新完成后重启用）。
- `lib.rs` builder：`.plugin(tauri_plugin_updater::Builder::new().build())`、`.plugin(tauri_plugin_process::init())`。
- capabilities 新增权限：`updater:default`、`process:allow-restart`。

### 3. release.yml 增加构建 job

- runner 从 ubuntu 换 **macos-14**（Apple Silicon），用 `tauri-apps/tauri-action` 构建，`includeUpdaterArtifacts: true` 让它产出 `.app.tar.gz` + `.app.tar.gz.sig`。
- Release 资产上传：dmg、`.app.tar.gz`、`.app.tar.gz.sig`、`latest.json`。
- `latest.json` 结构（macOS 上 updater 只认 `.app.tar.gz`，dmg 装不了自动更新）：

```json
{
  "version": "0.2.0",
  "notes": "本次更新说明",
  "pub_date": "2026-11-06T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<.app.tar.gz.sig 的内容>",
      "url": "https://github.com/catnuko/deer/releases/download/v0.2.0/deer.app.tar.gz"
    }
  }
}
```

（需要 Intel 版再并列加 `darwin-x86_64`。）

### 4. 前端

- 启动时或设置页触发 `check()`（`@tauri-apps/plugin-updater`）→ 有更新则 `downloadAndInstall()` → `relaunch()`（`@tauri-apps/plugin-process`）。
- 判断基准是 `tauri.conf.json` 的 `version`，发版必须先改它（现有 release.yml 已按它打 tag）。

### 5. Windows / Linux（后续）

同一份 `latest.json` 的 `platforms` 里并列加 `windows-x86_64`（nsis）等条目即可，前端代码不变。

## 风险与注意

- 公钥与私钥不配对时 updater 会静默失败：首次上线务必用生成的测试密钥把「构建 → 上传 → 客户端检查 → 下载 → 重启」全流程走通一遍。
- macOS 签名 + 公证在 CI 里通过 tauri-action 传 Apple 系列 Secrets 完成；证书过期或 Secrets 失效时构建会退化为无签名包，必须盯构建日志。
- `pub_date` 必须是 RFC 3339 格式，否则清单解析失败。
