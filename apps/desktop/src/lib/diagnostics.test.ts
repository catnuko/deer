import { describe, expect, it } from "vitest";
import { buildDiagnostics } from "./diagnostics";

const fixed = new Date(2026, 10, 2, 14, 3, 5);

describe("buildDiagnostics", () => {
  it("按固定字段拼出可读诊断块", () => {
    const text = buildDiagnostics({
      appVersion: "0.1.0",
      runtime: "Tauri 桌面端",
      userAgent: "Mozilla/5.0 Safari",
      dataDir: "/Users/me/Library/Application Support/com.catnuko.deer",
      copiedAt: fixed,
    });

    expect(text).toContain("Deer 诊断信息");
    expect(text).toContain("版本：0.1.0");
    expect(text).toContain("运行环境：Tauri 桌面端");
    expect(text).toContain("WebView：Mozilla/5.0 Safari");
    expect(text).toContain(
      "数据目录：/Users/me/Library/Application Support/com.catnuko.deer",
    );
    expect(text).toContain("复制时间：2026-11-02 14:03:05");
  });

  it("缺字段时给出稳定的占位，不抛错", () => {
    const text = buildDiagnostics({
      appVersion: "",
      runtime: "浏览器预览",
      userAgent: "",
      dataDir: null,
      copiedAt: fixed,
    });

    expect(text).toContain("版本：unknown");
    expect(text).toContain("WebView：unknown");
    expect(text).toContain("数据目录：不可用");
  });
});
