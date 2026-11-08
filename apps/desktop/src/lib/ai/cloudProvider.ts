/**
 * 云引擎 provider 层：把设置页的 provider 配置变成 AI SDK 的语言模型，
 * 并提供「连接测试」的最小请求。key 只在内存/持久化里流转，绝不落日志。
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";

export const AI_PROVIDER_KINDS = ["openai-compatible", "anthropic"] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** 默认走 OpenAI 兼容接口 + 智谱端点（catnuko 现成 GLM key）。 */
export const DEFAULT_AI_PROVIDER: AiProviderKind = "openai-compatible";
export const DEFAULT_AI_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
export const DEFAULT_AI_MODEL = "glm-4.6";

/** 连接测试用的最小提问；回复内容无所谓，能通即可。 */
const TEST_PROMPT = "ping";

export function isAiProviderKind(value: string): value is AiProviderKind {
  return (AI_PROVIDER_KINDS as readonly string[]).includes(value);
}

/** 把配置规整成可用形态：缺 key/模型视为不可用。 */
export function normalizeCloudConfig(config: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}): {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
} {
  return {
    provider: isAiProviderKind(config.provider)
      ? config.provider
      : DEFAULT_AI_PROVIDER,
    baseUrl: config.baseUrl.trim() || DEFAULT_AI_BASE_URL,
    model: config.model.trim() || DEFAULT_AI_MODEL,
    apiKey: config.apiKey.trim(),
  };
}

/** 配置可发起请求的最小条件：有 key 且有模型名。 */
export function isCloudConfigReady(config: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}): boolean {
  const normalized = normalizeCloudConfig(config);
  return Boolean(normalized.apiKey && normalized.model);
}

/** 由配置构造 AI SDK 语言模型；配置不完整返回 null（调用方自行提示）。 */
export function createCloudModel(config: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}): LanguageModel | null {
  const normalized = normalizeCloudConfig(config);
  if (!normalized.apiKey || !normalized.model) return null;
  if (normalized.provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: normalized.apiKey,
      // 留空用官方默认端点；用户填了就走自建/代理地址。
      ...(normalized.baseUrl && normalized.baseUrl !== DEFAULT_AI_BASE_URL
        ? { baseURL: normalized.baseUrl }
        : {}),
    });
    return anthropic(normalized.model);
  }
  const compatible = createOpenAICompatible({
    name: "deer-cloud",
    baseURL: normalized.baseUrl,
    apiKey: normalized.apiKey,
  });
  return compatible(normalized.model);
}

export type CloudTestResult = {
  ok: boolean;
  /** 可读结论：成功打勾说明，失败给到能定位问题的报错。不含 key。 */
  message: string;
};

/** 把 provider/网络错误翻译成可读的一句话（不回显 key）。 */
export function cloudErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const status =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? `（HTTP ${(error as unknown as { statusCode: number }).statusCode}）`
        : "";
    if (/fetch failed|networkerror|load failed/i.test(error.message)) {
      return "网络请求失败：检查 Base URL 是否正确、本机能否访问该地址。";
    }
    if (/(401|403)/.test(`${status}${error.message}`)) {
      return `认证失败${status}：请检查 API Key 是否有效。`;
    }
    if (/404/.test(`${status}${error.message}`)) {
      return `接口不存在${status}：请检查 Base URL 与模型名拼写。`;
    }
    const detail = error.message.split("\n")[0]?.trim();
    return `连接失败${status}：${detail || "未知错误"}`;
  }
  return `连接失败：${String(error)}`;
}

/** 连接测试：发一次最小请求，校验 key / Base URL / 模型名。 */
export async function testCloudConnection(config: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}): Promise<CloudTestResult> {
  if (!isCloudConfigReady(config)) {
    return { ok: false, message: "请先填写 API Key 和模型名。" };
  }
  const model = createCloudModel(config);
  if (!model) return { ok: false, message: "请先填写 API Key 和模型名。" };
  try {
    const result = await generateText({
      model,
      prompt: TEST_PROMPT,
      maxOutputTokens: 16,
    });
    return {
      ok: true,
      message: `连接成功（模型 ${config.model.trim()}，返回 ${result.text.length} 字）。`,
    };
  } catch (error) {
    return { ok: false, message: cloudErrorMessage(error) };
  }
}
