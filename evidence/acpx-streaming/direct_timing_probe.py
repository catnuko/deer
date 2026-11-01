#!/usr/bin/env python3
"""直连链路时间戳实验：与 claude_acp.rs 同款方式 spawn
@zed-industries/claude-code-acp 适配器（node 直接跑 dist/index.js，stdout 管道，
env 注入 CLAUDE_CODE_EXECUTABLE / CLAUDE_CODE_OAUTH_TOKEN），逐行记录
NDJSON 到达时间，与 acpx 探针（timing_probe.py）做同环境对照。
用法: python3 direct_timing_probe.py "<prompt>"
"""
import glob, json, os, subprocess, sys, time

prompt = sys.argv[1] if len(sys.argv) > 1 else "请用中文写一段约200字的关于秋天的短文。"
home = os.path.expanduser("~")


def find_node():
    for c in [f"{home}/.local/bin/node", f"{home}/.nvm/versions/node/current/bin/node",
              "/opt/homebrew/bin/node", "/usr/local/bin/node"]:
        if os.path.isfile(c):
            return c
    return "node"


def find_adapter():
    roots = [os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "desktop")]
    roots += glob.glob(f"{home}/Documents/projects/deer/apps/desktop")
    for r in roots:
        p = os.path.normpath(os.path.join(r, "node_modules/@zed-industries/claude-code-acp/dist/index.js"))
        if os.path.isfile(p):
            return p
    raise SystemExit("adapter entry not found")


def find_claude():
    for c in [f"{home}/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]:
        if os.path.isfile(c):
            return c
    path = subprocess.run(["which", "claude"], capture_output=True, text=True).stdout.strip()
    return path or None


env = dict(os.environ)
env["CLAUDE_CODE_EXECUTABLE"] = find_claude()
tok = os.path.isfile(f"{home}/.config/deer/claude-oauth-token")
if tok:
    env["CLAUDE_CODE_OAUTH_TOKEN"] = open(f"{home}/.config/deer/claude-oauth-token").read().strip()
print(f"node={find_node()}")
print(f"adapter={find_adapter()}")
print(f"claude={env.get('CLAUDE_CODE_EXECUTABLE')} oauth_token_file={tok}")

t0 = time.monotonic()
p = subprocess.Popen(
    [find_node(), find_adapter()],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1, env=env,
)

next_id = 1


def send(method, params):
    global next_id
    rid = next_id
    next_id += 1
    p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}) + "\n")
    p.stdin.flush()
    return rid


init_id = send("initialize", {"protocolVersion": 1, "clientCapabilities": {}})
results = {}  # id -> result

lines = []
sid = None
stage = "wait-init"
for raw in p.stdout:
    ts = time.monotonic() - t0
    raw = raw.strip()
    if not raw:
        continue
    lines.append((ts, raw))
    try:
        v = json.loads(raw)
    except Exception:
        print(f"{ts:8.3f}s  NON-JSON")
        continue
    if "id" in v and v.get("id") is not None and ("result" in v or "error" in v):
        rid = v["id"]
        results[rid] = v.get("result", v.get("error"))
        if rid == init_id:
            print(f"{ts:8.3f}s  <- initialize result (protocolVersion={results[rid].get('protocolVersion')})")
            sid_req = send("session/new", {"cwd": home, "mcpServers": []})
            stage = "wait-session"
        elif stage == "wait-session" and isinstance(results[rid], dict) and results[rid].get("sessionId"):
            sid = results[rid]["sessionId"]
            print(f"{ts:8.3f}s  <- session/new result sessionId={sid[:8]}…")
            send("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": prompt}]})
            stage = "wait-prompt"
        elif stage == "wait-prompt":
            print(f"{ts:8.3f}s  <- prompt result stopReason={results[rid].get('stopReason') if isinstance(results[rid], dict) else results[rid]}")
            break
    elif v.get("method") == "session/update":
        upd = v.get("params", {}).get("update", {})
        key = upd.get("sessionUpdate")
        if key in ("agent_message_chunk", "agent_thought_chunk"):
            print(f"{ts:8.3f}s  session/update/{key}")
        else:
            print(f"{ts:8.3f}s  session/update/{key}")
    else:
        m = v.get("method") or "resp"
        print(f"{ts:8.3f}s  {m}")

p.stdin.close()
p.wait(timeout=15)
print(f"--- exit={p.returncode} total={time.monotonic()-t0:.3f}s lines={len(lines)}")

chunk_times = [ts for ts, raw in lines
               if '"agent_message_chunk"' in raw or '"agent_thought_chunk"' in raw]
msg_times = [ts for ts, raw in lines if '"agent_message_chunk"' in raw]
th_times = [ts for ts, raw in lines if '"agent_thought_chunk"' in raw]
if msg_times:
    print(f"message chunks={len(msg_times)} first={msg_times[0]:.3f}s last={msg_times[-1]:.3f}s span={msg_times[-1]-msg_times[0]:.3f}s")
if th_times:
    print(f"thought chunks={len(th_times)} first={th_times[0]:.3f}s last={th_times[-1]:.3f}s span={th_times[-1]-th_times[0]:.3f}s")
if not chunk_times:
    print("no chunk lines")
