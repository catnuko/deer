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

const { acpxChat } = await import("./claudeBackend");

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
  it("acpxChat 每个增量块打一行 fe-chunk，带引擎名、序号与 kind，开始/结束各一行", async () => {
    // chat invoke 挂起，等监听就绪后逐块喂事件
    let resolveChat: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === "acpx_chat"
        ? new Promise((res) => {
            resolveChat = res;
          })
        : Promise.resolve(null),
    );

    const deltas: string[] = [];
    const p = acpxChat({
      prompt: "你好",
      messageId: "m-1",
      threadId: "t-1",
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
    expect(diag[0].msg).toContain("engine=acpx");
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
    expect(done.msg).toContain("engine=acpx");

    expect(deltas).toEqual(["春", "天"]);
    expect(result.sessionId).toBe("s-1");
  });

  it("acpxChat 调 acpx_chat 命令并回传线程 id，块序号跨 kind 连续", async () => {
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
      cmd === "acpx_chat"
        ? new Promise((res) => {
            resolveChat = res;
          })
        : Promise.reject(new Error("log sink gone")),
    );
    const deltas: string[] = [];
    const p = acpxChat({
      prompt: "你好",
      messageId: "m-3",
      threadId: "t-1",
      onDelta: (d) => deltas.push(d),
    });
    await eventually(() => expect(chunkHandler).not.toBeNull());
    emitChunk({ messageId: "m-3", delta: "ok" });

    resolveChat({ text: "ok", sessionId: "s-1" });
    const result = await p;
    await eventually(() => expect(deltas).toEqual(["ok"]));

    expect(result.sessionId).toBe("s-1");
  });

  it("dictionary/translation 增量按 kind 路由到对应回调，坏帧与 miss 丢弃", async () => {
    let resolveChat: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === "acpx_chat"
        ? new Promise((res) => {
            resolveChat = res;
          })
        : Promise.resolve(null),
    );

    const dictionaries: unknown[] = [];
    const translations: unknown[] = [];
    const deltas: string[] = [];
    const p = acpxChat({
      prompt: "你好",
      messageId: "m-4",
      threadId: "t-1",
      onDelta: (d) => deltas.push(d),
      onDictionary: (entry) => dictionaries.push(entry),
      onTranslation: (entry) => translations.push(entry),
    });
    await eventually(() => expect(chunkHandler).not.toBeNull());

    // 命中帧：Rust 侧的 deer 标记 payload（含 deer 字段不影响校验）
    emitChunk({
      messageId: "m-4",
      kind: "dictionary",
      delta: JSON.stringify({
        deer: "dictionary",
        found: true,
        word: "ephemeral",
        phonetic: "/ɪˈfem.ər.əl/",
        senses: [{ partOfSpeech: "adjective", definition: "lasting a very short time" }],
      }),
    });
    emitChunk({
      messageId: "m-4",
      kind: "translation",
      delta: JSON.stringify({
        deer: "translation",
        sourceText: "hello",
        translatedText: "你好",
        sourceLang: "en",
        targetLang: "zh-CN",
      }),
    });
    // miss（found:false）与空 senses 不产词典卡
    emitChunk({
      messageId: "m-4",
      kind: "dictionary",
      delta: JSON.stringify({ deer: "dictionary", found: false, word: "zzz" }),
    });
    emitChunk({
      messageId: "m-4",
      kind: "dictionary",
      delta: JSON.stringify({ deer: "dictionary", found: true, word: "w", senses: [] }),
    });
    // 译文为空不产翻译卡；坏 JSON 帧丢弃；未知 kind 落正文
    emitChunk({
      messageId: "m-4",
      kind: "translation",
      delta: JSON.stringify({ deer: "translation", sourceText: "a", translatedText: "" }),
    });
    emitChunk({ messageId: "m-4", kind: "dictionary", delta: "not json" });
    emitChunk({ messageId: "m-4", delta: "正文" });

    resolveChat({ text: "正文", sessionId: "s-1" });
    await p;
    await eventually(() => expect(deltas).toEqual(["正文"]));

    expect(dictionaries).toHaveLength(1);
    expect(dictionaries[0]).toMatchObject({ word: "ephemeral", found: true });
    expect(translations).toHaveLength(1);
    expect(translations[0]).toMatchObject({ sourceText: "hello", translatedText: "你好" });
  });
});
