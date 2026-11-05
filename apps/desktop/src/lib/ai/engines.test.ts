import { describe, expect, it } from "vitest";
import {
  AI_ENGINES,
  AI_ENGINE_IDS,
  aiEngineSpec,
  COMMON_AI_ENGINES,
  DEFAULT_AI_ENGINE,
  isAiEngineId,
  isEngineSelectable,
  OTHER_AI_ENGINES,
} from "./engines";

describe("AI 引擎目录", () => {
  it("共 27 个引擎，常用 7 + 其余 20，id 唯一", () => {
    expect(AI_ENGINES).toHaveLength(27);
    expect(COMMON_AI_ENGINES).toHaveLength(7);
    expect(OTHER_AI_ENGINES).toHaveLength(20);
    expect(new Set(AI_ENGINE_IDS).size).toBe(AI_ENGINES.length);
  });

  it("常用 7 个按固定顺序前排，claude 是默认引擎", () => {
    expect(COMMON_AI_ENGINES.map((e) => e.id)).toEqual([
      "claude",
      "codex",
      "kimi",
      "qwen",
      "gemini",
      "cursor",
      "copilot",
    ]);
    expect(DEFAULT_AI_ENGINE).toBe("claude");
    expect(AI_ENGINES[0].id).toBe("claude");
    expect(isAiEngineId("claude")).toBe(true);
    expect(isAiEngineId("not-an-agent")).toBe(false);
  });

  it("一键安装只给 acpx 的 4 个 npm 适配器包，且带版本线", () => {
    const adapters = AI_ENGINES.filter((e) => e.installMode === "adapter");
    expect(adapters.map((e) => e.id).sort()).toEqual(["claude", "codex", "mux", "pi"]);
    for (const engine of adapters) {
      expect(engine.adapterPackage).toBeTruthy();
      expect(engine.adapterRange).toMatch(/^\^/);
    }
  });

  it("vendor 引擎必须给官方安装提示；npx 引擎无需预装即可选用", () => {
    for (const engine of AI_ENGINES.filter((e) => e.installMode === "vendor")) {
      expect(engine.installHint, engine.id).toBeTruthy();
    }
    const opencode = aiEngineSpec("opencode");
    expect(opencode?.installMode).toBe("npx");
    expect(isEngineSelectable(opencode!, false)).toBe(true);
    // vendor 未装时不可选，装了可选
    const kimi = aiEngineSpec("kimi");
    expect(isEngineSelectable(kimi!, false)).toBe(false);
    expect(isEngineSelectable(kimi!, true)).toBe(true);
  });
});
