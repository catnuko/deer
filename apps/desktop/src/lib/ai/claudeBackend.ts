/**
 * 本地 Claude Code 后端（经 ACP 适配器）。
 * 仅在 Tauri 桌面端可用：Rust 侧 spawn @zed-industries/claude-code-acp，
 * stdio JSON-RPC，文本增量经 `claude://chunk` 事件实时推送。
 */

import type { ChatBookRef } from "@/lib/types";

export const CLAUDE_CHUNK_EVENT = "claude://chunk";

export type ClaudeChunkPayload = {
  messageId: string;
  /** "message" = 正文增量，"thought" = 深度思考增量，"books" = 书架工具返回的完整书单（JSON 数组文本）。 */
  kind?: string;
  delta: string;
};

export type ClaudeChatResult = {
  /** 助手完整回复（Rust 侧累计增量所得）。 */
  text: string;
  /** ACP session id，同书追问时回传以续接上下文。 */
  sessionId: string;
};

/** 聊天后端（harness）：claude = 内置直连，acpx = acpx 连接层。 */
export type ChatHarness = "claude" | "acpx";

/** acpx 环境自检结果（Node ≥22.13、acpx@0.21.x 已装）。 */
export type AcpxEnvStatus = {
  ok: boolean;
  nodeOk: boolean;
  nodeVersion: string | null;
  acpxVersion: string | null;
  message: string;
};

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as object)
  );
}

/** core 模块缓存：流式下每个 chunk 都要发埋点，不能每次都走一遍动态 import。 */
let coreMod: Promise<typeof import("@tauri-apps/api/core")> | null = null;

/**
 * 诊断埋点（旁路）：把前端收到流式增量的到达时间写进
 * ~/Library/Logs/deer/claude-acp.log（与 Rust 侧同一份日志），fire-and-forget，
 * 任何失败静默——埋点绝不能反过来影响聊天链路。
 */
async function diagLog(tag: string, msg: string): Promise<void> {
  try {
    coreMod ??= import("@tauri-apps/api/core");
    const { invoke } = await coreMod;
    await invoke("diag_log", { tag, msg });
  } catch {
    // 旁路日志，失败静默
  }
}

/** 监听流式增量事件并按 messageId 路由到正文/思考/书卡回调，返回解绑函数。 */
async function listenChunks(
  messageId: string,
  engine: ChatHarness,
  opts: {
    onDelta: (delta: string) => void;
    onThoughtDelta?: (delta: string) => void;
    onBooks?: (books: ChatBookRef[]) => void;
  },
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  let seq = 0;
  return await listen<ClaudeChunkPayload>(CLAUDE_CHUNK_EVENT, (event) => {
    if (event.payload.messageId !== messageId) return;
    void diagLog(
      "fe-chunk",
      `engine=${engine} id=${messageId} seq=${++seq} kind=${event.payload.kind ?? "message"} len=${event.payload.delta.length}`,
    );
    if (event.payload.kind === "thought") {
      opts.onThoughtDelta?.(event.payload.delta);
    } else if (event.payload.kind === "books") {
      try {
        const books = JSON.parse(event.payload.delta) as ChatBookRef[];
        if (Array.isArray(books) && books.length > 0) opts.onBooks?.(books);
      } catch {
        // 坏帧丢弃：书卡是锦上添花，不影响正文
      }
    } else {
      opts.onDelta(event.payload.delta);
    }
  });
}

export async function claudeChat(opts: {
  prompt: string;
  /** 前端生成的助手消息 id，事件按它路由增量。 */
  messageId: string;
  /** 该书上一轮的 ACP session id；为空则开新会话。 */
  resumeSessionId?: string | null;
  /** 深度思考：后端注入 MAX_THINKING_TOKENS，回复先流思考再流正文。 */
  deepThinking?: boolean;
  onDelta: (delta: string) => void;
  /** 深度思考增量（kind=thought）；不传则丢弃。 */
  onThoughtDelta?: (delta: string) => void;
}): Promise<ClaudeChatResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const unlisten = await listenChunks(opts.messageId, "claude", opts);
  void diagLog(
    "fe-start",
    `engine=claude id=${opts.messageId} thinking=${opts.deepThinking ?? false} promptLen=${opts.prompt.length}`,
  );
  try {
    const result = await invoke<ClaudeChatResult>("claude_chat", {
      prompt: opts.prompt,
      messageId: opts.messageId,
      resumeSessionId: opts.resumeSessionId ?? null,
      deepThinking: opts.deepThinking ?? false,
    });
    void diagLog(
      "fe-done",
      `engine=claude id=${opts.messageId} textLen=${result.text.length}`,
    );
    return result;
  } finally {
    unlisten();
  }
}

/** acpx 连接层聊天：会话由 acpx 管理（命名会话 deer-<threadId>），事件与直连同构。 */
export async function acpxChat(opts: {
  prompt: string;
  messageId: string;
  /** 前端聊天线程 id，Rust 侧据此映射 acpx 命名会话。 */
  threadId: string;
  /** 该线程上一轮的 ACP session id（NO_SESSION 恢复用）；为空则新建。 */
  resumeSessionId?: string | null;
  deepThinking?: boolean;
  onDelta: (delta: string) => void;
  onThoughtDelta?: (delta: string) => void;
  /** 书架 MCP 工具返回的书单（Rust 侧从 tool 结果抽取），渲染成书卡。 */
  onBooks?: (books: ChatBookRef[]) => void;
}): Promise<ClaudeChatResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const unlisten = await listenChunks(opts.messageId, "acpx", opts);
  void diagLog(
    "fe-start",
    `engine=acpx id=${opts.messageId} thinking=${opts.deepThinking ?? false} promptLen=${opts.prompt.length}`,
  );
  try {
    const result = await invoke<ClaudeChatResult>("acpx_chat", {
      prompt: opts.prompt,
      messageId: opts.messageId,
      threadId: opts.threadId,
      resumeSessionId: opts.resumeSessionId ?? null,
      deepThinking: opts.deepThinking ?? false,
    });
    void diagLog(
      "fe-done",
      `engine=acpx id=${opts.messageId} textLen=${result.text.length}`,
    );
    return result;
  } finally {
    unlisten();
  }
}

/** acpx 环境自检：Node 版本、acpx 安装与版本锁定线。 */
export async function acpxEnvCheck(): Promise<AcpxEnvStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<AcpxEnvStatus>("acpx_env_check");
}
