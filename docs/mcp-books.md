# 书架 MCP server 与聊天书卡（search_books / get_reading_state / get_library）

2026-11-01 实现。给 Deer 内置一个书架 MCP server，让内置聊天框和外置
harness 都能查书架、读阅读状态；内置聊天框把工具结果里的书单渲染成
可点击书卡，点击直接开书。

## 架构

```
外置 harness（claude mcp add）──┐
                                ├──> desktop 二进制 --mcp-server（stdio MCP）──> library.json（只读）
Deer 内置聊天 ──> acpx ─────────┘         │
        │                                 └ deer:books 标记 JSON
        └<── books 事件（书卡）<── acpx.rs 从 tool_call_update 抽取
前端 ChatPanel 把书单渲染成书卡，点击 navigate /reader?book=<id>
```

- **一个 server，两个入口**：桌面二进制带 `--mcp-server` 参数时跳过 GUI，
  在 stdio 上跑 newline-delimited JSON-RPC（MCP 协议），stdin EOF 即退出。
  外置 harness 直接挂这个命令；内置聊天经 acpx 的 `--mcp-config` 挂载
  同一个命令（acpx 把它作为 ACP mcpServers 数组传给适配器）。
- **数据源**：前端书架的持久化文件 `library.json`（tauri-plugin-store 落在
  appDataDir，纯 JSON，camelCase）。Rust 侧只读，无需同步层。文件缺失或
  损坏按空书架处理。路径与 Tauri 的 appDataDir 同规则
  （macOS：`~/Library/Application Support/com.catnuko.deer`），
  `DEER_DATA_DIR` 环境变量可覆盖（测试用）。
- **不做推荐算法**：模型在聊天里结合 get_library / get_reading_state
  的返回自己挑书；推荐范围只限书架内已有的书。

## 工具（MCP server 名称 deer，工具名前缀 mcp__deer__）

| 工具 | 入参 | 返回 |
| --- | --- | --- |
| `search_books` | `query`（书名/作者/标签，大小写不敏感；空 = 全书架） | 书卡列表 |
| `get_reading_state` | 无 | 最近读过 ≤10 本（按 lastOpenedAt 倒序）+ current + summary |
| `get_library` | 无 | 全书架书卡 + shelves + total |

书卡字段：`id / title / author / format / progress / coverPath`。
工具结果 text 块统一是 `{"deer":"books","books":[...]}` 标记 JSON，
acpx 链路据此抽书卡（不依赖工具名元数据）。

## 外置 harness 接入

```bash
claude mcp add deer -- /Applications/deer.app/Contents/MacOS/desktop --mcp-server
# 权限放行（按需）：claude 里把 mcp__deer__* 加入 allowedTools，或在提示里允许
```

dev 环境的二进制是 `apps/desktop/src-tauri/target/debug/desktop`。
实测证据见下文「验收证据」。

## 内置聊天框接线（acpx.rs）

- 每轮聊天前把 MCP 挂载配置写到 `<tmp>/deer-mcp-server.json`
  （ACP 数组形态：`{"mcpServers":[{"name":"deer","command":<当前二进制>,"args":["--mcp-server"]}]}`），
  以顶层选项 `--mcp-config <path>` + `--allowed-tools mcp__deer__search_books,
  mcp__deer__get_reading_state,mcp__deer__get_library` 传给 acpx。
  权限策略仍是 `--deny-all`：只精确放行这三个工具，其余工具照旧拒绝。
  定位不到自身可执行文件时退化成无工具聊天。
- acpx 输出的 `tool_call_update`（status=completed）里 rawOutput 的 text 块
  若是 deer:books 标记 JSON，抽出 books 数组经 `claude://chunk` 事件
  （kind=books）推给前端。
- 前端 ChatPanel 把书单作为 assistant-ui 的 data part（name=books）挂在
  消息上，渲染成书卡（封面/书名/作者/进度），点击
  `navigate("/reader?book=<id>")` 复用现有开书通路。书单按书 id 去重后
  随消息落库（chat.json），重开面板仍可见。

## spike 结论（两个风险点的实测，2026-11-01）

1. **acpx 能带 MCP 配置**：`--mcp-config <path>`（顶层选项，必须在 `claude`
   子命令之前）原生支持；配置文件只认 ACP 数组形态，对象形态报
   `"Invalid mcpServers ... expected array"`。冷启动仍需先
   `acpx claude sessions new`（带同一 --mcp-config）。
2. **权限放行**：`--deny-all` 下 MCP 工具申请被拒（tool_call_update
   status=failed，rawOutput="User refused permission to run tool"）；
   追加 `--allowed-tools mcp__deer__search_books,...` 后工具真实执行，
   其余工具仍被拒。
3. **工具结果形状**：completed 的 tool_call_update，rawOutput 是内容块
   数组；Deer 工具的 text 块为标记 JSON，JSON 键序不定。初始 tool_call 帧
   rawInput 为空，实参在随后的 tool_call_update（沿用 spike 已知坑 4）。

## 验收证据（2026-11-01，本机实测）

- **外置 harness**：`claude mcp add deer -- target/debug/desktop --mcp-server`
  → `claude mcp list` 显示 `deer: ... - ✔ Connected`；headless
  `claude -p "…search_books…" --allowedTools "mcp__deer__search_books"`
  实际调用工具并返回真实书架数据（书名《三国演义》、进度 0.0208…）。
- **内置链路（acpx 同参实测）**：`acpx --mcp-config /tmp/deer-mcp-server.json
  --deny-all --allowed-tools mcp__deer__… claude -s … -f -` 提问
  「调用 search_books 查三国」→ 工具执行，completed tool_call_update
  rawOutput 携带真实书卡 JSON（含 coverPath / progress）。
- **测试**：`cargo test` 46 过（含 stdio 往返、三工具、书卡抽取、参数注入
  的单测）；`pnpm test` 211 过（含书单去重落库、书卡渲染与点击跳转）；
  `tsc --noEmit` 干净；`pnpm build` 绿（chunk 警告属原有）。
- **GUI 点击链路**：代码链路完整 + 单测覆盖（书卡渲染与 navigate 跳转）；
  dev 模式真机 GUI 的人工验证（聊天框提问 → 书卡 → 点击开书）待人工跑
  `pnpm tauri dev` 复核。
