# acpx 连接层 Spike 报告

日期：2026-10-31 · 分支：`spike/acpx`（基于 dev `cc95a01`）· 执行：现代 Web 应用专家

## 结论

**四项验证全部可行**，acpx 可以作为 Deer「多 agent（多 harness）」线的连接层进入正式开发。

| 验证项 | 结论 | 关键证据 |
| --- | --- | --- |
| 流式正文 | ✅ 可行 | 一次回复产生 68 个 `agent_message_chunk` 增量事件 |
| 深度思考块 | ✅ 可行 | `agent_thought_chunk` 独立流出（一次推理 28 块），与正文事件可区分 |
| 工具事件 | ✅ 可行 | `tool_call` / `tool_call_update` 结构完整，含 toolCallId、kind、status 迁移与结果内容 |
| 会话恢复 | ✅ 可行 | 新 CLI 进程自动恢复同一 ACP sessionId，模型记得上一轮内容（跨进程实测） |

## 版本锁定

- **acpx：`0.21.1`**（npm 全局安装）。pre-1.0 alpha，CLI 面可能在小版本间破坏，正式开发必须在 spawn 命令里锁死版本（`acpx@0.21.1`），升级走显式变更。
- 适配器：acpx 经 `npm exec` 拉起 `@agentclientprotocol/claude-agent-acp@^0.95.0`（官方 ACP Claude 适配器，与 acpx 版本解耦，由 acpx 管理）。
- **Node：本机 v24.20.0**，满足官方要求 ≥22.13。Deer 侧仍需做检测与安装引导（见任务单约束）。

## 输出格式验证（核心前提）

`acpx --format json --json-strict claude "<prompt>"` 的 stdout 为**未经包装的 ACP JSON-RPC 2.0 NDJSON**，无信封、无键名改写。样例（摘自实测 `/tmp/acpx-spike/p1.ndjson`）：

```json
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},"clientInfo":{"name":"acpx","version":"0.21.1"}}}
{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"fork":{}}},"agentInfo":{"name":"@agentclientprotocol/claude-agent-acp","version":"0.95.0"}}}
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"ff61f842-…","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"你好"},"messageId":"msg_…"}}}
{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn","usage":{"inputTokens":11964,"outputTokens":3}}}
```

事件类型实测清单：`initialize`、`session/new`、`session/prompt`、`session/update`（`agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `available_commands_update` / `session_info_update` / `usage_update`）、`_auth/status_update`。

## 与现有 claude_acp.rs 的对照（改动量估计）

现有 `apps/desktop/src-tauri/src/claude_acp.rs`（818 行）按 prompt spawn `@zed-industries/claude-code-acp` 并解析 `session/update` 的 snake_case 事件（`agent_message_chunk`/`agent_thought_chunk`），**与 acpx 的输出完全同构**。因此：

- **解析层：基本零改动**。`parse_session_update` / `chunk_text` 等函数可直接消费 acpx 的 NDJSON；现有单元测试样例即 acpx 实际输出格式。
- **接入层：主要工作**：
  1. spawn 目标从适配器直连改为 `acpx --format json --json-strict <agent>` 子进程（需 Node 检测）；
  2. 会话管理移交 acpx（`~/.acpx/sessions/<record>.json` + 流式事件日志，resume 按 cwd 定位），Deer 不再自管 ACP sessionId 生命周期；
  3. 处理 acpx 多出的通知类型（`available_commands_update`、`usage_update`、`_auth/status_update`）——忽略或择要透传；
  4. 权限策略接线（`--approve-all` / `--approve-reads` / `--permission-policy`）映射到 Deer 的并发门控（CHAT_GATE）。
- 粗估：解析层 <50 行改动，接入层（spawn、会话映射、权限）约 200–300 行新代码，现有 Claude 单链路可完全不动。

## 与官方文档不符 / 坑（以实测为准）

1. **必须先建会话**：冷环境直接 `acpx claude "<prompt>"` 返回 JSON-RPC 错误 `-32002 NO_SESSION`，需先 `acpx claude sessions new`（或先用 `sessions ensure`）。文档未把这一步放在显眼位置。
2. **首次拉包瞬时失败**：`sessions new` 首次运行偶发 `spawn Unknown system error -88`（npm exec 冷缓存），重试即恢复。正式实现需要 spawn 失败重试。
3. `--json-strict` 与 `--verbose` 互斥（`-32602 USAGE` 错误）。
4. `tool_call` 事件的 `rawInput` 为空 `{}`，工具实际入参在后续 `tool_call_update` 的 content 里（edit 为 diff 结构，read 为文本块）。UI 若要显示工具入参需从 update 里取。
5. 会话按 cwd 维度组织（同 cwd 复用同一 acpx record），多书/多工作区需注意 cwd 隔离语义。

## dev 行为未变验证

- `pnpm test`：**26 个文件 201 用例全过**（4.72s）
- `tsc --noEmit`：干净
- `cargo check`：通过（仅既有 dead_code 警告）
- 本分支相对 dev 无任何源码改动，dev 分支行为不变。

## 建议

进入正式开发：Rust 侧 spawn 锁版本 acpx 子进程、复用现有解析链路、会话与权限按上节接入层方案实现；先做 Node 检测与安装引导，再迁移第一条多 harness 链路。
