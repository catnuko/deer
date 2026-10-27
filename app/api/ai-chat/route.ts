import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import { buildChatMessages, type ChatMessage } from '@/src/lib/chat-context';
import { parseChatRequest } from '@/src/lib/chat-request';
import type { AIModelConfig } from '@/src/lib/ai-config';

export const maxDuration = 30;

/**
 * Deer's BYOK proxy: the user's provider/baseUrl/apiKey arrive in the request
 * body, not a server secret. We build the model client for each call and point
 * it at the user-supplied baseUrl, so no third-party key lives on the server.
 */
function resolveModel(config: AIModelConfig): LanguageModel {
  const modelId = config.modelName && config.modelName.length > 0 ? config.modelName : undefined;

  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl }).languageModel(
        modelId ?? 'claude-3-5-sonnet-20241022',
      );
    case 'deepseek':
    case 'openai':
    case 'custom':
    default:
      // `.chat()` targets `/chat/completions`, which is what every
      // OpenAI-compatible endpoint (DeepSeek, self-hosted gateways) actually
      // implements. `.languageModel()` maps to the newer `/responses` API and
      // would 404 there.
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl }).chat(
        modelId ?? 'gpt-4o',
      );
  }
}

/** The plain text of a UI message: every text part, in order. */
function uiMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

/**
 * The AI SDK sends `messages` as `UIMessage[]` (parts, not plain content).
 * Flatten each to `{role, content}` so the request can be validated and
 * assembled by the same code the legacy route uses.
 */
function flattenMessages(messages: readonly UIMessage[]): ChatMessage[] {
  const flattened: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = uiMessageText(message);
    if (content.trim().length === 0) continue;
    flattened.push({ role: message.role, content });
  }
  return flattened;
}

/**
 * AI SDK v7 counterpart to `app/api/chat/route.ts`. Both routes share Deer's
 * prompt assembly (`buildChatMessages`), so the system prompt, context budget and
 * selected-text annotation stay identical; this one speaks the AI SDK UI message
 * stream that `useChatRuntime` consumes, instead of raw text. The legacy
 * `/api/chat` contract is left untouched and its tests keep passing.
 */
export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as Record<string, unknown>;
    const rawMessages = Array.isArray(payload.messages) ? (payload.messages as UIMessage[]) : [];

    // Re-shape the AI SDK body into the Deer request the validator expects: the
    // last user message is the current turn, the rest is history. This reuses
    // every check `parseChatRequest` already performs, including the rule that
    // rejection messages never echo request values.
    const parsed = parseChatRequest({
      config: payload.config,
      messages: flattenMessages(rawMessages),
      context: payload.context,
      selectedText: payload.selectedText,
    });
    if (!parsed.ok) {
      return new Response(parsed.message, { status: 400 });
    }
    const { config, messages, context, selectedText } = parsed.value;

    const history: ChatMessage[] = messages;
    if (history.length === 0) {
      return new Response('Missing user input', { status: 400 });
    }

    const latestUserInput =
      [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (latestUserInput.trim().length === 0) {
      return new Response('Missing user input', { status: 400 });
    }
    const baseHistory = history.slice(0, -1);

    const assembled = buildChatMessages({
      history: baseHistory,
      userInput: latestUserInput,
      readingContent: context,
      selectedText,
    });

    // AI SDK v7 refuses system messages inside `messages`; the system prompt
    // Deer assembles must travel through the dedicated `system` option instead.
    const systemPrompt = assembled
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const conversation = assembled.filter((m) => m.role !== 'system');

    const uiMessages: UIMessage[] = conversation.map((m, i) => ({
      id: `seed-${i}`,
      role: m.role as 'user' | 'assistant',
      parts: [{ type: 'text', text: m.content }],
    }));

    // `convertToModelMessages` ignores the id; strip it so the parameter type
    // matches the `Omit<UIMessage, 'id'>` shape it accepts.
    const modelMessages = await convertToModelMessages(
      uiMessages.map((message) => ({ role: message.role, parts: message.parts })),
    );

    const result = streamText({
      model: resolveModel(config),
      system: systemPrompt.length > 0 ? systemPrompt : undefined,
      messages: modelMessages as ModelMessage[],
      maxOutputTokens: 1024,
      abortSignal: req.signal,
      onError: (error) => {
        console.error('AI chat stream error:', error);
      },
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      sendSources: true,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new Response(JSON.stringify({ error: 'Upstream request timeout' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('AI chat error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
