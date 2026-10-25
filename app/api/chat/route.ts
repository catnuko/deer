import { type AIModelConfig } from '@/src/lib/ai-config';
import { type ChatMessage, buildChatMessages, buildOutgoingRequest } from '@/src/lib/chat-context';

export async function POST(req: Request) {
  try {
    const { config, messages, context, prompt, userInput } = await req.json() as {
      config: AIModelConfig;
      messages?: ChatMessage[];
      context?: string;
      /** Legacy single-turn field kept for backward compatibility. */
      prompt?: string;
      userInput?: string;
    };

    if (!config || !config.provider || !config.apiKey) {
      return new Response('Missing AI configuration', { status: 400 });
    }

    const history = Array.isArray(messages) ? messages : [];
    const currentInput = (userInput || prompt || '').trim();
    if (!currentInput && history.length === 0) {
      return new Response('Missing user input', { status: 400 });
    }

    // When only the full `messages` array is supplied, treat its last user
    // message as the current turn and the rest as history.
    const latestUserInput = currentInput
      || [...history].reverse().find((m) => m.role === 'user')?.content
      || '';
    const baseHistory = currentInput ? history : history.slice(0, -1);

    const assembled = buildChatMessages({
      history: baseHistory,
      userInput: latestUserInput,
      readingContent: context,
    });
    const { endpoint, headers, body } = buildOutgoingRequest(config, assembled);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(`API error: ${response.status} - ${errorText.slice(0, 200)}`, {
        status: response.status,
      });
    }

    // Stream the response
    const reader = response.body?.getReader();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  controller.close();
                  return;
                }

                try {
                  const parsed = JSON.parse(data);
                  let content = '';

                  if (config.provider === 'anthropic') {
                    // Anthropic streaming format
                    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                      content = parsed.delta.text;
                    }
                  } else {
                    // OpenAI-compatible streaming format
                    if (parsed.choices?.[0]?.delta?.content) {
                      content = parsed.choices[0].delta.content;
                    }
                  }

                  if (content) {
                    controller.enqueue(encoder.encode(content));
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('AI chat error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
