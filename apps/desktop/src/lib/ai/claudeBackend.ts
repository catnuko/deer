/**
 * 本地 Claude Code 后端（经 ACP 适配器）。
 * 仅在 Tauri 桌面端可用：Rust 侧 spawn @zed-industries/claude-code-acp，
 * stdio JSON-RPC，文本增量经 `claude://chunk` 事件实时推送。
 */

export const CLAUDE_CHUNK_EVENT = "claude://chunk";

export type ClaudeChunkPayload = {
  messageId: string;
  delta: string;
};

export type ClaudeChatResult = {
  /** 助手完整回复（Rust 侧累计增量所得）。 */
  text: string;
  /** ACP session id，同书追问时回传以续接上下文。 */
  sessionId: string;
};

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as object)
  );
}

export async function claudeChat(opts: {
  prompt: string;
  /** 前端生成的助手消息 id，事件按它路由增量。 */
  messageId: string;
  /** 该书上一轮的 ACP session id；为空则开新会话。 */
  resumeSessionId?: string | null;
  onDelta: (delta: string) => void;
}): Promise<ClaudeChatResult> {
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");

  const unlisten = await listen<ClaudeChunkPayload>(
    CLAUDE_CHUNK_EVENT,
    (event) => {
      if (event.payload.messageId === opts.messageId) {
        opts.onDelta(event.payload.delta);
      }
    },
  );
  try {
    return await invoke<ClaudeChatResult>("claude_chat", {
      prompt: opts.prompt,
      messageId: opts.messageId,
      resumeSessionId: opts.resumeSessionId ?? null,
    });
  } finally {
    unlisten();
  }
}
