import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudErrorMessage,
  createCloudModel,
  isCloudConfigReady,
  normalizeCloudConfig,
  testCloudConnection,
} from "@/lib/ai/cloudProvider";

const BASE_CONFIG = {
  provider: "openai-compatible",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "glm-4.6",
  apiKey: "test-key-for-unit-tests",
};

/** OpenAI 兼容 /chat/completions 的最小成功响应体。 */
function chatCompletionJson(text: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cloudProvider", () => {
  it("normalizeCloudConfig 补默认值并接受未知 provider 回落", () => {
    expect(normalizeCloudConfig({ ...BASE_CONFIG, baseUrl: "  " })).toMatchObject({
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    });
    expect(
      normalizeCloudConfig({ ...BASE_CONFIG, model: "" }).model,
    ).toBe("glm-4.6");
    expect(
      normalizeCloudConfig({ ...BASE_CONFIG, provider: "weird" }).provider,
    ).toBe("openai-compatible");
    expect(
      normalizeCloudConfig({ ...BASE_CONFIG, provider: "anthropic" }).provider,
    ).toBe("anthropic");
  });

  it("isCloudConfigReady：缺 key 不可用；空模型回落默认仍可用", () => {
    expect(isCloudConfigReady(BASE_CONFIG)).toBe(true);
    expect(isCloudConfigReady({ ...BASE_CONFIG, apiKey: "  " })).toBe(false);
    expect(isCloudConfigReady({ ...BASE_CONFIG, model: "" })).toBe(true);
  });

  it("createCloudModel：缺 key 返回 null，空模型回落默认不抛错", () => {
    expect(createCloudModel({ ...BASE_CONFIG, apiKey: "" })).toBeNull();
    expect(createCloudModel({ ...BASE_CONFIG, model: "" })).not.toBeNull();
    expect(createCloudModel(BASE_CONFIG)).not.toBeNull();
  });

  it("testCloudConnection：接口返回 200 即成功", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(chatCompletionJson("pong")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await testCloudConnection(BASE_CONFIG);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("连接成功");
    expect(result.message).not.toContain(BASE_CONFIG.apiKey);
  });

  it("testCloudConnection：401 报认证失败，不回显 key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
        }),
      ),
    );
    const result = await testCloudConnection(BASE_CONFIG);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("认证失败");
    expect(result.message).not.toContain(BASE_CONFIG.apiKey);
  });

  it("testCloudConnection：网络失败给可读提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await testCloudConnection(BASE_CONFIG);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("网络请求失败");
  });

  it("cloudErrorMessage：非 Error 值也能变成一句话", () => {
    expect(cloudErrorMessage("boom")).toBe("连接失败：boom");
  });
});
