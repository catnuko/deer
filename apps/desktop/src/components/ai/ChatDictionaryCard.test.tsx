// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatDictionaryEntry } from "@/lib/types";
import { ChatDictionaryCard } from "./ChatDictionaryCard";

afterEach(cleanup);

function entry(overrides: Partial<ChatDictionaryEntry>): ChatDictionaryEntry {
  return {
    word: "ephemeral",
    phonetic: "/ɪˈfem.ər.əl/",
    found: true,
    senses: [
      {
        partOfSpeech: "adjective",
        definition: "Lasting for a very short time.",
        example: "fashions are ephemeral",
      },
      { partOfSpeech: "adjective", definition: "Short-lived; transient." },
    ],
    ...overrides,
  };
}

describe("ChatDictionaryCard", () => {
  it("完整词条：词头/音标/词性 chip/释义编号/例句/来源行", () => {
    render(<ChatDictionaryCard entry={entry({})} />);

    expect(screen.getByTestId("chat-dictionary-card")).toBeInTheDocument();
    expect(screen.getByText("ephemeral")).toBeInTheDocument();
    expect(screen.getByText("/ɪˈfem.ər.əl/")).toBeInTheDocument();
    expect(screen.getByText("adjective")).toBeInTheDocument();
    expect(screen.getByText(/Lasting for a very short time\./)).toBeInTheDocument();
    expect(screen.getByText("— fashions are ephemeral")).toBeInTheDocument();
    expect(screen.getByText("来自 dictionaryapi.dev")).toBeInTheDocument();
  });

  it("缺音标、缺例句：逐字段省略，不报错也不留空节点", () => {
    render(
      <ChatDictionaryCard
        entry={entry({
          phonetic: undefined,
          senses: [
            { partOfSpeech: "noun", definition: "A short-lived thing." },
          ],
        })}
      />,
    );

    expect(screen.getByText("ephemeral")).toBeInTheDocument();
    expect(screen.queryByText("/ɪˈfem.ər.əl/")).not.toBeInTheDocument();
    expect(screen.getByText("A short-lived thing.")).toBeInTheDocument();
    expect(screen.queryByText(/— /)).not.toBeInTheDocument();
  });

  it("释义与音标全缺：整卡不渲染", () => {
    const { container } = render(
      <ChatDictionaryCard
        entry={entry({ phonetic: undefined, senses: [] })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("senses 空但音标在：只渲染词头与「词典源未返回释义」", () => {
    render(<ChatDictionaryCard entry={entry({ senses: [] })} />);

    expect(screen.getByText("ephemeral")).toBeInTheDocument();
    expect(screen.getByText("词典源未返回释义")).toBeInTheDocument();
  });

  it("超过 2 组×2 条：默认截断并显示「展开全部」，点击展开后再收起", async () => {
    const user = userEvent.setup();
    render(
      <ChatDictionaryCard
        entry={entry({
          senses: [
            { partOfSpeech: "noun", definition: "定义 1" },
            { partOfSpeech: "noun", definition: "定义 2" },
            { partOfSpeech: "noun", definition: "定义 3" },
            { partOfSpeech: "verb", definition: "定义 4" },
          ],
        })}
      />,
    );

    // 折叠态：noun 组截 2 条、verb 组（第 2 组）整组可见，共 3 条、藏 1 条。
    expect(screen.getByText("定义 1")).toBeInTheDocument();
    expect(screen.getByText("定义 2")).toBeInTheDocument();
    expect(screen.getByText("定义 4")).toBeInTheDocument();
    expect(screen.queryByText("定义 3")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /展开全部 1 条释义/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(screen.getByText("定义 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /收起/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(screen.getByRole("button", { name: /收起/ }));
    expect(screen.queryByText("定义 3")).not.toBeInTheDocument();
  });
});
