// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentBook } from "@/lib/ai/currentBook";
import type { ChatPanelHandle } from "./ChatPanel";

vi.mock("@/lib/ai/claudeBackend", () => ({
  CLAUDE_CHUNK_EVENT: "claude://chunk",
  isTauriRuntime: vi.fn(() => false),
  claudeChat: vi.fn(),
}));

const { isTauriRuntime, claudeChat } = await import("@/lib/ai/claudeBackend");
const { ChatPanel } = await import("./ChatPanel");
const { useChatStore } = await import("@/store/chatStore");

const BOOK: CurrentBook = { id: "book-1", title: "三体" };

function resetStore() {
  useChatStore.setState({
    threads: {},
    messages: {},
    activeThreadByBook: {},
    feedback: {},
    claudeSessionByBook: {},
    deepThinking: false,
    ready: true,
  });
}

function activeThread() {
  const state = useChatStore.getState();
  const threadId = state.activeThreadByBook[BOOK.id];
  if (!threadId) throw new Error("没有为当前书建立会话");
  return threadId;
}

async function sendMessage(text: string) {
  const user = userEvent.setup();
  await user.type(
    screen.getByPlaceholderText(/问点什么/),
    text,
  );
  await user.click(screen.getByRole("button", { name: "发送" }));
}

// happy-dom 的 MutationObserver 对后续 DOM 变化不触发，RTL 的 waitFor 轮询
// 探不到新渲染的内容；用 vitest 的 vi.waitFor（纯定时轮询）做异步断言。
function eventually<T>(fn: () => T, timeout = 3000): Promise<T> {
  return vi.waitFor(fn, { timeout });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  vi.mocked(claudeChat).mockReset();
});

afterEach(() => {
  cleanup();
  // zustand 是模块级单例，测试间必须还原，否则串状态。
  resetStore();
});

