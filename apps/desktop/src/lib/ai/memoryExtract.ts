/**
 * 读书记忆提取（面板关闭时自动总结会话）：从当前 thread 的消息里
 * 归纳「讨论主题 / 用户偏好 / 进度上下文」三类条目写入 memoryStore。
 * 云链路走 runCloudOnce 一次性生成，本地 acpx 链路走一次性生成调用
 * （独立命名会话，不污染聊天会话）；任何失败静默跳过，不阻塞面板关闭。
 * 纯函数（prompt 组装、输出解析、超限合并）便于单测。
 */
import type { ChatMessage } from "@/lib/types";
import type { AiEngineMode } from "@/store/appSettings";
import {
  useMemoryStore,
  type MemoryEntry,
  type MemoryEntryType,
} from "@/store/memoryStore";
import { runCloudOnce } from "./cloudEngine";
import { acpxChat, acpxEnvCheck } from "./claudeBackend";

/** 每本书的记忆条数上限：超限时滚动合并/淘汰最旧，避免 memory.json 膨胀。 */
export const MEMORY_PER_BOOK_LIMIT = 20;
/** 单次提取最多产出几条。 */
export const EXTRACT_ENTRY_LIMIT = 5;
/** 单条记忆文本的字符上限。 */
export const MEMORY_CONTENT_CHAR_LIMIT = 200;
/** 转录里单条消息的字符上限。 */
const TRANSCRIPT_MESSAGE_CHAR_LIMIT = 400;
/** 整段对话转录的字符上限（保留最近的）。 */
const TRANSCRIPT_CHAR_LIMIT = 6000;

const ENTRY_TYPES: ReadonlySet<string> = new Set([
  "topic",
  "preference",
  "progress",
]);

/** 按码点截断（不切代理对），超长头部换成省略号保留尾部（新信息在后）。 */
function truncateTail(text: string, limit: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= limit) return chars.join("");
  return `…${chars.slice(-(limit - 1)).join("")}`;
}

/**
 * 组装记忆提取的 system 与 prompt：转录当前会话（用户/AI 逐行），
 * 要求模型只输出一个 JSON 数组（type + content），提炼三类记忆。
 * 会话里没有用户发言（空面板误关、纯空消息）时返回 null，不发起提取。
 */
export function buildMemoryExtractPrompt(
  messages: ChatMessage[],
  bookTitle: string,
): { system: string; prompt: string } | null {
  const lines: string[] = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    lines.push(
      `${message.role === "user" ? "用户" : "AI"}：${truncateTail(content, TRANSCRIPT_MESSAGE_CHAR_LIMIT)}`,
    );
  }
  // 没有用户发言就没有可记的内容：不发起提取。
  if (!messages.some((m) => m.role === "user" && m.content.trim().length > 0)) {
    return null;
  }
  // 超长只保留最近这段对话。
  let transcript = lines.join("\n");
  if (transcript.length > TRANSCRIPT_CHAR_LIMIT) {
    transcript = truncateTail(transcript, TRANSCRIPT_CHAR_LIMIT);
  }

  const system = [
    "你是读书记忆提取器：从读者与 AI 伴读的对话记录里，提炼跨会话值得记住的信息。",
    "只输出 JSON，不要回答对话内容本身，不要输出任何其他文字或代码块标记。",
  ].join("\n");

  const prompt = [
    `以下是读者阅读《${bookTitle}》时与 AI 伴读的一段对话记录。`,
    "请从中归纳最多 5 条读书记忆，分三类：",
    '- topic（讨论主题）：聊过的话题与结论；',
    "- preference（用户偏好）：读者表达过的阅读/回答偏好；",
    "- progress（进度上下文）：读到的位置、计划等进度信息。",
    "要求：只依据对话记录归纳，不要编造；每条 content 不超过 80 字，",
    "写成一两句能独立理解的话；没有值得记的就输出空数组 []。",
    "只输出一个 JSON 数组，不要输出任何其他文字或代码块标记，格式如下：",
    '[{"type":"topic","content":"……"},{"type":"preference","content":"……"},{"type":"progress","content":"……"}]',
    "",
    "对话记录：",
    "",
    transcript,
  ].join("\n");

  return { system, prompt };
}

/**
 * 解析模型输出的记忆条目 JSON，非法输入返回 null（调用方静默跳过）。
 * 容忍代码块围栏与 JSON 前后的闲话：取首个 [ 到最后一个 ] 之间再解析。
 * type 非法或 content 为空的条目丢弃，超长的 content 截断，最多取 5 条。
 */
