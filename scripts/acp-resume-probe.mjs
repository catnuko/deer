// 测试 session/load 续接会话：load 上一轮的 sessionId，再问一句验证上下文
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

const ADAPTER = path.resolve(import.meta.dirname, "../apps/desktop/node_modules/.bin/claude-code-acp");
const sessionId = process.argv[2];
const question = process.argv[3] ?? "我上一句让你回复了哪两个字？";

const proc = spawn(ADAPTER, [], { stdio: ["pipe", "pipe", "pipe"] });
let nextId = 1;
const pending = new Map();
function send(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
const rl = createInterface({ input: proc.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method === "session/update") {
    const u = msg.params?.update ?? {};
    if (u.sessionUpdate === "agent_message_chunk") process.stdout.write(u.content?.text ?? "");
    else console.error("[update]", u.sessionUpdate ?? "");
  }
});
proc.stderr.on("data", () => {});
proc.on("exit", (code) => console.error(`\n[adapter exit ${code}]`));

try {
  await send("initialize", { protocolVersion: 1, clientCapabilities: {} });
  console.error("[load] sessionId=", sessionId);
  const loaded = await send("session/load", { sessionId, cwd: import.meta.dirname, mcpServers: [] });
  console.error("[load ok]", JSON.stringify(loaded ?? {}));
  const result = await send("session/prompt", { sessionId, prompt: [{ type: "text", text: question }] });
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (e) {
  console.error("[FAIL]", e.message);
  process.exit(1);
}
