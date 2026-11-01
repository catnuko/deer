// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeChunkPayload } from "./claudeBackend";

// claudeBackend 动态 import 这两个模块，vi.mock 对动态 import 同样生效。
const invoke = vi.fn<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>();
let chunkHandler: ((event: { payload: ClaudeChunkPayload }) => void) | null =
  null;
const listen = vi.fn<
  (
    event: string,
    handler: (event: { payload: ClaudeChunkPayload }) => void,
  ) => Promise<() => void>
>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: Parameters<typeof invoke>) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: Parameters<typeof listen>) => listen(...args),
}));

const { claudeChat, acpxChat } = await import("./claudeBackend");

function emitChunk(payload: ClaudeChunkPayload) {
  chunkHandler?.({ payload });
}

type DiagArgs = { tag: string; msg: string };

function diagCalls(): DiagArgs[] {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === "diag_log")
    .map(([, args]) => args as DiagArgs);
}

// diagLog 是 fire-and-forget（动态 import 后才调 invoke），微任务轮询等它落账。
function eventually<T>(fn: () => T, timeout = 1000): Promise<T> {
  return vi.waitFor(fn, { timeout });
}

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ text: "", sessionId: "s-1" });
  listen.mockReset().mockImplementation(async (_event, handler) => {
    chunkHandler = handler;
    return () => {
      chunkHandler = null;
    };
  });
});

afterEach(() => {
  chunkHandler = null;
});

describe("claudeBackend 诊断埋点", () => {
  it("claudeChat 每个增量块打一行 fe-chunk，带引擎名、序号与 kind，开始/结束各一行", async () => {
    // chat invoke 挂起，等监听就绪后逐块喂事件
    let resolveChat: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === "claude_chat"
        ? new Promise((res) => {
            resolveChat = res;
          })
        : Promise.resolve(null),
    );

    const deltas: string[] = [];
    const p = claudeChat({
      prompt: "你好",
      messageId: "m-1",
      onDelta: (d) => deltas.push(d),
    });
    await eventually(() => expect(chunkHandler).not.toBeNull());

    emitChunk({ messageId: "m-1", delta: "春" });
    emitChunk({ messageId: "m-1", delta: "天" });
    emitChunk({ messageId: "m-1", kind: "thought", delta: "想" });
    // 其他消息的事件不计数
    emitChunk({ messageId: "other", delta: "z" });

    resolveChat({ text: "春天", sessionId: "s-1" });
    const result = await p;
    await eventually(() => expect(diagCalls().length).toBe(5));

    const diag = diagCalls();
    expect(diag[0].tag).toBe("fe-start");
    expect(diag[0].msg).toContain("engine=claude");
    expect(diag[0].msg).toContain("id=m-1");

    const chunks = diag.filter((d) => d.tag === "fe-chunk");
    expect(chunks).toHaveLength(3);
    expect(chunks[0].msg).toContain("seq=1");
    expect(chunks[0].msg).toContain("kind=message");
    expect(chunks[1].msg).toContain("seq=2");
    expect(chunks[2].msg).toContain("seq=3");
    expect(chunks[2].msg).toContain("kind=thought");

    const done = diag[diag.length - 1];
    expect(done.tag).toBe("fe-done");
    expect(done.msg).toContain("engine=claude");

    expect(deltas).toEqual(["春", "天"]);
    expect(result.sessionId).toBe("s-1");
  });

  it("acpxChat 埋点带 engine=acpx，块序号跨 kind 连续", async () => {
    let resolveChat: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === "acpx_chat"
        ? new Promise((res) => {
            resolveChat = res;
          })
        : Promise.resolve(null),
    );

    const p = acpxChat({
      prompt: "你好",
      messageId: "m-2",
      threadId: "t-1",
      onDelta: () => {},
    });
    await eventually(() => expect(chunkHandler).not.toBeNull());

    emitChunk({ messageId: "m-2", kind: "thought", delta: "a" });
    emitChunk({ messageId: "m-2", delta: "b" });

    resolveChat({ text: "b", sessionId: "s-1" });
    const result = await p;
    await eventually(() => expect(diagCalls().length).toBe(4));

    const diag = diagCalls();
    const chunks = diag.filter((d) => d.tag === "fe-chunk");
    expect(chunks).toHaveLength(2);
    for (const d of diag) expect(d.msg).toContain("engine=acpx");
    expect(chunks[0].msg).toContain("seq=1");
    expect(chunks[0].msg).toContain("kind=thought");
    expect(chunks[1].msg).toContain("seq=2");
    expect(chunks[1].msg).toContain("kind=message");
    expect(result.sessionId).toBe("s-1");
  });

  it("diag_log invoke 失败静默：埋点挂掉不影响增量路由", async () => {
    let resolveChat: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === "claude_chat"
        ? new Promise((res) => {
            resolveChat = res;
          })
        : Promise.reject(new Error("log sink gone")),
    );
    const deltas: string[] = [];
    const p = claudeChat({
      prompt: "你好",
      messageId: "m-3",
      onDelta: (d) => deltas.push(d),
    });
    await eventually(() => expect(chunkHandler).not.toBeNull());
    emitChunk({ messageId: "m-3", delta: "ok" });

    resolveChat({ text: "ok", sessionId: "s-1" });
    const result = await p;
    await eventually(() => expect(deltas).toEqual(["ok"]));

    expect(result.sessionId).toBe("s-1");
  });
});
