// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CurrentBook } from "@/lib/ai/currentBook";
import type { ChatPanelHandle } from "./ChatPanel";

vi.mock("@/lib/ai/claudeBackend", () => ({
  CLAUDE_CHUNK_EVENT: "claude://chunk",
  isTauriRuntime: vi.fn(() => false),
  acpxChat: vi.fn(),
  acpxEnvCheck: vi.fn(),
}));

const { isTauriRuntime, acpxChat, acpxEnvCheck } = await import(
  "@/lib/ai/claudeBackend"
);
const { ChatPanel } = await import("./ChatPanel");
const { useChatStore } = await import("@/store/chatStore");
const { useAnnotationStore } = await import("@/store/annotationStore");

const BOOK: CurrentBook = { id: "book-1", title: "三体" };

function resetStore() {
  useChatStore.setState({
    threads: {},
    messages: {},
    activeThreadByBook: {},
    feedback: {},
    acpxSessionByThread: {},
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
  vi.mocked(acpxChat).mockReset();
  vi.mocked(acpxEnvCheck).mockReset();
  vi.mocked(acpxEnvCheck).mockResolvedValue({
    ok: true,
    nodeOk: true,
    nodeVersion: "v24.20.0",
    acpxVersion: "0.21.1",
    message: "",
  });
});

afterEach(() => {
  cleanup();
  // zustand 是模块级单例，测试间必须还原，否则串状态。
  resetStore();
  useAnnotationStore.setState({ annotations: {}, ready: true });
});

describe("ChatPanel", () => {
  it("打开时内容带方向入场（不碰宽度）", () => {
    const { container } = render(<ChatPanel book={BOOK} onClose={() => {}} />);

    const aside = container.querySelector("aside")!;
    // 盒子裁掉方向位移：否则阅读页 main 会因多出的 12px 闪出横向滚动条。
    expect(aside.classList.contains("overflow-hidden")).toBe(true);
    expect(aside.classList.contains("hidden")).toBe(false);
    expect(aside.firstElementChild!.className).toContain("deer-panel-in");
  });

  it("关闭时先播退场、动画结束才折叠并通知宿主摘除", async () => {
    const onExited = vi.fn();
    const { container, rerender } = render(
      <ChatPanel book={BOOK} onClose={() => {}} open onExited={onExited} />,
    );
    rerender(
      <ChatPanel
        book={BOOK}
        onClose={() => {}}
        open={false}
        onExited={onExited}
      />,
    );

    const aside = container.querySelector("aside")!;
    // 退场期间仍占位，否则动画看不见。
    expect(aside.classList.contains("hidden")).toBe(false);
    expect(aside).toHaveAttribute("aria-hidden", "true");

    const content = aside.firstElementChild as HTMLElement;
    expect(content.className).toContain("deer-panel-out");

    fireEvent.animationEnd(content);

    // 摘除排在 animationend 的下一帧；这之前退场类必须还在，不能落回无动画类。
    expect(content.className).toContain("deer-panel-out");
    expect(aside.classList.contains("hidden")).toBe(false);
    expect(onExited).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
    expect(aside.classList.contains("hidden")).toBe(true);
  });

  it("可见态永远挂着动画类，不存在空 class 的自然态帧", () => {
    const { container, rerender } = render(
      <ChatPanel book={BOOK} onClose={() => {}} open />,
    );
    const content = container.querySelector("aside")!
      .firstElementChild as HTMLElement;

    expect(content.className).toMatch(/deer-panel-(in|out|open)/);

    rerender(<ChatPanel book={BOOK} onClose={() => {}} open={false} />);
    expect(content.className).toContain("deer-panel-out");
    expect(content.className).not.toBe("");
  });

  it("退场途中重新打开：从当前状态接回，不从 12px 重起", () => {
    const { container, rerender } = render(
      <ChatPanel book={BOOK} onClose={() => {}} open />,
    );
    const aside = container.querySelector("aside")!;
    const content = aside.firstElementChild as HTMLElement;

    rerender(<ChatPanel book={BOOK} onClose={() => {}} open={false} />);
    expect(content.className).toContain("deer-panel-out");

    rerender(<ChatPanel book={BOOK} onClose={() => {}} open />);
    // 换成入场类，且起点来自当前画面（--panel-start-* 已写入），不会归零重播。
    expect(content.className).toContain("deer-panel-in");
    expect(content.style.getPropertyValue("--panel-start-opacity")).not.toBe("");
    expect(aside.classList.contains("hidden")).toBe(false);
  });

  it("入场动画播完后落到无动画的常态类", () => {
    const { container } = render(<ChatPanel book={BOOK} onClose={() => {}} />);
    const content = container.querySelector("aside")!
      .firstElementChild as HTMLElement;

    fireEvent.animationEnd(content);

    expect(content.className).toContain("deer-panel-open");
    expect(content.className).not.toContain("deer-panel-in");
  });

  it("初始 open=false 时直接折叠，不播入场", () => {
    const { container } = render(
      <ChatPanel book={BOOK} onClose={() => {}} open={false} />,
    );

    const aside = container.querySelector("aside")!;
    expect(aside.classList.contains("hidden")).toBe(true);
    expect(aside.firstElementChild!.className).not.toContain("deer-panel-in");
  });

  it("头部显示书名、模式徽标，空会话显示引导文案", () => {
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    expect(screen.getByText("AI 伴读")).toBeInTheDocument();
    expect(screen.getByText("三体")).toBeInTheDocument();
    expect(screen.getByText("未接后端（浏览器预览）")).toBeInTheDocument();
    expect(screen.getByText(/和《三体》聊聊/)).toBeInTheDocument();
  });

  it("桌面端显示「acpx · Claude」徽标与环境自检说明", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    expect(screen.getByText("acpx · Claude")).toBeInTheDocument();
    await eventually(() =>
      expect(screen.getByTestId("acpx-env-note")).toHaveTextContent(
        "acpx 连接层",
      ),
    );
  });

  it("桌面端进入聊天即做 acpx 环境自检（唯一链路，不达标给安装引导）", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxEnvCheck).mockResolvedValue({
      ok: false,
      nodeOk: true,
      nodeVersion: "v24.20.0",
      acpxVersion: null,
      message: "未找到 acpx，请在终端执行 npm install -g acpx@0.21.1。",
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await eventually(() => expect(acpxEnvCheck).toHaveBeenCalledTimes(1));
    await eventually(() =>
      expect(screen.getByTestId("acpx-env-note")).toHaveTextContent(
        "npm install -g acpx@0.21.1",
      ),
    );
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

  it("桌面端走 acpxChat，回复正文与 session id 落到线程映射", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockResolvedValue({
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
    expect(useChatStore.getState().acpxSessionByThread[threadId]).toBe(
      "sess_42",
    );
  });

  it("桌面端 acpxChat 报错时，把原因写进消息而不是白屏", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockRejectedValue(
      new Error("acpx 需要 Node ≥22.13，当前 v18.0.0"),
    );
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("主角是谁");

    await eventually(() =>
      expect(
        screen.getByText(/（出错了）acpx 需要 Node ≥22.13/),
      ).toBeInTheDocument(),
    );
    expect(
      useChatStore.getState().acpxSessionByThread[activeThread()],
    ).toBeUndefined();
  });

  it("等待回复期间显示「正在输入…」", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    let resolveChat!: (v: { text: string; sessionId: string }) => void;
    vi.mocked(acpxChat).mockReturnValue(
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
    vi.mocked(acpxChat).mockReturnValue(
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
    expect(acpxChat).toHaveBeenCalledTimes(1);
  });

  it("桌面端发送时 prompt 自动带上阅读上下文行（书名/章节/进度）", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockResolvedValue({
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

    await eventually(() => expect(acpxChat).toHaveBeenCalledTimes(1));
    const prompt = vi.mocked(acpxChat).mock.calls[0][0].prompt;
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
    expect(acpxChat).not.toHaveBeenCalled();
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
    expect(acpxChat).not.toHaveBeenCalled();
  });

  it("ref.send：气泡显示 displayText，发给 acpx 的是完整 prompt", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockResolvedValue({
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
    const prompt = vi.mocked(acpxChat).mock.calls[0][0].prompt;
    expect(prompt).toBe("完整的总结 prompt");
    const threadId = activeThread();
    const messages = useChatStore.getState().messages[threadId];
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("总结本章");
  });

  it("ref.send 在回复在途时不并发发送", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    let resolveChat!: (v: { text: string; sessionId: string }) => void;
    vi.mocked(acpxChat).mockReturnValue(
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
    expect(acpxChat).toHaveBeenCalledTimes(1);
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

  it("深度思考开关已移除（恒开）：面板无开关按钮，发送不带 deepThinking 参数", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockResolvedValue({
      text: "想过了，回答是……",
      sessionId: "sess_dt",
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    expect(
      screen.queryByRole("button", { name: "深度思考" }),
    ).not.toBeInTheDocument();

    await sendMessage("为什么");

    await eventually(() => expect(acpxChat).toHaveBeenCalledTimes(1));
    const call = vi.mocked(acpxChat).mock.calls[0][0] as Record<string, unknown>;
    expect("deepThinking" in call).toBe(false);
    // 思考恒开由 Rust 侧保证，前端不再传递开关状态。
    expect(call.prompt).toContain("为什么");
  });

  it("带思考内容的回复渲染折叠思考块，正文照常显示", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockImplementation(async (opts) => {
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

    // 渲染侧：思考块折叠展示，正文不受影响。
    expect(screen.getByTestId("thinking-block")).toBeInTheDocument();
    expect(screen.getByText(/正在思考这本书的主题/)).toBeInTheDocument();
    expect(screen.getByText("思考完了，正文在这里")).toBeInTheDocument();
  });

  it("没有思考内容的回复不渲染思考块", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockResolvedValue({
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

  // 流式回归（真机反馈「等很久后一次性出现」）：增量回调逐块触发时，
  // 已到达的部分必须在回复完成前就渲染出来，而不是憋到 resolve 一次性显示。
  it("流式增量逐块渲染：正文块到达即显示，不等回复完成", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockImplementation(async (opts) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      opts.onDelta("第一块，");
      await sleep(120);
      opts.onDelta("第二块，");
      await sleep(120);
      opts.onDelta("第三块。");
      return { text: "第一块，第二块，第三块。", sessionId: "sess_stream" };
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("测流式");

    // 第一块到达后就该看到它（不等后续块）。
    await eventually(() =>
      expect(screen.getByText(/第一块/)).toBeInTheDocument(),
    );
    // 回复尚未 resolve：完整正文不该已经在 DOM 里。
    expect(screen.queryByText(/第三块/)).not.toBeInTheDocument();

    // 完成后以 Rust 累计的完整正文落库。
    await eventually(() =>
      expect(screen.getByText(/第三块/)).toBeInTheDocument(),
    );
    const threadId = activeThread();
    const messages = useChatStore.getState().messages[threadId];
    expect(messages[1].content).toBe("第一块，第二块，第三块。");
  });

  it("acpx 引擎：流式增量同样逐块渲染，session id 落到 acpx 映射", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.mocked(acpxChat).mockImplementation(async (opts) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      opts.onDelta("acpx一");
      await sleep(120);
      opts.onDelta("acpx二");
      return { text: "acpx一acpx二", sessionId: "acpx_sess_1" };
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("测 acpx 流式");

    await eventually(() =>
      expect(screen.getByText(/acpx一/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/acpx二/)).not.toBeInTheDocument();
    await eventually(() =>
      expect(screen.getByText(/acpx二/)).toBeInTheDocument(),
    );
    const threadId = activeThread();
    expect(useChatStore.getState().acpxSessionByThread[threadId]).toBe(
      "acpx_sess_1",
    );
  });

  it("acpx 书架工具返回书单时渲染成书卡，点击打开对应书", async () => {    vi.mocked(isTauriRuntime).mockReturnValue(true);
    // 模拟 Rust 侧从书架 MCP 工具结果抽出书单后推来的 books 事件。
    vi.mocked(acpxChat).mockImplementation(async (opts) => {
      opts.onBooks?.([
        { id: "b1", title: "球状闪电", author: "刘慈欣", format: "epub", progress: 0.2 },
      ]);
      return { text: "为你找到一本《球状闪电》", sessionId: "acpx_sess_2" };
    });
    render(
      <MemoryRouter initialEntries={["/bookshelf"]}>
        <Routes>
          <Route path="/bookshelf" element={<ChatPanel book={BOOK} onClose={() => {}} />} />
          <Route path="/reader" element={<div data-testid="reader-page">阅读页</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await sendMessage("推荐一本我想看的书");

    // 书卡出现在回复气泡里（数据 part 渲染），带书名与作者。
    const card = await eventually(() => screen.getByTestId("chat-book-card"));
    expect(card).toHaveTextContent("球状闪电");
    expect(card).toHaveTextContent("刘慈欣");
    // 点击书卡 → 复用现有开书通路跳转阅读页。
    const user = userEvent.setup();
    await user.click(card);
    expect(await screen.findByTestId("reader-page")).toBeInTheDocument();
    // 书单落库：消息上保留 books（重开面板仍可见）。
    const threadId = activeThread();
    const messages = useChatStore.getState().messages[threadId];
    expect(messages[1].books?.[0]?.id).toBe("b1");
  });

  it("助手回复可存为笔记：预填回复、可编辑，确认后写入当前书的笔记列表", async () => {
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    await sendMessage("这个章节讲了什么？");
    await eventually(() =>
      expect(screen.getByText(/粗看下来，全书围绕/)).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "存为笔记" }));

    // 弹窗预填回复全文，可编辑。
    const textarea = screen.getByLabelText("笔记内容");
    expect(textarea).toHaveValue(
      "（示例回复 · 未接模型）粗看下来，全书围绕「留下还是离开」这条线展开，反复用同一个场景的变化来标记时间。",
    );
    await user.clear(textarea);
    await user.type(textarea, "改过的笔记内容");
    await user.click(screen.getByRole("button", { name: "保存" }));

    const annotations = useAnnotationStore.getState().annotations[BOOK.id] ?? [];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      source: "ai",
      note: "改过的笔记内容",
      excerpt: "这个章节讲了什么？",
    });
    // AI 笔记没有 CFI。
    expect(annotations[0]!.cfi).toBeUndefined();
  });

  it("空会话没有入口；回复在途时「存为笔记」出现但禁用", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    let resolveChat!: (v: { text: string; sessionId: string }) => void;
    vi.mocked(acpxChat).mockImplementation(async (opts) => {
      // 先到一部分正文，回复挂起不结束。
      opts.onDelta?.("正在生成的一部分回复");
      return new Promise((resolve) => {
        resolveChat = resolve;
      });
    });
    render(<ChatPanel book={BOOK} onClose={() => {}} />);

    // 空会话没有助手回复：没有入口。
    expect(
      screen.queryByRole("button", { name: "存为笔记" }),
    ).not.toBeInTheDocument();

    await sendMessage("在吗");

    // 正文块到达即出现入口，但回复在途：禁用。
    const button = await eventually(() =>
      screen.getByRole("button", { name: "存为笔记" }),
    );
    expect(button).toBeDisabled();

    resolveChat({ text: "正在生成的一部分回复", sessionId: "sess_note" });
    await eventually(() => expect(button).toBeEnabled());
  });
});
