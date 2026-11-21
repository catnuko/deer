#!/usr/bin/env node
/* 用 CDP 驱动 headless Chrome 验证 deer 构建产物：三页可达、无 console error、chunk 按需加载。 */
const CDP_PORT = 9222;

async function newTab(url) {
  const res = await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  return res.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const ready = new Promise((r) => ws.addEventListener("open", r));
  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    events,
    close() { ws.close(); },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkPage(url, expectText) {
  const tab = await newTab("about:blank");
  const c = connect(tab.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Runtime.enable");
  await c.send("Page.enable");
  const errors = [];
  c.events.length = 0;
  await c.send("Page.navigate", { url });
  await sleep(2500);

  // console 错误收集
  for (const ev of c.events) {
    if (ev.method === "Runtime.exceptionThrown") {
      errors.push(ev.params.exceptionDetails?.exception?.description || ev.params.exceptionDetails?.text);
    }
    if (ev.method === "Runtime.consoleAPICalled" && ev.params.type === "error") {
      errors.push(ev.params.args?.map(a => a.value || a.description).join(" "));
    }
  }

  const { result: body } = await c.send("Runtime.evaluate", {
    expression: "document.body.innerText.slice(0, 800)",
    returnByValue: true,
  });
  const text = body.value || "";
  const ok = expectText.every((t) => text.includes(t));

  // 当前加载的 JS chunk
  const { result: chunks } = await c.send("Runtime.evaluate", {
    expression: "performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')||r.name.endsWith('.css')).map(r=>r.name.split('/').pop())",
    returnByValue: true,
  });

  console.log("=== " + url);
  console.log("文本断言:", ok ? "PASS" : "FAIL", JSON.stringify(expectText));
  if (!ok) console.log("实际文本:", JSON.stringify(text.slice(0, 400)));
  console.log("console/异常错误:", errors.length ? JSON.stringify(errors) : "无");
  console.log("已加载资源:", chunks.value.join(", "));
  await c.close();
  return { ok, errors };
}

(async () => {
  let allOk = true;
  // 1. 书架首屏
  const shelf = await checkPage("http://localhost:4173/bookshelf", ["书架"]);
  allOk &&= shelf.ok && shelf.errors.length === 0;
  // 2. 笔记页（懒加载路由）
  const notes = await checkPage("http://localhost:4173/notes", []);
  allOk &&= notes.errors.length === 0;
  // 3. 阅读页（懒加载路由，无书时应有空态/提示而非崩溃）
  const reader = await checkPage("http://localhost:4173/reader", []);
  allOk &&= reader.errors.length === 0;
  console.log(allOk ? "\nALL-PASS" : "\nHAS-FAIL");
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error("SCRIPT-ERROR", e); process.exit(2); });
