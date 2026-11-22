/**
 * 云引擎 agent 循环：AI SDK streamText + 工具多步，跑在 webview 内，
 * 桌面 / Android / iOS 三端通用。会话无服务端：每轮发该 thread 历史
 * （超长截最近 N 条），上下文注入沿用 readingContext 的 system 组装。
 */

import type { ModelMessage } from "ai";
import type {
  ChatBookRef,
  ChatDictionaryEntry,
  ChatMessage,
  ChatTranslationEntry,
} from "@/lib/types";
import { useAppSettings } from "@/store/appSettings";

// AI SDK（@ai-sdk/* + "ai"）与 deerTools 都只在真正发起云请求时动态加载，
// 不进首屏主包；模块级缓存让流式多轮对话不重复加载。
let cloudRuntimeMod: Promise<
  typeof import("./cloudRuntime")
> | null = null;
function loadCloudRuntime() {
  cloudRuntimeMod ??= import("./cloudRuntime");
  return cloudRuntimeMod;
}

/** agent 单轮最多步数（防工具循环失控）。 */
export const MAX_AGENT_STEPS = 8;
/** 每轮随发的历史消息上限（含本轮提问），超长丢最旧的。 */
export const HISTORY_MESSAGE_LIMIT = 40;

/** 书单类工具：结果渲染成聊天书卡。 */
const BOOK_LIST_TOOLS = new Set([
  "search_books",
  "get_library",
  "get_reading_state",
]);

/** 词典工具：结果渲染成聊天词典卡（found:false 不走卡片链路）。 */
const DICTIONARY_TOOLS = new Set(["lookup_dictionary"]);

/** 翻译工具：结果渲染成聊天翻译卡（空文本等错误提示不走卡片链路）。 */
const TRANSLATION_TOOLS = new Set(["translate_text"]);

/** thread 历史截最近 N 条。 */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-HISTORY_MESSAGE_LIMIT);
}

/** Deer 聊天记录 → AI SDK 消息：只取正文（思考块/书卡是展示层，不回发）。 */
export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export type CloudChatCallbacks = {
  onDelta(delta: string): void;
  /** 模型返回思考过程时才有增量；不返回就没有，不强求。 */
  onThoughtDelta?(delta: string): void;
  /** 书单类工具结果转书卡（按书 id 去重由 chatStore 负责）。 */
  onBooks?(books: ChatBookRef[]): void;
  /** 词典工具结果转词典卡（found:true 才回调，chatStore 取最后一次）。 */
  onDictionary?(entry: ChatDictionaryEntry): void;
  /** 翻译工具结果转翻译卡（校验通过才回调，chatStore 取最后一次）。 */
  onTranslation?(entry: ChatTranslationEntry): void;
};

/** 设置 store 的云引擎字段 → createCloudModel 的配置形态。 */
function currentConfig() {
  const { aiProvider, aiBaseUrl, aiModel, aiApiKey } =
    useAppSettings.getState();
  return {
    provider: aiProvider,
    baseUrl: aiBaseUrl,
    model: aiModel,
    apiKey: aiApiKey,
  };
}

export class CloudEngineError extends Error {}

/** 云引擎配置不完整（缺 API Key）时抛出，调用方据此给设置页指引。 */
export function assertCloudConfigured(): void {
  if (!useAppSettings.getState().aiApiKey.trim()) {
    throw new CloudEngineError(
      "云引擎未配置：请在 设置 → AI 伴读 填写 API Key 后重试。",
    );
  }
}

/** 判断工具结果是否是书卡数组（防模型侧意外形态，坏帧丢弃）。 */
function asBookRefs(output: unknown): ChatBookRef[] | null {
  if (!Array.isArray(output)) return null;
  const refs: ChatBookRef[] = [];
  for (const item of output) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as ChatBookRef).id === "string" &&
      typeof (item as ChatBookRef).title === "string"
    ) {
      refs.push(item as ChatBookRef);
    }
  }
  return refs.length > 0 ? refs : null;
}

