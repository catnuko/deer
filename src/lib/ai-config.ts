export type ModelProvider = 'openai' | 'anthropic' | 'deepseek' | 'custom';

export interface AIModelConfig {
  provider: ModelProvider;
  apiKey: string;
  baseUrl?: string;
  modelName?: string;
}

const CONFIG_KEY = 'deer-ai-config';

const PROVIDER_DEFAULTS: Record<ModelProvider, { baseUrl: string; modelName: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4o',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    modelName: 'claude-3-5-sonnet-20241022',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    modelName: 'deepseek-chat',
  },
  custom: {
    baseUrl: '',
    modelName: '',
  },
};

export function getStoredConfig(): AIModelConfig | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(CONFIG_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as AIModelConfig;
    if (!parsed.provider || !parsed.apiKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setStoredConfig(config: AIModelConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearStoredConfig(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CONFIG_KEY);
}

export function getDefaultConfig(provider: ModelProvider): AIModelConfig {
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    apiKey: '',
    baseUrl: defaults.baseUrl,
    modelName: defaults.modelName,
  };
}

export function validateBaseUrl(url: string): boolean {
  if (!url) return true; // optional for built-in providers
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function testConnection(config: AIModelConfig): Promise<{ success: boolean; message: string }> {
  if (!config.apiKey) {
    return { success: false, message: '请先输入 API Key' };
  }

  const baseUrl = config.baseUrl || PROVIDER_DEFAULTS[config.provider].baseUrl;
  const modelName = config.modelName || PROVIDER_DEFAULTS[config.provider].modelName;

  if (!baseUrl || !modelName) {
    return { success: false, message: '请填写完整的配置信息' };
  }

  try {
    let endpoint: string;
    let headers: Record<string, string>;
    let body: string;

    if (config.provider === 'openai' || config.provider === 'deepseek' || config.provider === 'custom') {
      endpoint = `${baseUrl}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      };
      body = JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      });
    } else if (config.provider === 'anthropic') {
      endpoint = `${baseUrl}/v1/messages`;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      });
    } else {
      return { success: false, message: '不支持的模型提供商' };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok || response.status === 200) {
      return { success: true, message: '连接成功！配置已验证。' };
    }

    const errorText = await response.text();
    if (response.status === 401 || response.status === 403) {
      return { success: false, message: 'API Key 无效或权限不足' };
    }
    if (response.status === 404) {
      return { success: false, message: '模型名称或 API 端点不正确' };
    }

    return { success: false, message: `连接失败 (${response.status}): ${errorText.slice(0, 100)}` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, message: '连接超时，请检查网络或 API 端点' };
    }
    return { success: false, message: `连接错误: ${error instanceof Error ? error.message : '未知错误'}` };
  }
}
