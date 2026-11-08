import { describe, expect, it } from "vitest";
import {
  localUnavailableError,
  resolveEngine,
} from "@/lib/ai/engineRouter";

describe("engineRouter", () => {
  it("仅云/仅本地按档位直出", () => {
    expect(resolveEngine("cloud", true)).toBe("cloud");
    expect(resolveEngine("cloud", false)).toBe("cloud");
    expect(resolveEngine("cloud", null)).toBe("cloud");
    expect(resolveEngine("local", false)).toBe("local");
    expect(resolveEngine("local", null)).toBe("local");
  });

  it("自动：本地可用走本地，不可用/未知走云", () => {
    expect(resolveEngine("auto", true)).toBe("local");
    expect(resolveEngine("auto", false)).toBe("cloud");
    expect(resolveEngine("auto", null)).toBe("cloud");
  });

  it("强制本地但环境不可用时给可读报错", () => {
    const err = localUnavailableError({
      ok: false,
      nodeOk: false,
      nodeVersion: null,
      acpxVersion: null,
      message: "未检测到 Node.js",
    });
    expect(err.message).toContain("本地引擎不可用");
    expect(err.message).toContain("未检测到 Node.js");
    expect(err.message).toContain("设置");
  });
});
