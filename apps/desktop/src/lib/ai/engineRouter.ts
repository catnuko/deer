import type { AcpxEnvStatus } from "@/lib/ai/claudeBackend";
import type { AiEngineMode } from "@/store/appSettings";

export type ResolvedEngine = "local" | "cloud";

/**
 * 引擎路由决策表：
 * - cloud → 云引擎；
 * - local → 强制本地（环境不可用由调用方报可读错误，不静默回落）；
 * - auto  → 本地可用走本地，否则云。移动端 acpx 环境自检自然失败，
 *   正好直落云引擎，无需平台特判。
 * localAvailable 为 null（自检未完成/未启用）按不可用处理，走云。
 */
export function resolveEngine(
  mode: AiEngineMode,
  localAvailable: boolean | null,
): ResolvedEngine {
  if (mode === "cloud") return "cloud";
  if (mode === "local") return "local";
  return localAvailable === true ? "local" : "cloud";
}

/** 强制本地但环境自检失败时给可读报错，指引去设置切回自动/云。 */
export function localUnavailableError(status: AcpxEnvStatus | null): Error {
  const detail = status?.message ?? "本机没有可用的本地引擎环境";
  return new Error(
    `本地引擎不可用：${detail} 可到 设置 → AI 伴读 把引擎选择改为「自动」或「仅云引擎」。`,
  );
}
