import { describe, expect, it } from "vitest";
import {
  SELECTION_QUICK_SHORT_MAX,
  buildSelectionPrompt,
  selectionPresetsFor,
} from "./selectionPrompts";
import { SELECTION_MAX_CHARS } from "./selectionDraft";

describe("selectionPresetsFor", () => {
  it("纯空白选区返回空表（不渲染快捷行）", () => {
    for (const blank of ["", "   ", " \n\t "]) {
      expect(selectionPresetsFor(blank)).toEqual([]);
    }
  });

  it("短选区（词/短语）给释义/翻译/追问", () => {
    const presets = selectionPresetsFor("serendipity");
    expect(presets.map((p) => p.label)).toEqual(["释义", "翻译", "追问"]);
    expect(presets.map((p) => p.id)).toEqual(["define", "translate", "followup"]);
  });

  it("长选区（段落）给这段什么意思/翻译/追问", () => {
    const presets = selectionPresetsFor(
      "这是一段比较长的文字，应该被当作段落而不是单词来处理",
    );
    expect(presets.map((p) => p.label)).toEqual([
      "这段什么意思",
      "翻译",
      "追问",
    ]);
    expect(presets.map((p) => p.id)).toEqual(["explain", "translate", "followup"]);
  });

  it("分界按码点数计算：恰好 SELECTION_QUICK_SHORT_MAX 仍按词/短语", () => {
    const edge = "字".repeat(SELECTION_QUICK_SHORT_MAX);
    expect(selectionPresetsFor(edge)[0]!.id).toBe("define");
    expect(selectionPresetsFor(edge + "字")[0]!.id).toBe("explain");
  });

  it("首尾空白与内部换行不参与长度判断", () => {
    expect(selectionPresetsFor("  词\n\n语  ")[0]!.id).toBe("define");
  });
});

describe("buildSelectionPrompt", () => {
  const preset = { label: "释义", instruction: "解释含义。" };

  it("prompt 含引用块与预设指令，气泡显示标签加选区预览", () => {
    expect(buildSelectionPrompt(preset, "弱小和无知不是生存的障碍")).toEqual({
      prompt:
        "我划选了这段：\n\n「弱小和无知不是生存的障碍」\n\n解释含义。",
      displayText: "释义「弱小和无知不是生存的障碍」",
    });
  });

  it("首尾空白剥掉、内部换行压成空格，纯空白选区不发", () => {
    const built = buildSelectionPrompt(preset, "  第一行\n\n第二行  ");
    expect(built?.prompt).toContain("「第一行 第二行」");
    for (const blank of ["", "   ", " \n\t "]) {
      expect(buildSelectionPrompt(preset, blank)).toBeNull();
    }
  });

  it("超过上限按码点截断，附省略号与说明（与预填草稿同一上限 500）", () => {
    expect(SELECTION_MAX_CHARS).toBe(500);
    const text = "字".repeat(SELECTION_MAX_CHARS + 37);
    const built = buildSelectionPrompt(preset, text);
    expect(built?.prompt).toContain(
      `「${"字".repeat(SELECTION_MAX_CHARS)}……」`,
    );
    expect(built?.prompt).toContain(
      `（选区过长，只带前 ${SELECTION_MAX_CHARS} 字）`,
    );
  });

  it("气泡预览超过上限截断加省略号，不把整段塞进气泡", () => {
    const built = buildSelectionPrompt(preset, "一二三四五六七八九十甲乙丙丁戊己");
    expect(built?.displayText).toBe("释义「一二三四五六七八九十甲乙……」");
  });

  it("emoji 预览不裂开（按码点截断）", () => {
    const built = buildSelectionPrompt(preset, "📚📚📚📚📚📚📚📚📚📚📚📚📚");
    expect(built?.displayText).toBe("释义「📚📚📚📚📚📚📚📚📚📚📚📚……」");
  });

  it("limit 可注入，方便小数字直接测截断路径", () => {
    const built = buildSelectionPrompt(preset, "一二三四五", 3);
    expect(built?.prompt).toBe(
      "我划选了这段：\n\n「一二三……」（选区过长，只带前 3 字）\n\n解释含义。",
    );
  });
});
