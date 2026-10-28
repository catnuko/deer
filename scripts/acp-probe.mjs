// 最小 ACP JSON-RPC 客户端测试：initialize → session/new → session/prompt
// 用法: node acp-probe.mjs "你的问题"
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

const ADAPTER = path.resolve(
  import.meta.dirname,
  "../apps/desktop/node_modules/.bin/claude-code-acp",
);
const question = process.argv[2] ?? "回复两个字：收到";

const proc = spawn(ADAPTER, [], { stdio: ["pipe", "pipe", "pipe"] });
let nextId = 1;
const pending = new Map();

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  proc.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

const rl = createInterface({ input: proc.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error("[non-json]", line.slice(0, 200));
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method === "session/update") {
    const u = msg.params?.update ?? {};
    if (u.sessionUpdate === "agent_message_chunk") {
      process.stdout.write(u.content?.text ?? JSON.stringify(u.content));
    } else {
      console.error("\n[update]", u.sessionUpdate ?? JSON.stringify(u).slice(0, 300));
    }
  } else if (msg.method) {
    console.error("\n[req-from-agent]", msg.method);
  }
});

proc.stderr.on("data", (d) => console.error("[stderr]", d.toString().slice(0, 500)));
proc.on("exit", (code) => console.error(`\n[adapter exit ${code}]`));

try {
  const init = await send("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
  });
  console.error("[init ok] protocolVersion=", init.protocolVersion,
    "authMethods=", JSON.stringify(init.authMethods));

  const sess = await send("session/new", {
    cwd: import.meta.dirname,
    mcpServers: [],
  });
  console.error("\n[new session] sessionId=", sess.sessionId);

  console.error("\n--- agent 回复流 ---");
  const result = await send("session/prompt", {
    sessionId: sess.sessionId,
    prompt: [{ type: "text", text: question }],
  });
  console.error("\n--- prompt result ---");
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (e) {
  console.error("[FAIL]", e.message);
  process.exit(1);
}