export function parseMemoryEntries(
  raw: string,
): Array<{ type: MemoryEntryType; content: string }> | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const entries: Array<{ type: MemoryEntryType; content: string }> = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { type, content } = item as Record<string, unknown>;
    if (typeof type !== "string" || !ENTRY_TYPES.has(type)) continue;
    if (typeof content !== "string" || !content.trim()) continue;
    entries.push({
      type: type as MemoryEntryType,
      content: truncateTail(content, MEMORY_CONTENT_CHAR_LIMIT),
    });
    if (entries.length >= EXTRACT_ENTRY_LIMIT) break;
  }
  return entries.length > 0 ? entries : null;
}

/**
 * 每书条数上限的滚动合并：list 为该书全部条目（新写的在前）。
 * 超限时从最旧的一端开始：先找最旧的同类型两条合并成一条（保留较新那条的
 * id，内容拼接截断），整书类型互不相同时直接淘汰最旧一条。
 * 返回要更新的内容（updateEntry）与要删除的 id（deleteEntry）；
 * 已被后续合并/淘汰吞掉的更新会过滤掉。
 */
export function compactMemories(
  list: MemoryEntry[],
  limit: number = MEMORY_PER_BOOK_LIMIT,
): {
  updates: Array<{ id: string; content: string }>;
  deletions: string[];
} {
  const entries = list.map((e) => ({ id: e.id, type: e.type }));
  const contents = new Map(list.map((e) => [e.id, e.content]));
  const updates = new Map<string, string>();
  const deletions: string[] = [];

  while (entries.length > limit) {
    // 最旧在数组尾部：从尾往前找第一对同类型条目。
    let pair: [number, number] | null = null;
    outer: for (let older = entries.length - 1; older > 0; older--) {
      for (let newer = older - 1; newer >= 0; newer--) {
        if (entries[newer]!.type === entries[older]!.type) {
          pair = [older, newer];
          break outer;
        }
      }
    }
    if (pair) {
      const [olderIdx, newerIdx] = pair;
      const older = entries[olderIdx]!;
      const newer = entries[newerIdx]!;
      const merged = truncateTail(
        `${contents.get(older.id) ?? ""}；${contents.get(newer.id) ?? ""}`,
        MEMORY_CONTENT_CHAR_LIMIT,
      );
      contents.set(newer.id, merged);
      updates.set(newer.id, merged);
      deletions.push(older.id);
      entries.splice(olderIdx, 1);
    } else {
      deletions.push(entries.pop()!.id);
    }
  }

  const deleted = new Set(deletions);
  return {
    updates: [...updates]
      .filter(([id]) => !deleted.has(id))
      .map(([id, content]) => ({ id, content })),
    deletions,
  };
}

/**
 * 提取并写入一次会话记忆。按引擎路由：cloud 直接 runCloudOnce；
 * local/auto 本地环境可用时走 acpx 一次性生成（独立命名会话
 * memory-<threadId>，不污染聊天会话），仅本地但环境不可用时不回落云。
 * 任何失败静默返回 false，绝不抛出、不阻塞调用方（面板关闭）。
 */
export async function extractSessionMemories(opts: {
  bookId: string;
  bookTitle: string;
  threadId: string;
  messages: ChatMessage[];
  engineMode: AiEngineMode;
  /** 引擎环境自检结果（ChatPanel 已查过）；null 时现查一次。 */
  envOk: boolean | null;
}): Promise<boolean> {
  try {
    const built = buildMemoryExtractPrompt(opts.messages, opts.bookTitle);
    if (!built) return false;

    let raw: string;
    if (opts.engineMode === "cloud") {
      raw = await runCloudOnce(built);
    } else {
      const localOk = opts.envOk ?? (await acpxEnvCheck()).ok;
      if (localOk) {
        // 本地无独立 system 通道：指令并入 prompt。
        const result = await acpxChat({
          prompt: `${built.system}\n\n${built.prompt}`,
          messageId: `mem-extract-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          // 独立命名会话：提取不续接、也不污染该书的聊天会话。
          threadId: `memory-${opts.threadId}`,
          resumeSessionId: null,
          onDelta: () => {},
        });
        raw = result.text;
      } else {
        if (opts.engineMode === "local") return false;
        raw = await runCloudOnce(built);
      }
    }

    const parsed = parseMemoryEntries(raw);
    if (!parsed || parsed.length === 0) return false;

    const created = useMemoryStore.getState().upsertEntries(
      parsed.map((p) => ({
        bookId: opts.bookId,
        type: p.type,
        content: p.content,
        sourceThreadId: opts.threadId,
      })),
    );
    if (created.length === 0) return false;

    const { updates, deletions } = compactMemories(
      useMemoryStore.getState().listByBook(opts.bookId),
    );
    const store = useMemoryStore.getState();
    for (const update of updates) {
      store.updateEntry(update.id, { content: update.content });
    }
    for (const id of deletions) {
      store.deleteEntry(id);
    }
    return true;
  } catch (err) {
    console.warn("[memory] 会话记忆提取失败，已跳过", err);
    return false;
  }
}
