#!/usr/bin/env python3
"""时间戳实验：与 Deer Rust 侧同款 spawn 方式（stdout 管道、prompt 走 stdin），
逐行记录 acpx NDJSON 输出的到达时间，判断缓冲发生在哪一层。
用法: python3 timing_probe.py "<prompt>" [record]
"""
import json, subprocess, sys, time, os

prompt = sys.argv[1] if len(sys.argv) > 1 else "请用中文写一段约200字的关于秋天的短文。"
record = sys.argv[2] if len(sys.argv) > 2 else "deer-timing-probe"

t0 = time.monotonic()
p = subprocess.Popen(
    ["acpx", "--format", "json", "--json-strict", "--deny-all", "--timeout", "120",
     "claude", "-s", record, "-f", "-"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1,  # line buffered on our side
)
p.stdin.write(prompt + "\n")
p.stdin.close()

lines = []
for raw in p.stdout:
    ts = time.monotonic() - t0
    raw = raw.strip()
    if not raw:
        continue
    lines.append((ts, raw))
    # 打印到达时间与方法/类型摘要
    try:
        v = json.loads(raw)
        method = v.get("method") or ("resp:" + str(v.get("id")))
        upd = v.get("params", {}).get("update", {}).get("sessionUpdate")
        key = f"{method}" + (f"/{upd}" if upd else "")
    except Exception:
        key = "NON-JSON"
    print(f"{ts:8.3f}s  {key}")

p.wait()
print(f"--- exit={p.returncode} total={time.monotonic()-t0:.3f}s lines={len(lines)}")

# 分块间隔摘要
chunk_times = [ts for ts, raw in lines
               if '"agent_message_chunk"' in raw or '"agent_thought_chunk"' in raw]
if chunk_times:
    span = chunk_times[-1] - chunk_times[0]
    print(f"chunk lines={len(chunk_times)} first={chunk_times[0]:.3f}s last={chunk_times[-1]:.3f}s span={span:.3f}s")
else:
    print("no chunk lines")
