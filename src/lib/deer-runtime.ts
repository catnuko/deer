'use client';

import { useEffect, useRef, useState } from 'react';
import { useChatRuntime, AssistantChatTransport } from '@assistant-ui/ai-sdk';
import type { UIMessage } from 'ai';
import { type AIModelConfig } from './ai-config';
import { CONTEXT_LIMITS } from './chat-context';
import type { StoredChatMessage } from './chat-storage';

export type { StoredChatMessage };

/** The prompt 「总结本章」 sends. Shared so the panel and tests agree on it. */
export const SUMMARIZE_CHAPTER_PROMPT = '请总结本章的主要内容（前500字）：';

/**
 * Build the per-request body the AI SDK transport forwards to `/api/ai-chat`.
 *
 * The AI SDK always sends the full message array under `messages`; Deer's extra
 * fields — the BYOK `config`, the reading `context`, and the current turn's
 * `selectedText` — travel alongside it. `selectedText` is a per-turn value, so
 * the body is a function re-evaluated on every send, reading the latest values
 * off the holder it was given.
 */
function createDeerTransport(
  getOptions: () => UseDeerRuntimeOptions,
): AssistantChatTransport<UIMessage> {
  return new AssistantChatTransport({
    api: '/api/ai-chat',
    body: () => {
      const options = getOptions();
      const config = options.config;
      // A request without a config must never leave the client; the runtime's
      // guarded send path checks the same condition before enabling input.
      if (!config) return { config: null };
      const readingContent = options.readingContent;
      const selectedText = options.getSelectedText();
      return {
        config,
        context:
          readingContent.length > CONTEXT_LIMITS.maxReadingChars
            ? readingContent.slice(0, CONTEXT_LIMITS.maxReadingChars)
            : readingContent,
        selectedText: selectedText && selectedText.length > 0 ? selectedText : undefined,
      };
    },
  });
}

export interface UseDeerRuntimeOptions {
  /** The model configuration read from storage; a request without it is refused. */
  config: AIModelConfig | null;
  /** The reading text, sent along as context for every turn. */
  readingContent: string;
  /** The conversation restored from storage for the open text. */
  initialMessages: readonly StoredChatMessage[];
  /**
   * The selection of the current turn, as an explicit protocol field. The panel
   * sets it before sending and clears it afterwards.
   */
  getSelectedText: () => string | undefined;
  /** Called once a reply has finished streaming, with the whole conversation. */
  onTurnComplete?: (messages: readonly StoredChatMessage[]) => void;
}

/** Turn Deer's stored conversation into the seed the AI SDK runtime mounts. */
export function toUIMessages(messages: readonly StoredChatMessage[]): UIMessage[] {
  return messages.map((message): UIMessage => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text', text: message.content }],
  }));
}

/** Turn Deer's stored conversation into the shape `thread.reset()` accepts. */
export function toThreadMessageLikes(
  messages: readonly StoredChatMessage[],
): { role: 'user' | 'assistant'; content: string }[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

/** Flatten a finished AI SDK conversation back into Deer's stored shape. */
export function fromUIMessages(messages: readonly UIMessage[]): StoredChatMessage[] {
  const stored: StoredChatMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = m.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('');
    if (content.trim().length === 0) continue;
    stored.push({ id: m.id, role: m.role, content });
  }
  return stored;
}

/**
 * The library-recommended assistant-ui runtime for Deer, backed by the AI SDK
 * v7 endpoint `/api/ai-chat`.
 *
 * The transport forwards Deer's BYOK `config`, reading `context` and the
 * current turn's `selectedText` on every request, so the backend reuses the
 * exact prompt assembly the legacy `/api/chat` route used. Multi-turn history,
 * streaming text, reasoning parts and source parts are all handled by the AI
 * SDK runtime and the `<Thread>` component — no hand-written streaming adapter.
 */
export function useDeerRuntime(options: UseDeerRuntimeOptions) {
  const { initialMessages } = options;

  // The transport and the runtime are built once — recreating them mid-stream
  // would drop the reply — yet each request must carry the *current* config,
  // reading context and selection. So the transport is handed a getter that
  // dereferences the latest options at send time, never during render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Built in an effect, not during render: the body builder reads the ref, and
  // reading a ref is only legal outside render.
  const [transport, setTransport] = useState<AssistantChatTransport<UIMessage>>();
  useEffect(() => {
    setTransport(createDeerTransport(() => optionsRef.current));
  }, []);

  return useChatRuntime({
    transport,
    messages: toUIMessages(initialMessages),
    onFinish: ({ messages, isAbort, isError }) => {
      if (isAbort || isError) return;
      const stored = fromUIMessages(messages);
      // Only a turn that produced text is a finished turn.
      const last = stored[stored.length - 1];
      if (last?.role === 'assistant' && last.content.trim().length > 0) {
        optionsRef.current.onTurnComplete?.(stored);
      }
    },
  });
}
