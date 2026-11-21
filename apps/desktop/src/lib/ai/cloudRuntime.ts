/**
 * AI SDK 运行时（streamText / generateText / Deer 工具集）。
 * 全部 SDK 依赖（"ai"、@ai-sdk/*、deerTools 的 tool 协议）收敛在本模块，
 * 由 cloudEngine 在真正发起云请求时动态加载 —— 不进首屏主包。
 */

import {
  generateText,
  stepCountIs,
  streamText,
  type ModelMessage,
} from "ai";
import type { LanguageModel } from "ai";
import { buildDeerTools } from "./deerTools";
import { MAX_AGENT_STEPS } from "./cloudEngine";

/**
 * 发起一轮带工具的流式 agent 对话。消息与模型由调用方组装
 * （cloudEngine 负责配置校验、历史截断与流式回调分发）。
 */
export function buildCloudAgent(opts: {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
}) {
  return streamText({
    model: opts.model,
    system: opts.system,
    messages: opts.messages,
    tools: buildDeerTools(),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
  });
}

/** 一次性生成（无工具、无历史）：概念地图等独立功能用。 */
export function generateOnce(opts: {
  model: LanguageModel;
  system: string;
  prompt: string;
}) {
  return generateText({
    model: opts.model,
    system: opts.system,
    prompt: opts.prompt,
  });
}
