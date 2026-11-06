/**
 * 本地 Claude Code 后端（经 acpx 连接层）。
 * 仅在 Tauri 桌面端可用：Rust 侧 spawn acpx（关联本机 claude CLI），
 * stdio JSON-RPC，文本增量经 `claude://chunk` 事件实时推送。
 */

import type { ChatBookRef } from "@/lib/types";
import { useAppSettings } from "@/store/appSettings";

export const CLAUDE_CHUNK_EVENT = "claude://chunk";
/** 引擎安装进度：Rust 侧把 npm 安装输出逐行推到这个事件。 */
export const AI_INSTALL_LOG_EVENT = "ai://install-log";

export type AiInstallLogPayload = {
  /** npm 包名（引擎 id），用于路由到对应行的日志区。 */
  engineId: string;
  line: string;
  /** 安装结束帧：done=true 时 success 表示 npm 退出码是否为 0。 */
  done?: boolean;
  success?: boolean;
};

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
      `engine=acpx id=${messageId} seq=${++seq} kind=${event.payload.kind ?? "message"} len=${event.payload.delta.length}`,
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

/** acpx 连接层聊天：会话由 acpx 管理（命名会话 deer-<engine>-<threadId>），深度思考恒开。 */
export async function acpxChat(opts: {
  prompt: string;
  messageId: string;
  /** 前端聊天线程 id，Rust 侧据此映射 acpx 命名会话。 */
  threadId: string;
  /** 该线程上一轮的 ACP session id（NO_SESSION 恢复用）；为空则新建。 */
  resumeSessionId?: string | null;
  onDelta: (delta: string) => void;
  onThoughtDelta?: (delta: string) => void;
  /** 书架 MCP 工具返回的书单（Rust 侧从 tool 结果抽取），渲染成书卡。 */
  onBooks?: (books: ChatBookRef[]) => void;
}): Promise<ClaudeChatResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const unlisten = await listenChunks(opts.messageId, opts);
  void diagLog(
    "fe-start",
    `engine=acpx id=${opts.messageId} promptLen=${opts.prompt.length}`,
  );
  try {
    const result = await invoke<ClaudeChatResult>("acpx_chat", {
      prompt: opts.prompt,
      messageId: opts.messageId,
      threadId: opts.threadId,
      resumeSessionId: opts.resumeSessionId ?? null,
      // 发送那一刻的选中引擎：换引擎即换会话名，互不串上下文。
      engine: useAppSettings.getState().aiEngine,
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

/** 单个引擎的本机安装状态。 */
export type AiEngineStatus = {
  id: string;
  installed: boolean;
};

/** 探测全部引擎的本机可执行文件（PATH 探测，纯文件检查，毫秒级）。 */
export async function aiEngineStatus(): Promise<AiEngineStatus[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<AiEngineStatus[]>("ai_engine_status");
}

/** 全局安装一个 acpx 适配器包（Rust 侧白名单校验），输出经 ai://install-log 流回。 */
export async function aiEngineInstall(engineId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("ai_engine_install", { engineId });
}
