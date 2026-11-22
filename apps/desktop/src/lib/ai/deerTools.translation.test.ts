import { describe, expect, it } from "vitest";
import {
  MAX_TRANSLATION_CHARS,
  normalizeTranslation,
} from "./deerTools";
import { asTranslationEntry } from "./cloudEngine";

describe("normalizeTranslation", () => {
  it("中→英：结构化结果完整回传，语言字段保留原样", () => {
    expect(
      normalizeTranslation({
        text: "今晚月色真美。",
        targetLang: "English",
        translatedText: "The moon is beautiful tonight.",
        sourceLang: "zh-CN",
      }),
    ).toEqual({
      sourceLang: "zh-CN",
      sourceText: "今晚月色真美。",
      targetLang: "English",
      translatedText: "The moon is beautiful tonight.",
    });
  });

  it("英→中：源语言由模型检测，缺省时不带 sourceLang 字段", () => {
    const result = normalizeTranslation({
      text: "The moon is beautiful tonight.",
      targetLang: "zh-CN",
      translatedText: "今晚月色真美。",
    });
    expect(result).toEqual({
      sourceText: "The moon is beautiful tonight.",
      targetLang: "zh-CN",
      translatedText: "今晚月色真美。",
    });
  });

  it("小语种方向（英→日）：语言标签原样承载，不做白名单校验", () => {
    const result = normalizeTranslation({
      text: "The moon is beautiful tonight.",
      targetLang: "日文",
      translatedText: "今夜は月が綺麗ですね。",
      sourceLang: "en",
    });
    expect(result).toMatchObject({
      sourceLang: "en",
      targetLang: "日文",
      translatedText: "今夜は月が綺麗ですね。",
    });
  });

  it("空文本：返回可读错误提示，不产出卡片数据", () => {
    expect(
      normalizeTranslation({ text: "   ", translatedText: "x" }),
    ).toBe("待翻译文本为空，请提供要翻译的内容。");
  });

  it("空译文：返回可读错误提示（模型未完成翻译就调用）", () => {
    expect(
      normalizeTranslation({ text: "你好", translatedText: "  " }),
    ).toBe("译文为空，请先完成翻译再调用本工具。");
  });

  it("原文超 2000 字符：截断并带 truncated 标记", () => {
    const result = normalizeTranslation({
      text: "a".repeat(MAX_TRANSLATION_CHARS + 10),
      translatedText: "译文",
    });
    expect(result).toEqual({
      sourceText: "a".repeat(MAX_TRANSLATION_CHARS),
      translatedText: "译文",
      truncated: true,
    });
  });

  it("原文恰好 2000 字符：不截断", () => {
    const result = normalizeTranslation({
      text: "a".repeat(MAX_TRANSLATION_CHARS),
      translatedText: "译文",
    });
    if (typeof result === "string") return;
    expect(result.sourceText).toHaveLength(MAX_TRANSLATION_CHARS);
    expect("truncated" in result).toBe(false);
  });

  it("语言字段为空白：视为缺省，不带空 chip 数据", () => {
    const result = normalizeTranslation({
      text: "你好",
      targetLang: "  ",
      translatedText: "Hello",
      sourceLang: "",
    });
    expect(result).toEqual({ sourceText: "你好", translatedText: "Hello" });
  });
});

describe("asTranslationEntry", () => {
  it("原文/译文齐全：放行（含缺省语言字段）", () => {
    expect(
      asTranslationEntry({
        sourceText: "你好",
        translatedText: "Hello",
      }),
    ).toEqual({ sourceText: "你好", translatedText: "Hello" });
  });

  it("原文或译文为空、非对象、字符串：坏帧丢弃返回 null", () => {
    expect(asTranslationEntry(null)).toBeNull();
    expect(asTranslationEntry("你好→Hello")).toBeNull();
    expect(asTranslationEntry({ translatedText: "Hello" })).toBeNull();
    expect(asTranslationEntry({ sourceText: "你好" })).toBeNull();
    expect(asTranslationEntry({ sourceText: "  ", translatedText: "Hi" })).toBeNull();
  });
});