describe("ChatPanel", () => {
  it("头部显示书名、模式徽标，空会话显示引导文案", () => {
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    expect(screen.getByText("AI 伴读")).toBeInTheDocument();
    expect(screen.getByText("三体")).toBeInTheDocument();
    expect(screen.getByText("未接后端（浏览器预览）")).toBeInTheDocument();
    expect(screen.getByText(/和《三体》聊聊/)).toBeInTheDocument();
  });

  it("桌面端模式显示「本地 Claude Code」徽标与说明", () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    expect(screen.getByText("本地 Claude Code")).toBeInTheDocument();
    expect(screen.getByText(/回复由你本机的 claude CLI 生成/)).toBeInTheDocument();
  });

  it("浏览器预览模式发送后先出现用户消息，再收到演示回复", async () => {
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("这本书讲什么");

    await eventually(() =>
      expect(screen.getByText("这本书讲什么")).toBeInTheDocument(),
    );
    // mockReply 延迟 600ms 后返回写死的占位回复；「讲什么」命中关键词分支。
    await eventually(() =>
      expect(screen.getByText(/粗看下来，全书围绕/)).toBeInTheDocument(),
    );
    // 回复落库（持久化链路）。
    const threadId = activeThread();
    expect(useChatStore.getState().messages[threadId]).toHaveLength(2);
  });

  it("桌面端走 claudeChat，回复正文与 session id 落库", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(claudeChat).mockResolvedValue({
      text: "桌面端的完整回复",
      sessionId: "sess_42",
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("主角是谁");

    await eventually(() =>
      expect(screen.getByText("桌面端的完整回复")).toBeInTheDocument(),
    );
    const threadId = activeThread();
    const messages = useChatStore.getState().messages[threadId];
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe("桌面端的完整回复");
    expect(useChatStore.getState().claudeSessionByBook[BOOK.id]).toBe(
      "sess_42",
    );
  });

  it("桌面端 claudeChat 报错时，把原因写进消息而不是白屏", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(claudeChat).mockRejectedValue(
      new Error("claude 未安装或不在应用 PATH 中，请在终端安装 claude"),
    );
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("主角是谁");

    await eventually(() =>
      expect(
        screen.getByText(/（出错了）claude 未安装或不在应用 PATH 中/),
      ).toBeInTheDocument(),
    );
    expect(useChatStore.getState().claudeSessionByBook[BOOK.id]).toBeUndefined();
  });

  it("等待回复期间显示「正在输入…」", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    let resolveChat!: (v: { text: string; sessionId: string }) => void;
    vi.mocked(claudeChat).mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("在吗");
    await eventually(() =>
      expect(screen.getByText("正在输入…")).toBeInTheDocument(),
    );

    resolveChat({ text: "在的", sessionId: "sess_1" });
    await eventually(() =>
      expect(screen.queryByText("正在输入…")).not.toBeInTheDocument(),
    );
  });

  it("回复在途时即使输入了文字也无法发送，回复结束后恢复", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    let resolveChat!: (v: { text: string; sessionId: string }) => void;
    vi.mocked(claudeChat).mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("第一条");
    await eventually(() =>
      expect(screen.getByText("正在输入…")).toBeInTheDocument(),
    );

    // 在途时继续打字：有文字的情况下发送键仍禁用（isSendDisabled 生效），
    // 且输入框不禁用、能继续打字。
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/问点什么/);
    expect(input).toBeEnabled();
    await user.type(input, "第二条");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    resolveChat({ text: "第一条的回复", sessionId: "sess_9" });
    // 回复结束后输入框里还留着「第二条」，发送键恢复可用。
    await eventually(() =>
      expect(screen.getByRole("button", { name: "发送" })).toBeEnabled(),
    );
    expect(claudeChat).toHaveBeenCalledTimes(1);
  });

  it("桌面端发送时 prompt 自动带上阅读上下文行（书名/章节/进度）", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(claudeChat).mockResolvedValue({
      text: "好的",
      sessionId: "sess_ctx",
    });
    render(
      <ChatPanel
        book={BOOK}
        onClose={() => {}}
        readingContext={{
          bookTitle: "三体",
          chapterTitle: "疯狂年代",
          progress: 0.423,
        }}
      />,
    );

    await sendMessage("主角是谁");

    await eventually(() => expect(claudeChat).toHaveBeenCalledTimes(1));
    const prompt = vi.mocked(claudeChat).mock.calls[0][0].prompt;
    expect(prompt).toBe(
      [
        "你是《三体》这本书的伴读助手。",
        "【阅读上下文】《三体》 · 当前章节：疯狂年代 · 全书进度 42%",
        "",
        "主角是谁",
      ].join("\n"),
    );
    // 用户气泡里只有原文，不带上下文框架。
    expect(screen.getByText("主角是谁")).toBeInTheDocument();
    expect(screen.queryByText(/阅读上下文/)).not.toBeInTheDocument();
  });

  it("draft 预填输入框但不自动发送，id 变化时重填", async () => {
    const draft = { text: "我划选了这段：\n\n「给时光以生命」\n\n想问：", id: 1 };
    const { rerender } = render(
      <ChatPanel book={BOOK} onClose={() => {}} draft={draft} />,
    );

    const input = screen.getByPlaceholderText(/问点什么/);
    await eventually(() => expect(input).toHaveValue(draft.text));
    // 没有自动发送：会话里没有消息。
    expect(claudeChat).not.toHaveBeenCalled();
    const threadId = activeThread();
    expect(useChatStore.getState().messages[threadId]).toHaveLength(0);

    // 同一段划选再问一次（新 id）：重填同文本，不叠加。
    rerender(
      <ChatPanel
        book={BOOK}
        onClose={() => {}}
        draft={{ ...draft, id: 2 }}
      />,
    );
    await eventually(() => expect(input).toHaveValue(draft.text));
    expect(claudeChat).not.toHaveBeenCalled();
  });

  it("ref.send：气泡显示 displayText，发给 claude 的是完整 prompt", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(claudeChat).mockResolvedValue({
      text: "本章总结如下……",
      sessionId: "sess_sum",
    });
    const panelRef = { current: null as ChatPanelHandle | null };
    render(<ChatPanel ref={panelRef} book={BOOK} onClose={() => {}} />);

    await eventually(() => expect(panelRef.current).not.toBeNull());
    panelRef.current?.send("完整的总结 prompt", "总结本章");

    await eventually(() =>
      expect(screen.getByText("总结本章")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/完整的总结 prompt/)).not.toBeInTheDocument();
    await eventually(() =>
      expect(screen.getByText("本章总结如下……")).toBeInTheDocument(),
    );
    const prompt = vi.mocked(claudeChat).mock.calls[0][0].prompt;
    expect(prompt).toBe("完整的总结 prompt");
    const threadId = activeThread();
    const messages = useChatStore.getState().messages[threadId];
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("总结本章");
  });

  it("ref.send 在回复在途时不并发发送", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    let resolveChat!: (v: { text: string; sessionId: string }) => void;
    vi.mocked(claudeChat).mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    const panelRef = { current: null as ChatPanelHandle | null };
    render(<ChatPanel ref={panelRef} book={BOOK} onClose={() => {}} />);

    await eventually(() => expect(panelRef.current).not.toBeNull());
    panelRef.current?.send("第一条", "第一条");
    panelRef.current?.send("第二条", "第二条");
    resolveChat({ text: "第一条的回复", sessionId: "sess_x" });
    await eventually(() =>
      expect(screen.getByText("第一条的回复")).toBeInTheDocument(),
    );
    expect(claudeChat).toHaveBeenCalledTimes(1);
  });

  it("清空按钮清空当前会话并回到空状态", async () => {
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("你好");
    await eventually(() =>
      expect(screen.getByText(/我记下了你这个问题/)).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "清空当前会话" }));

    expect(screen.getByText(/和《三体》聊聊/)).toBeInTheDocument();
    const threadId = activeThread();
    expect(useChatStore.getState().messages[threadId]).toHaveLength(0);
  });

  it("点关闭按钮触发 onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel book={BOOK} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭面板" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("给助手回复点「有帮助」后反馈写入 store", async () => {
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("你好");
    await eventually(() =>
      expect(screen.getByText(/我记下了你这个问题/)).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "有帮助" }));

    const threadId = activeThread();
    const assistantMessage = useChatStore.getState().messages[threadId][1];
    expect(useChatStore.getState().feedback[assistantMessage.id]).toBe("up");
  });

  it("深度思考开关默认关，点击打开并持久化", async () => {
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    const toggle = screen.getByRole("button", { name: "深度思考" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(useChatStore.getState().deepThinking).toBe(false);

    const user = userEvent.setup();
    await user.click(toggle);

    expect(useChatStore.getState().deepThinking).toBe(true);
    expect(screen.getByRole("button", { name: "深度思考" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(JSON.parse(localStorage.getItem("deer.chat.v1") ?? "{}").deepThinking).toBe(
      true,
    );
  });

  it("深度思考开启时发送，claudeChat 收到 deepThinking: true", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(claudeChat).mockResolvedValue({
      text: "想过了，回答是……",
      sessionId: "sess_dt",
    });
    useChatStore.getState().setDeepThinking(true);
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("为什么");

    await eventually(() => expect(claudeChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(claudeChat).mock.calls[0][0].deepThinking).toBe(true);
  });

  it("深度思考关闭时发送，claudeChat 收到 deepThinking: false", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(claudeChat).mockResolvedValue({
      text: "直接回答",
      sessionId: "sess_plain",
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("为什么");

    await eventually(() => expect(claudeChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(claudeChat).mock.calls[0][0].deepThinking).toBe(false);
  });

  it("带思考内容的回复渲染折叠思考块，正文照常显示", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    let captured!: { prompt: string; messageId: string; deepThinking?: boolean };
    vi.mocked(claudeChat).mockImplementation(async (opts) => {
      captured = opts;
      opts.onThoughtDelta?.("正在思考这本书的主题……");
      return { text: "思考完了，正文在这里", sessionId: "sess_think" };
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("聊聊主题");
    await eventually(() =>
      expect(screen.getByText("思考完了，正文在这里")).toBeInTheDocument(),
    );

    // 思考内容落库到 thinking 字段，与正文分开。
    const threadId = activeThread();
    const [assistant] = useChatStore.getState().messages[threadId].slice(-1);
    expect(assistant.thinking).toBe("正在思考这本书的主题……");
    expect(captured.deepThinking).toBe(false);

    // 渲染侧：思考块折叠展示，正文不受影响。
    expect(screen.getByTestId("thinking-block")).toBeInTheDocument();
    expect(screen.getByText(/正在思考这本书的主题/)).toBeInTheDocument();
    expect(screen.getByText("思考完了，正文在这里")).toBeInTheDocument();
  });

  it("没有思考内容的回复不渲染思考块", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(claudeChat).mockResolvedValue({
      text: "普通回复",
      sessionId: "sess_no_think",
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("你好");
    await eventually(() =>
      expect(screen.getByText("普通回复")).toBeInTheDocument(),
    );

    expect(screen.queryByTestId("thinking-block")).not.toBeInTheDocument();
  });
});
