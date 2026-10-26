import { type ChatMessage, buildChatMessages, buildOutgoingRequest } from '@/src/lib/chat-context';
import { UPSTREAM_TIMEOUT_MS, parseChatRequest } from '@/src/lib/chat-request';

export async function POST(req: Request) {
  try {
    // S2: strictly validate the body before touching it. Rejection messages
    // are static and never echo request values, since config can carry
    // credentials; the body is never logged.
    const parsed = parseChatRequest(await req.json());
    if (!parsed.ok) {
      return new Response(parsed.message, { status: 400 });
    }
    const { config, messages, context, prompt, userInput, selectedText } = parsed.value;

    const history: ChatMessage[] = messages;
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
      selectedText,
    });
    const { endpoint, headers, body } = buildOutgoingRequest(config, assembled);

    // S3: bound the upstream call. A timeout aborts the fetch and surfaces as
    // a distinct 504 so the client streaming state can close cleanly.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
    // S3: a timeout must be distinguishable from other failures and must not
    // echo request data. The message text stays free of request values.
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new Response(JSON.stringify({ error: 'Upstream request timeout' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('AI chat error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
