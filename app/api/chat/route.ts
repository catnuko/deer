import { type AIModelConfig } from '@/src/lib/ai-config';

export async function POST(req: Request) {
  try {
    const { config, messages, context } = await req.json() as {
      config: AIModelConfig;
      messages: Array<{ role: string; content: string }>;
      context?: string;
    };

    if (!config || !config.provider || !config.apiKey) {
      return new Response('Missing AI configuration', { status: 400 });
    }

    const baseUrl = config.baseUrl || getDefaultBaseUrl(config.provider);
    const modelName = config.modelName || getDefaultModel(config.provider);

    // Build messages with context if provided
    const systemMessage = context
      ? { role: 'system', content: `You are a helpful reading assistant. The user is reading the following content:\n\n${context}\n\nHelp them understand it better.` }
      : { role: 'system', content: 'You are a helpful reading assistant.' };

    const allMessages = [systemMessage, ...messages];

    let endpoint: string;
    let headers: Record<string, string>;
    let body: string;

    if (config.provider === 'anthropic') {
      endpoint = `${baseUrl}/v1/messages`;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model: modelName,
        messages: allMessages.filter((m) => m.role !== 'system'),
        system: systemMessage.content,
        max_tokens: 1024,
        stream: true,
      });
    } else {
      // openai, deepseek, custom all use OpenAI-compatible format
      endpoint = `${baseUrl}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      };
      body = JSON.stringify({
        model: modelName,
        messages: allMessages,
        max_tokens: 1024,
        stream: true,
      });
    }

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

function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'anthropic': return 'https://api.anthropic.com';
    case 'deepseek': return 'https://api.deepseek.com/v1';
    default: return 'https://api.openai.com/v1';
  }
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'openai': return 'gpt-4o';
    case 'anthropic': return 'claude-3-5-sonnet-20241022';
    case 'deepseek': return 'deepseek-chat';
    default: return 'gpt-4o';
  }
}
