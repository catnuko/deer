# acpx / 直连链路流式时间戳证据（2026-10-31）

排查「真机反馈：等很久后正文一次性出现，无流式、无思考过程」。
结论：**各机械层（acpx 子进程 → Rust 解析 emit → 前端渲染）全部逐块流式，未发现攒批 bug**；
真机观感来自「首 token 延迟 10–18 秒 + 模型以 ~40–60 块/秒快速生成」，
且 harness 选择器（8679858，21:42:46 提交）落地前真机从未真正走过 acpx 链路
（诊断日志 ~/Library/Logs/deer/claude-acp.log 中 12 次 acpx spawn 全部是
`record=deer-selftest-e2e` 的 Rust E2E，无任何 `deer-<threadId>` GUI 调用）。

## 探针 1：acpx 子进程在管道下是否流式

`timing_probe.py`：与 Rust 侧同款 spawn（stdout 管道、prompt 走 stdin），
逐行记录 NDJSON 到达时间。会话 `deer-timing-probe`，prompt「写一段约200字秋天的短文」。

```
chunk lines=169 first=11.056s last=14.651s span=3.595s
exit=0 total=15.723s lines=182
```

169 个正文块在 3.6 秒内陆续到达（~47 块/秒）——acpx 在非 TTY 管道下不攒批。
前 11 秒是适配器冷启动 + 模型首 token 延迟。

## 探针 2：深度思考（MAX_THINKING_TOKENS=10000）思考块是否先行

`think_probe.py`，prompt「解释什么是闭包」：

```
thought: 150 chunks first=14.34s last=16.80s span=2.45s chars=746
message: 268 chunks first=16.81s last=21.20s span=4.40s chars=597
thought before message: True
exit=0 total=22.32s
```

MAX_THINKING_TOKENS 对 claude-agent-acp 生效（spike 未验证项，此处补验）：
思考块独立、先行流出，正文随后，前端已有 reasoning 折叠块渲染。

## 直连 GUI 会话的到达分布（诊断日志逐行时间戳）

| 会话开始 | spawn→首块 | 正文块数 | 块跨度 | 速率 |
|---|---|---|---|---|
| 10-31 07:35 | ~13s | 100 | 2.0s | 50/s |
| 10-31 08:25 | ~15s | 283 | 8.0s | 35/s |
| 10-31 20:03 | ~18s | 218 | 5.3s | 41/s |
| 10-31 21:45 | ~14.5s | 248 | ~9.8s | ~40/s |

21:45 会话明细：spawn 21:45:37.5 → initialize 37.65 → session/new 41.88 →
首正文块 52.03 → 末块 21:46:01.8。所有 GUI 会话同一形态：
**先静默 10–18 秒（适配器初始化 ~4.5s + 模型首 token ~10s），再以 35–50 块/秒倾泻**。
2–8 秒倾泻完一篇短回复，人眼观感即「一下子出来」；模型是网关路由的
GLM-5.3-Flash，生成速度本身极快。

## 前端渲染层回归测试

`ChatPanel.test.tsx` 新增两条（真实计时器逐块 onDelta）：

- 「流式增量逐块渲染：正文块到达即显示，不等回复完成」——第一块出现时断言
  后续块尚未在 DOM（排除「憋到 resolve 一次性显示」）；
- 「acpx 引擎：流式增量同样逐块渲染，session id 落到 acpx 映射」。

两条均通过（21/21）。Rust 侧逐行 recv 时间戳由既有 `log("recv", ...)` 落盘，
真实链路 E2E（`real_acpx_chat_named_session_resume_round_trip`）已加逐块到达
时间输出。

## 对真机反馈的解释与待人工复验项

1. catnuko 反馈时（选择器提交前），运行中的应用实例大概率还是旧构建：
   观察到的是直连链路的「长等待 + 快速倾泻」形态，且深度思考未开启
   （直连会话日志全部 thinking=false）。
2. 待人工复验：重启 `pnpm tauri dev`（确保 Rust 重建）→ 切 acpx 引擎 →
   开深度思考 → 发消息。预期：先见思考块流入折叠块，正文随后逐块增长；
   首 token 前的 10–18 秒静默是模型网关延迟，属预期行为。
3. 若复验仍一次性出现，看 ~/Library/Logs/deer/claude-acp.log 的 [recv] 时间戳：
   Rust 层逐块到达而 UI 不动，才说明 Tauri 事件→webview 渲染环节有问题（本轮
   未发现该层异常的任何证据）。