/**
 * 判断工具结果是否是词典卡数据（防模型侧意外形态，坏帧丢弃）。
 * found:false 按约定不走卡片链路，返回 null。
 */
export function asDictionaryEntry(output: unknown): ChatDictionaryEntry | null {
  if (!output || typeof output !== "object") return null;
  const entry = output as Partial<ChatDictionaryEntry>;
  if (
    entry.found !== true ||
    typeof entry.word !== "string" ||
    !entry.word.trim() ||
    !Array.isArray(entry.senses) ||
    !entry.senses.length
  ) {
    return null;
  }
  return output as ChatDictionaryEntry;
}

/**
 * 判断工具结果是否是翻译卡数据（防模型侧意外形态，坏帧丢弃）。
 * 原文/译文任一为空即视为无效；sourceLang/targetLang 缺省由卡片降级。
 */
export function asTranslationEntry(
  output: unknown,
): ChatTranslationEntry | null {
  if (!output || typeof output !== "object") return null;
  const entry = output as Partial<ChatTranslationEntry>;
  if (
    typeof entry.sourceText !== "string" ||
    !entry.sourceText.trim() ||
    typeof entry.translatedText !== "string" ||
    !entry.translatedText.trim()
  ) {
    return null;
  }
  return output as ChatTranslationEntry;
}

/**
 * 一轮云引擎对话：streamText + Deer 工具多步循环，流式回调与
 * 原 acpxChat 同构（onDelta / onThoughtDelta / onBooks），返回完整正文。
 */
export async function runCloudChat(opts: {
  system: string;
  prompt: string;
  /** 该 thread 的既有历史（不含本轮提问）。 */
  history: ChatMessage[];
  callbacks: CloudChatCallbacks;
}): Promise<{ text: string }> {
  assertCloudConfigured();

  const { buildCloudAgent } = await loadCloudRuntime();
  const result = buildCloudAgent({
    model: await currentModel(),
    system: opts.system,
    messages: [
      ...toModelMessages(trimHistory(opts.history)),
      { role: "user", content: opts.prompt },
    ],
  });

  let text = "";
  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        text += part.text;
        opts.callbacks.onDelta(part.text);
        break;
      case "reasoning-delta":
        opts.callbacks.onThoughtDelta?.(part.text);
        break;
      case "tool-result": {
        if (BOOK_LIST_TOOLS.has(part.toolName)) {
          const books = asBookRefs(part.output);
          if (books) opts.callbacks.onBooks?.(books);
        } else if (DICTIONARY_TOOLS.has(part.toolName)) {
          const entry = asDictionaryEntry(part.output);
          if (entry) opts.callbacks.onDictionary?.(entry);
        } else if (TRANSLATION_TOOLS.has(part.toolName)) {
          const entry = asTranslationEntry(part.output);
          if (entry) opts.callbacks.onTranslation?.(entry);
        }
        break;
      }
      case "error":
        throw new CloudEngineError(
          part.error instanceof Error ? part.error.message : String(part.error),
        );
      default:
        break;
    }
  }
  return { text };
}

/**
 * 一次性生成（无工具、无历史）：概念地图等独立功能用。
 * system 与 prompt 都由调用方组装。
 */
export async function runCloudOnce(opts: {
  system: string;
  prompt: string;
}): Promise<string> {
  assertCloudConfigured();

  const { generateOnce } = await loadCloudRuntime();
  const result = await generateOnce({
    model: await currentModel(),
    system: opts.system,
    prompt: opts.prompt,
  });
  return result.text;
}

/** 由设置构造语言模型；配置不完整抛出统一错误（调用方已先 assertCloudConfigured）。 */
async function currentModel() {
  const { createCloudModel } = await import("./cloudProvider");
  const model = createCloudModel(currentConfig());
  if (!model) {
    throw new CloudEngineError(
      "云引擎未配置：请在 设置 → AI 伴读 填写 API Key 后重试。",
    );
  }
  return model;
}
