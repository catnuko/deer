/**
 * 云引擎配置层（纯常量与校验，不依赖 AI SDK）。
 * 独立成文件是为了让 appSettings 等首屏模块只引用常量时，
 * 不把 @ai-sdk/* 与 "ai" 拉进主包（SDK 实现在 cloudProvider.ts，随用随载）。
 */

export const AI_PROVIDER_KINDS = ["openai-compatible", "anthropic"] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** 默认走 OpenAI 兼容接口 + 智谱端点（catnuko 现成 GLM key）。 */
export const DEFAULT_AI_PROVIDER: AiProviderKind = "openai-compatible";
export const DEFAULT_AI_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
export const DEFAULT_AI_MODEL = "glm-4.6";

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
