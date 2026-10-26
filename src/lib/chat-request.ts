import { type AIModelConfig, type ModelProvider } from './ai-config';
import { type ChatMessage } from './chat-context';

/**
 * Upstream provider requests must never hang: the route aborts them after
 * this budget and answers with a distinct 504 so the client can close its
 * streaming state cleanly.
 */
export const UPSTREAM_TIMEOUT_MS = 30000;

const KNOWN_PROVIDERS: readonly ModelProvider[] = ['openai', 'anthropic', 'deepseek', 'custom'];

export interface ParsedChatRequest {
  config: AIModelConfig;
  messages: ChatMessage[];
  userInput?: string;
  context?: string;
  selectedText?: string;
  /** Legacy single-turn field kept for backward compatibility. */
  prompt?: string;
}

export type ParsedChatResult =
  | { ok: true; value: ParsedChatRequest }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Strictly validate the /api/chat request body. Rejection messages are static
 * strings on purpose: they must never echo request values, because the config
 * can carry credentials.
 */
export function parseChatRequest(payload: unknown): ParsedChatResult {
  if (!isRecord(payload)) return { ok: false, message: 'Invalid request body' };

  const rawConfig = payload.config;
  if (!isRecord(rawConfig)) return { ok: false, message: 'Missing or invalid AI configuration' };

  const provider = rawConfig.provider;
  if (typeof provider !== 'string' || !KNOWN_PROVIDERS.includes(provider as ModelProvider)) {
    return { ok: false, message: 'Unsupported provider' };
  }

  const apiKey = rawConfig.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return { ok: false, message: 'Missing or invalid API key' };
  }

  const config: AIModelConfig = { provider: provider as ModelProvider, apiKey };
  const baseUrl = optionalString(rawConfig.baseUrl);
  if (rawConfig.baseUrl !== undefined && baseUrl === undefined) {
    return { ok: false, message: 'Invalid base URL field' };
  }
  if (baseUrl !== undefined) config.baseUrl = baseUrl;

  const modelName = optionalString(rawConfig.modelName);
  if (rawConfig.modelName !== undefined && modelName === undefined) {
    return { ok: false, message: 'Invalid model name field' };
  }
  if (modelName !== undefined) config.modelName = modelName;

  let messages: ChatMessage[] = [];
  if (payload.messages !== undefined) {
    if (!Array.isArray(payload.messages)) return { ok: false, message: 'Invalid messages field' };
    messages = [];
    for (const entry of payload.messages) {
      if (!isRecord(entry)) return { ok: false, message: 'Invalid message entry' };
      const role = entry.role;
      const content = entry.content;
      if (role !== 'user' && role !== 'assistant') return { ok: false, message: 'Invalid message role' };
      if (typeof content !== 'string') return { ok: false, message: 'Invalid message content' };
      messages.push({ role, content });
    }
  }

  const userInput = optionalString(payload.userInput);
  if (payload.userInput !== undefined && userInput === undefined) {
    return { ok: false, message: 'Invalid user input field' };
  }

  const prompt = optionalString(payload.prompt);
  if (payload.prompt !== undefined && prompt === undefined) {
    return { ok: false, message: 'Invalid prompt field' };
  }

  const context = optionalString(payload.context);
  if (payload.context !== undefined && context === undefined) {
    return { ok: false, message: 'Invalid context field' };
  }

  const selectedText = optionalString(payload.selectedText);
  if (payload.selectedText !== undefined && selectedText === undefined) {
    return { ok: false, message: 'Invalid selected text field' };
  }

  return {
    ok: true,
    value: { config, messages, userInput, context, selectedText, prompt },
  };
}
