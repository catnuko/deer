/**
 * 云引擎 provider 层：把设置页的 provider 配置变成 AI SDK 的语言模型，
 * 并提供「连接测试」的最小请求。key 只在内存/持久化里流转，绝不落日志。
 *
 * 纯配置/校验逻辑抽在 providerConfig.ts（无 SDK 依赖）；
 * 本文件只留需要 @ai-sdk / "ai" 的实现，供运行时按需加载，
 * 避免整个 AI SDK 被静态引用拉进首屏主包。
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import {
  DEFAULT_AI_BASE_URL,
  cloudErrorMessage,
  isCloudConfigReady,
  normalizeCloudConfig,
  type CloudTestResult,
} from "./providerConfig";

/** 连接测试用的最小提问；回复内容无所谓，能通即可。 */
const TEST_PROMPT = "ping";

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
