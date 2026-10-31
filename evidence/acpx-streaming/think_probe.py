import json, subprocess, sys, time

record = "deer-timing-probe"
env = dict(**{k: v for k, v in __import__('os').environ.items()}, MAX_THINKING_TOKENS="10000")
t0 = time.monotonic()
p = subprocess.Popen(
    ["acpx", "--format", "json", "--json-strict", "--deny-all", "--timeout", "180",
     "claude", "-s", record, "-f", "-"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1, env=env)
p.stdin.write("用中文简要解释一下什么是闭包，先想一想再回答。\n")
p.stdin.close()
thoughts, messages = [], []
for raw in p.stdout:
    ts = time.monotonic() - t0
    try:
        v = json.loads(raw)
    except Exception:
        continue
    upd = v.get("params", {}).get("update", {})
    kind = upd.get("sessionUpdate")
    if kind == "agent_thought_chunk":
        thoughts.append((ts, upd.get("content", {}).get("text", "")))
    elif kind == "agent_message_chunk":
        messages.append((ts, upd.get("content", {}).get("text", "")))
p.wait()
def summarize(name, xs):
    if not xs:
        print(f"{name}: 0 chunks")
        return
    span = xs[-1][0] - xs[0][0]
    text = "".join(x[1] for x in xs)
    print(f"{name}: {len(xs)} chunks first={xs[0][0]:.2f}s last={xs[-1][0]:.2f}s span={span:.2f}s chars={len(text)}")
    print(f"  head: {text[:120]!r}")
summarize("thought", thoughts)
summarize("message", messages)
if thoughts and messages:
    print(f"thought before message: {thoughts[0][0] < messages[0][0]}")
print(f"exit={p.returncode} total={time.monotonic()-t0:.2f}s")
