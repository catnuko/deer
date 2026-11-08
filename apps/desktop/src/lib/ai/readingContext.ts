/**
 * 阅读上下文注入（N1）：把「正在读什么」压成一行，随每条用户消息发给 claude，
 * 让伴读助手知道书名、当前章节与阅读位置。
 * 纯函数，不触 React / store，便于表驱动单测。
 */

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
 * 云引擎每轮的 system：身份行 +（可选）上下文行 + 伴读职责约定。
 * 与 buildPrompt 的框架部分同源；用户输入不再并入，走独立消息。
 */
export function buildSystemPrompt(ctx?: ReadingContext | null): string {
  const title = ctx?.bookTitle.trim();
  const base = "你是 Deer 电子书阅读器的 AI 伴读助手，帮读者理解与讨论书的内容。回答基于工具取到的真实内容，拿不到就如实说明。";
  if (!title) return base;
  const identity = `你现在是《${title}》这本书的伴读助手。`;
  const context = contextLine({ ...ctx, bookTitle: title });
  return [base, identity, ...(context ? [context] : [])].join("\n");
}
