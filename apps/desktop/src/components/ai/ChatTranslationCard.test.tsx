// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatTranslationEntry } from "@/lib/types";
import { ChatTranslationCard } from "./ChatTranslationCard";

afterEach(cleanup);

function entry(overrides: Partial<ChatTranslationEntry>): ChatTranslationEntry {
  return {
    sourceLang: "en",
    sourceText: "The moon is beautiful tonight.",
    targetLang: "zh-CN",
    translatedText: "今晚月色真美。",
    ...overrides,
  };
}

describe("ChatTranslationCard", () => {
  it("完整结果：原文/译文两段对照，语言 chip 与来源行齐全", () => {
    render(<ChatTranslationCard entry={entry({})} />);

    expect(screen.getByTestId("chat-translation-card")).toBeInTheDocument();
    expect(screen.getByText("原文")).toBeInTheDocument();
    expect(screen.getByText("The moon is beautiful tonight.")).toBeInTheDocument();
    expect(screen.getByText("译文")).toBeInTheDocument();
    expect(screen.getByText("今晚月色真美。")).toBeInTheDocument();
    expect(screen.getByText("en")).toBeInTheDocument();
    expect(screen.getByText("zh-CN")).toBeInTheDocument();
    expect(screen.getByText("AI 翻译")).toBeInTheDocument();
  });

  it("源语言检测失败（缺 sourceLang）：不报错，原文段省略语言 chip", () => {
    render(<ChatTranslationCard entry={entry({ sourceLang: undefined })} />);

    expect(screen.getByTestId("chat-translation-card")).toBeInTheDocument();
    expect(screen.getByText("今晚月色真美。")).toBeInTheDocument();
    expect(screen.queryByText("en")).not.toBeInTheDocument();
  });

  it("缺 targetLang：只省译段语言 chip，其余照常", () => {
    render(<ChatTranslationCard entry={entry({ targetLang: undefined })} />);

    expect(screen.getByText("en")).toBeInTheDocument();
    expect(screen.queryByText("zh-CN")).not.toBeInTheDocument();
  });

  it("截断结果：显示超长提示", () => {
    render(<ChatTranslationCard entry={entry({ truncated: true })} />);

    expect(
      screen.getByText("原文超过 2000 字符，仅展示并翻译前 2000 字。"),
    ).toBeInTheDocument();
  });

  it("长原文默认折叠 6 行，可展开后收起", async () => {
    const long = "a".repeat(300);
    render(<ChatTranslationCard entry={entry({ sourceText: long })} />);

    const toggle = screen.getByRole("button", { name: "展开全部原文 ↓" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "收起 ↑" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(long)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "收起 ↑" }));
    expect(
      screen.getByRole("button", { name: "展开全部原文 ↓" }),
    ).toBeInTheDocument();
  });

  it("原文与译文全缺：整卡不渲染", () => {
    const { container } = render(
      <ChatTranslationCard
        entry={entry({ sourceText: "", translatedText: "  " })}
      />,
    );
    expect(container.querySelector("[data-testid=chat-translation-card]")).toBeNull();
  });
});
