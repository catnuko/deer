import { type AIModelConfig } from './ai-config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ConversationMessage = Omit<ChatMessage, 'role'> & { role: 'user' | 'assistant' };

/**
 * Conservative context budget: different providers have different context
 * windows, so we would rather carry less history than risk an upstream 4xx.
 */
export const CONTEXT_LIMITS = {
  maxHistoryMessages: 10,
  maxHistoryChars: 8000,
  maxReadingChars: 2000,
} as const;

export const SELECTED_TEXT_MARKER = '【选中文本】';

export const DEFAULT_SYSTEM_PROMPT = [
  '你是 Deer，一位温和的阅读伙伴，正在陪用户一起阅读同一篇文章。',
  '回答要求：',
  '1. 使用简体中文，语气温和、平实，像同伴聊天，避免说教和过度冗长的罗列。',
  '2. 结合会话历史理解用户的问题。用户常用「这段」「它」「第二个人」「刚才那段」「最后的结论」等指代或省略，',
  '   请根据会话历史中提到的内容、用户此前选中的文本和上一轮回答推断所指，直接作答，不要让用户重复粘贴原文。',
  '3. 当用户要求对比时，分别复述两处内容的关键措辞，再说明相同点与不同点。',
  '4. 回答只基于用户提供的文本与会话历史；文中无法推断的信息（例如作者身份）请如实说明「文中没有写明」，不要编造。',
  '5. 如果用户的问题指向不明且历史里没有可消解的线索，先用一句话确认所指，再给出你最有把握的回答。',
].join('\n');

export function formatSelectionPrompt(selectedText: string): string {
  return `请解释这段内容：\n\n"${selectedText}"`;
}

function truncateReading(content: string): string {
  return content.slice(0, CONTEXT_LIMITS.maxReadingChars);
}

export function buildSystemPrompt(readingContent?: string): string {
  const text = readingContent?.trim();
  if (!text) return DEFAULT_SYSTEM_PROMPT;
  return `${DEFAULT_SYSTEM_PROMPT}\n\n【当前阅读内容（节选）】\n${truncateReading(text)}`;
}

function sanitize(history: readonly ChatMessage[]): ConversationMessage[] {
  const kept: ConversationMessage[] = [];
  for (const m of history) {
    if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0) {
      kept.push({ role: m.role, content: m.content });
    }
  }
  return kept;
}

const MERGED_QUESTION_SEPARATOR = '\n\n';

/**
 * S6: dropping empty messages can leave two adjacent user turns (e.g. a
 * question, a lost empty placeholder, then the real follow-up). Merging them
 * into one user message keeps the user/assistant alternation valid — some
 * providers reject consecutive same-role messages — and the anchor-based
 * trimming below stays whole-turn. The merge never spans sessions because
 * sanitization always runs on one session's history.
 */
function mergeAdjacentUserMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const merged: ConversationMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (message.role === 'user' && previous && previous.role === 'user') {
      previous.content = `${previous.content}${MERGED_QUESTION_SEPARATOR}${message.content}`;
      continue;
    }
    merged.push({ ...message });
  }
  return merged;
}

function totalChars(list: readonly ChatMessage[]): number {
  return list.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * Group sanitized messages into user-anchored units: every unit starts with a
 * user message and carries its following assistant reply. A reply without a
 * preceding user message is dropped, so no unit can begin with an assistant.
 */
function toUserAnchoredUnits(messages: readonly ConversationMessage[]): ConversationMessage[][] {
  const units: ConversationMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      units.push([message]);
      continue;
    }
    const current = units[units.length - 1];
    if (!current) continue;
    current.push(message);
  }
  return units;
}

/**
 * Keep the most recent turns within both the message-count and character
 * budgets. Trimming works on whole user/assistant units and only ever emits
 * an assistant reply together with the user message it answers, so the
 * history never starts with an orphan assistant turn. When the newest unit
 * alone exceeds the budget it is kept in trimmed form instead of dropped.
 */
