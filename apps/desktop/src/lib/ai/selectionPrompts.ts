/**
 * 划词即问（N4）：划选浮层的预设快捷问题。
 * 纯函数 + 表驱动，不触 React / DOM 事件，便于单测：每个预设 =
 * 菜单标签 + 指令，prompt 与气泡展示文本由 buildSelectionPrompt 统一拼装。
 * 引用块格式与 selectionDraft 的预填草稿保持一致（同一套选区语境）。
 */
import { SELECTION_MAX_CHARS } from "./selectionDraft";

/** 短选区（词/短语）与长选区（段落）的分界：不超过这么多码点按词/短语处理。 */
export const SELECTION_QUICK_SHORT_MAX = 24;

export type SelectionPreset = {
  id: "define" | "explain" | "translate" | "followup";
  /** 菜单里的按钮文字。 */
  label: string;
  /** 选区引用之后发给 AI 的指令。 */
  instruction: string;
};

const TRANSLATE: SelectionPreset = {
  id: "translate",
  label: "翻译",
  instruction: "把这段内容翻译成中文；若本身是中文，则翻译成英文。",
};

const FOLLOWUP: SelectionPreset = {
  id: "followup",
  label: "追问",
  instruction:
    "围绕这段内容，提出 2-3 个值得深入思考的问题，并逐个给出你的看法。",
};

const SHORT_PRESETS: SelectionPreset[] = [
  {
    id: "define",
    label: "释义",
    instruction:
      "解释这个词或短语在当前语境下的含义；若是外语，给出词性、常见义项和一个例句。",
  },
  TRANSLATE,
  FOLLOWUP,
];

const LONG_PRESETS: SelectionPreset[] = [
  {
    id: "explain",
    label: "这段什么意思",
    instruction: "用通俗的语言解释这段内容在讲什么，必要时补充背景知识。",
  },
  TRANSLATE,
  FOLLOWUP,
];

/**
 * 按选区长度取预设表：词/短语给「释义」，段落给「这段什么意思」；
 * 翻译与追问两档都有。纯空白选区返回空表（不渲染快捷行）。
 */
export function selectionPresetsFor(text: string): SelectionPreset[] {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) return [];
  return Array.from(compact).length <= SELECTION_QUICK_SHORT_MAX
    ? SHORT_PRESETS
    : LONG_PRESETS;
}

export type SelectionQuickAsk = {
  /** 直发给 AI 的完整 prompt（引用块 + 预设指令）。 */
  prompt: string;
  /** 消息气泡里的展示文本：「标签「选区预览」」。 */
  displayText: string;
};

/** 气泡展示文本里选区预览的长度上限（超出截断加省略号）。 */
const DISPLAY_PREVIEW_CHARS = 12;

/**
 * 拼装直发消息：引用块 + 预设指令。选区整理规则与 formatSelectionDraft
 * 一致（压空白、按码点截断到 limit）；纯空白选区返回 null（不发）。
 */
export function buildSelectionPrompt(
  preset: Pick<SelectionPreset, "label" | "instruction">,
  raw: string,
  limit: number = SELECTION_MAX_CHARS,
): SelectionQuickAsk | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const chars = Array.from(text);
  const truncated = chars.length > limit;
  const quote = truncated ? chars.slice(0, limit).join("") + "……" : text;
  const note = truncated ? `（选区过长，只带前 ${limit} 字）` : "";
  const preview =
    chars.length > DISPLAY_PREVIEW_CHARS
      ? chars.slice(0, DISPLAY_PREVIEW_CHARS).join("") + "……"
      : text;
  return {
    prompt: `我划选了这段：\n\n「${quote}」${note}\n\n${preset.instruction}`,
    displayText: `${preset.label}「${preview}」`,
  };
}
