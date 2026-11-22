/**
 * 阅读上下文注入（N1）：把「正在读什么」压成一行，随每条用户消息发给 claude，
 * 让伴读助手知道书名、当前章节与阅读位置。
 * 记忆摘要注入：把 memoryStore 里该书的条目裁剪成一段摘要块，随 system /
 * prompt 注入，让新会话「接着上次聊」，并受 token 预算约束。
 * 纯函数，不触 React / store（MemoryEntry 只做类型引用），便于表驱动单测。
 */

import type { MemoryEntry, MemoryEntryType } from "@/store/memoryStore";

export type ReadingContext = {
  bookTitle: string;
  /** 当前章节标题（来自 foliate TOC）；拿不到时为 null。 */
  chapterTitle?: string | null;
  /** 全书阅读进度 0..1；拿不到时为 null。 */
  progress?: number | null;
};

function clampPercent(progress: number | null | undefined): number | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

/**
 * 上下文压缩成的一行；拼不出有效内容（只剩书名，与身份行重复）时返回 null。
 */
export function contextLine(ctx: ReadingContext): string | null {
  const title = ctx.bookTitle.trim();
  if (!title) return null;
  const segments: string[] = [`《${title}》`];
  const chapter = ctx.chapterTitle?.trim();
  if (chapter) segments.push(`当前章节：${chapter}`);
  const percent = clampPercent(ctx.progress);
  if (percent !== null) segments.push(`全书进度 ${percent}%`);
  if (segments.length === 1) return null;
  return `【阅读上下文】${segments.join(" · ")}`;
}

/**
 * 组装发给 claude 的完整 prompt：身份行 +（可选）上下文行 + 空行 + 用户输入。
 * 框架部分固定 2 行 + 1 空行，用户输入再长也不受这里影响（截断由调用方负责）。
 */
export function buildPrompt(
  question: string,
  ctx?: ReadingContext | null,
): string {
  const text = question.trim();
  if (!text) return "";
  const title = ctx?.bookTitle.trim();
  if (!title) return text;
  const identity = `你是《${title}》这本书的伴读助手。`;
  const context = contextLine({ ...ctx, bookTitle: title });
  return [identity, ...(context ? [context] : []), "", text].join("\n");
}

/**
 * 云引擎每轮的 system：身份行 +（可选）上下文行 +（可选）记忆摘要段 + 伴读职责约定。
 * 与 buildPrompt 的框架部分同源；用户输入不再并入，走独立消息。
 */
export function buildSystemPrompt(
  ctx?: ReadingContext | null,
  memory?: MemoryEntry[] | null,
): string {
  const title = ctx?.bookTitle.trim();
  const base = "你是 Deer 电子书阅读器的 AI 伴读助手，帮读者理解与讨论书的内容。回答基于工具取到的真实内容，拿不到就如实说明。";
  if (!title) return base;
  const identity = `你现在是《${title}》这本书的伴读助手。`;
  const context = contextLine({ ...ctx, bookTitle: title });
  const memoryBlock = memorySummaryBlock(memory ?? null);
  return [
    base,
    identity,
    ...(context ? [context] : []),
    ...(memoryBlock ? ["", memoryBlock] : []),
  ].join("\n");
}

/**
 * 记忆摘要块的字符预算（中文约 1 字 1 token 的保守代理）：
 * 控制注入上下文的规模，超预算按优先级裁剪。
 */
export const MEMORY_SUMMARY_CHAR_BUDGET = 1200;
/** 单条记忆在摘要里的字符上限（超长的记忆内容自身截断）。 */
const MEMORY_SUMMARY_LINE_LIMIT = 200;

/** 注入与设置页共用的记忆类型标签。 */
export const MEMORY_TYPE_LABELS: Record<MemoryEntryType, string> = {
  topic: "话题",
  preference: "偏好",
  progress: "进度",
};

/** 注入优先级：偏好（用户在意什么）> 进度（读到哪了）> 话题（聊过什么）。 */
const MEMORY_TYPE_PRIORITY: Record<MemoryEntryType, number> = {
  topic: 0,
  progress: 1,
  preference: 2,
};

/** 按码点截断（不切代理对），保留头部、超长尾部换省略号（记忆文本新信息在前）。 */
function truncateHead(text: string, limit: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= limit) return chars.join("");
  return `${chars.slice(0, limit - 1).join("")}…`;
}

/**
 * 把该书记忆条目组装成注入用的摘要块，空列表或全是空内容返回 null。
 * 排序：类型优先级高在前，同级按 updatedAt 新的在前；预算内贪心装入，
 * 装不下的整体丢弃（低优先级/更旧的先丢），单条超长按行上限截断。
 */
export function memorySummaryBlock(
  entries: MemoryEntry[] | null | undefined,
  budget: number = MEMORY_SUMMARY_CHAR_BUDGET,
): string | null {
  const usable = (entries ?? [])
    .filter((e) => e.content.trim().length > 0)
    .sort(
      (a, b) =>
        MEMORY_TYPE_PRIORITY[b.type] - MEMORY_TYPE_PRIORITY[a.type] ||
        b.updatedAt - a.updatedAt,
    );
  if (usable.length === 0) return null;

  const header = "【读书记忆】以下是此前会话中值得延续的信息，回答时自然衔接，不必复述：";
  let used = header.length;
  const lines: string[] = [];
  for (const entry of usable) {
    const line = `- ${MEMORY_TYPE_LABELS[entry.type]}：${truncateHead(
      entry.content,
      MEMORY_SUMMARY_LINE_LIMIT,
    )}`;
    // 单行就超预算的条目截断后仍要装入（保证至少有一条），其余装不下即停。
    if (lines.length > 0 && used + 1 + line.length > budget) break;
    used += (lines.length > 0 ? 1 : 0) + line.length;
    lines.push(line);
  }
  return [header, ...lines].join("\n");
}
