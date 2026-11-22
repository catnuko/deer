import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WIKIPEDIA_LANG,
  MAX_ENCYCLOPEDIA_EXTRACT_CHARS,
  lookupEncyclopediaTerm,
  normalizeWikipediaLang,
  parseWikipediaSummary,
} from "./deerTools";

/** Wikipedia REST API page/summary 正常返回的形态（节选布尔什维克）。 */
const BOLSHEVIK_PAYLOAD = {
  type: "standard",
  title: "Bolsheviks",
  extract: "The Bolsheviks were a faction of the Marxist Russian Social Democratic Labour Party.",
  content_urls: {
    desktop: { page: "https://en.wikipedia.org/wiki/Bolsheviks" },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeWikipediaLang", () => {
  it("取主子标签并小写：zh-CN → zh", () => {
    expect(normalizeWikipediaLang("zh-CN")).toBe("zh");
    expect(normalizeWikipediaLang(" EN ")).toBe("en");
  });

  it("缺省/空值/非法代码回退英文维基", () => {
    expect(normalizeWikipediaLang()).toBe(DEFAULT_WIKIPEDIA_LANG);
    expect(normalizeWikipediaLang("")).toBe(DEFAULT_WIKIPEDIA_LANG);
    expect(normalizeWikipediaLang("123")).toBe(DEFAULT_WIKIPEDIA_LANG);
  });
});

describe("parseWikipediaSummary", () => {
  it("正常词条：解析摘要/标题/来源链接", () => {
    expect(
      parseWikipediaSummary("布尔什维克", "en", BOLSHEVIK_PAYLOAD),
    ).toEqual({
      found: true,
      term: "布尔什维克",
      lang: "en",
      title: "Bolsheviks",
      extract:
        "The Bolsheviks were a faction of the Marxist Russian Social Democratic Labour Party.",
      url: "https://en.wikipedia.org/wiki/Bolsheviks",
    });
  });

  it("content_urls 缺省时用标题拼词条链接兜底", () => {
    const result = parseWikipediaSummary("bolsheviks", "en", {
      type: "standard",
      title: "Bolsheviks",
      extract: "A faction of the RSDLP.",
    });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.url).toBe("https://en.wikipedia.org/wiki/Bolsheviks");
  });

  it("摘要超长截到上限", () => {
    const result = parseWikipediaSummary("long", "en", {
      type: "standard",
      title: "long",
      extract: "x".repeat(MAX_ENCYCLOPEDIA_EXTRACT_CHARS + 10),
    });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.extract).toHaveLength(MAX_ENCYCLOPEDIA_EXTRACT_CHARS);
  });

  it("非对象、空摘要、消歧义页都返回结构化 miss", () => {
    expect(parseWikipediaSummary("x", "en", undefined)).toEqual({
      found: false,
      term: "x",
      lang: "en",
      reason: "not_found",
    });
    expect(
      parseWikipediaSummary("x", "en", { type: "standard", extract: "  " }),
    ).toEqual({ found: false, term: "x", lang: "en", reason: "not_found" });
    expect(
      parseWikipediaSummary("x", "zh", { type: "disambiguation", extract: "消歧义" }),
    ).toEqual({ found: false, term: "x", lang: "zh", reason: "disambiguation" });
  });
});

describe("lookupEncyclopediaTerm", () => {
  /** 记录 fetch 收到的 URL，供断言请求目标。 */
  function stubFetchUrl(capturedUrls: string[], respond: () => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrls.push(url);
        return respond();
      }),
    );
  }

  it("命中：fetch 2xx 且解析出结构化摘要与链接", async () => {
    const urls: string[] = [];
    stubFetchUrl(urls, () =>
      new Response(JSON.stringify(BOLSHEVIK_PAYLOAD), { status: 200 }),
    );
    const result = await lookupEncyclopediaTerm("布尔什维克");
    expect(result).toEqual({
      found: true,
      term: "布尔什维克",
      lang: "en",
      title: "Bolsheviks",
      extract:
        "The Bolsheviks were a faction of the Marxist Russian Social Democratic Labour Party.",
      url: "https://en.wikipedia.org/wiki/Bolsheviks",
    });
    expect(urls[0]).toBe(
      "https://en.wikipedia.org/api/rest_v1/page/summary/%E5%B8%83%E5%B0%94%E4%BB%80%E7%BB%B4%E5%85%8B",
    );
  });

  it("lang 传入时按对应语言维基查询", async () => {
    const urls: string[] = [];
    stubFetchUrl(urls, () =>
      new Response(JSON.stringify(BOLSHEVIK_PAYLOAD), { status: 200 }),
    );
    await lookupEncyclopediaTerm("布尔什维克", "zh-CN");
    expect(urls[0]).toBe(
      "https://zh.wikipedia.org/api/rest_v1/page/summary/%E5%B8%83%E5%B0%94%E4%BB%80%E7%BB%B4%E5%85%8B",
    );
  });

  it("查无词条：404 返回 found:false/not_found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    const result = await lookupEncyclopediaTerm("asdfsdfz");
    expect(result).toEqual({
      found: false,
      term: "asdfsdfz",
      lang: "en",
      reason: "not_found",
    });
  });

  it("网络失败：fetch 抛错返回 found:false/network_error，不向外抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await lookupEncyclopediaTerm("Bolsheviks");
    expect(result).toEqual({
      found: false,
      term: "Bolsheviks",
      lang: "en",
      reason: "network_error",
    });
  });
});
