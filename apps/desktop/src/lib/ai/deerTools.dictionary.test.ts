import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DICTIONARY_SENSE_LIMIT,
  lookupDictionaryWord,
  parseDictionaryEntry,
} from "./deerTools";

/** dictionaryapi.dev 正常返回的词条形态（节选 ephemeral）。 */
const EPHEMERAL_PAYLOAD = [
  {
    word: "ephemeral",
    phonetic: "/ɪˈfem.ər.əl/",
    phonetics: [{ text: "/ɪˈfem.ər.əl/" }],
    meanings: [
      {
        partOfSpeech: "adjective",
        definitions: [
          {
            definition: "Lasting for a very short time.",
            example: "fashions are ephemeral",
          },
          { definition: "Short-lived; transient." },
        ],
      },
      {
        partOfSpeech: "noun",
        definitions: [{ definition: "A short-lived thing." }],
      },
    ],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseDictionaryEntry", () => {
  it("解析词性/释义/例句/音标，空释义丢弃", () => {
    const result = parseDictionaryEntry("ephemeral", [
      {
        ...EPHEMERAL_PAYLOAD[0],
        meanings: [
          {
            partOfSpeech: "adjective",
            definitions: [
              { definition: "  Lasting for a very short time.  ", example: "  " },
              { definition: "   " },
              { definition: "Short-lived." },
            ],
          },
        ],
      },
    ]);
    expect(result).toEqual({
      found: true,
      word: "ephemeral",
      phonetic: "/ɪˈfem.ər.əl/",
      senses: [
        {
          partOfSpeech: "adjective",
          definition: "Lasting for a very short time.",
        },
        { partOfSpeech: "adjective", definition: "Short-lived." },
      ],
    });
  });

  it("音标缺省时取 phonetics 里的首个 text；都缺省则不带 phonetic 字段", () => {
    const meanings = EPHEMERAL_PAYLOAD[0]!.meanings!;
    const withPhonetics = parseDictionaryEntry("w", [
      { phonetics: [{ text: "/w/" }], meanings },
    ]);
    expect(withPhonetics.found).toBe(true);
    if (!withPhonetics.found) return;
    expect(withPhonetics.phonetic).toBe("/w/");

    const withoutPhonetic = parseDictionaryEntry("w", [{ meanings }]);
    expect(withoutPhonetic.found).toBe(true);
    if (!withoutPhonetic.found) return;
    expect("phonetic" in withoutPhonetic).toBe(false);
  });

  it("senses 截到上限 6 条", () => {
    const meanings = Array.from({ length: 8 }, (_, i) => ({
      partOfSpeech: `pos-${i}`,
      definitions: [{ definition: `def ${i}` }],
    }));
    const result = parseDictionaryEntry("set", [{ meanings }]);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.senses).toHaveLength(DICTIONARY_SENSE_LIMIT);
  });

  it("非数组、无 meanings、全空释义都返回 found:false", () => {
    expect(parseDictionaryEntry("x", undefined)).toEqual({ found: false, word: "x" });
    expect(parseDictionaryEntry("x", [{}])).toEqual({ found: false, word: "x" });
    expect(
      parseDictionaryEntry("x", [{ meanings: [{ definitions: [{}] }] }]),
    ).toEqual({ found: false, word: "x" });
  });
});

describe("lookupDictionaryWord", () => {
  it("正常词条：fetch 2xx 且解析出结构化数据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(EPHEMERAL_PAYLOAD), { status: 200 }),
      ),
    );
    const result = await lookupDictionaryWord("ephemeral");
    expect(result).toEqual({
      found: true,
      word: "ephemeral",
      phonetic: "/ɪˈfem.ər.əl/",
      senses: [
        {
          partOfSpeech: "adjective",
          definition: "Lasting for a very short time.",
          example: "fashions are ephemeral",
        },
        {
          partOfSpeech: "adjective",
          definition: "Short-lived; transient.",
        },
        { partOfSpeech: "noun", definition: "A short-lived thing." },
      ],
    });
  });

  it("查无词条：404 返回 found:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    const result = await lookupDictionaryWord("asdfsdfz");
    expect(result).toEqual({ found: false, word: "asdfsdfz" });
  });

  it("网络失败：fetch 抛错返回 found:false，不向外抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await lookupDictionaryWord("ephemeral");
    expect(result).toEqual({ found: false, word: "ephemeral" });
  });
});