export function trimHistoryMessages(history: readonly ChatMessage[]): ConversationMessage[] {
  const units = toUserAnchoredUnits(mergeAdjacentUserMessages(sanitize(history)));
  const kept: ConversationMessage[][] = [];
  let messageCount = 0;
  let charCount = 0;

  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i];
    const unitChars = totalChars(unit);
    const fits = messageCount + unit.length <= CONTEXT_LIMITS.maxHistoryMessages
      && charCount + unitChars <= CONTEXT_LIMITS.maxHistoryChars;

    if (!fits) {
      if (kept.length === 0) return clampUnit(unit);
      break;
    }

    kept.unshift(unit);
    messageCount += unit.length;
    charCount += unitChars;
  }

  return kept.flat();
}

/**
 * Shrink an over-budget unit to the newest user message, so the history still
 * starts with a user message, and cap its content to the character budget.
 */
function clampUnit(unit: ConversationMessage[]): ConversationMessage[] {
  const anchor = unit[0];
  return [{ role: 'user', content: anchor.content.slice(0, CONTEXT_LIMITS.maxHistoryChars) }];
}

function looksLikeSelectionQuestion(userInput: string): boolean {
  return userInput.includes(SELECTED_TEXT_MARKER) || userInput.includes('请解释这段内容');
}

const SELECTION_PREFIX = '请解释这段内容：';

/**
 * Annotate the quoted selection inside an already built question, e.g.
 * `请解释这段内容：\n\n"…"` becomes
 * `请解释这段内容：\n\n【选中文本】\n"…"\n【选中文本结束】`.
 */
function annotateSelection(question: string): string {
  const index = question.indexOf(SELECTION_PREFIX);
  if (index === -1) return question;
  const head = question.slice(0, index + SELECTION_PREFIX.length);
  const quoted = question.slice(index + SELECTION_PREFIX.length).trim();
  return `${head}\n\n${SELECTED_TEXT_MARKER}\n${quoted}\n【选中文本结束】`;
}

const SELECTION_END_MARKER = '【选中文本结束】';

export interface BuildChatMessagesInput {
  history: readonly ChatMessage[];
  userInput: string;
  readingContent?: string;
  /**
   * S5: the selection protocol is an explicit field, not text sniffing. The
   * legacy prefix form (formatSelectionPrompt) stays recognized for old
   * callers, but new code must pass this field.
   */
  selectedText?: string;
}

/**
 * Assemble the outgoing `messages` array: system prompt, trimmed session
 * history, then the current turn. Selected text is annotated inside the
 * current user message so the model can tell quotes from instructions.
 */
export function buildChatMessages({ history, userInput, readingContent, selectedText }: BuildChatMessagesInput): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(readingContent) },
    ...trimHistoryMessages(history),
  ];

  const explicitSelection = typeof selectedText === 'string' && selectedText.length > 0;
  const legacySelection = looksLikeSelectionQuestion(userInput);
  const annotated = explicitSelection
    ? `${userInput}\n\n${SELECTED_TEXT_MARKER}\n"${selectedText}"\n${SELECTION_END_MARKER}`
    : legacySelection && !userInput.includes(SELECTION_END_MARKER)
      ? annotateSelection(userInput)
      : userInput;

  messages.push({ role: 'user', content: annotated });
  return messages;
}

export interface OutgoingRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: string;
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com/v1',
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  deepseek: 'deepseek-chat',
};

export function buildOutgoingRequest(config: AIModelConfig, messages: readonly ChatMessage[]): OutgoingRequest {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URLS[config.provider] || DEFAULT_BASE_URLS.openai;
  const modelName = config.modelName || DEFAULT_MODELS[config.provider] || DEFAULT_MODELS.openai;
  const systemContent = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const dialogue = messages.filter((m) => m.role !== 'system');

  if (config.provider === 'anthropic') {
    return {
      endpoint: `${baseUrl}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        system: systemContent || DEFAULT_SYSTEM_PROMPT,
        messages: dialogue,
        max_tokens: 1024,
        stream: true,
      }),
    };
  }

  return {
    endpoint: `${baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      max_tokens: 1024,
      stream: true,
    }),
  };
}
