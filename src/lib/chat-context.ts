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
  return history
    .filter((m): m is ConversationMessage =>
      (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Keep the most recent turns within both the message-count and character
 * budgets. The window never starts with an orphan assistant reply, so the
 * history stays a valid user/assistant alternation for every provider.
 */
export function trimHistoryMessages(history: readonly ChatMessage[]): ConversationMessage[] {
  const messages = sanitize(history);

  let start = Math.max(0, messages.length - CONTEXT_LIMITS.maxHistoryMessages);
  while (start < messages.length && messages[start].role !== 'user') start += 1;
  let window = messages.slice(start);

  const totalChars = (list: readonly ChatMessage[]) =>
    list.reduce((sum, m) => sum + m.content.length, 0);

  while (window.length > 1 && totalChars(window) > CONTEXT_LIMITS.maxHistoryChars) {
    window = window.slice(1);
    if (window.length > 1 && window[0].role !== 'user') window = window.slice(1);
  }

  return window;
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
}

/**
 * Assemble the outgoing `messages` array: system prompt, trimmed session
 * history, then the current turn. Selected text is annotated inside the
 * current user message so the model can tell quotes from instructions.
 */
export function buildChatMessages({ history, userInput, readingContent }: BuildChatMessagesInput): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(readingContent) },
    ...trimHistoryMessages(history),
  ];

  const annotated = looksLikeSelectionQuestion(userInput) && !userInput.includes(SELECTION_END_MARKER)
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
