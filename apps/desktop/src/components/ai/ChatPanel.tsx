import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { ArrowUp, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { MOCK_DELAY, mockReply } from "@/lib/ai/mockReply";
import { buildPrompt, type ReadingContext } from "@/lib/ai/readingContext";
import { acpxChat, isTauriRuntime } from "@/lib/ai/claudeBackend";
import { useAcpxEnvStatus } from "@/lib/ai/useAcpxEnvStatus";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { Badge } from "@/components/ui/badge";
import type { CurrentBook } from "@/lib/ai/currentBook";
import { ChatBookCard } from "@/components/ai/ChatBookCard";
import { useChatStore } from "@/store/chatStore";

/** 从 composer 提交的消息里抽出纯文本。 */
function extractText(message: { content: readonly unknown[] }): string {
  return message.content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const p = part as { type?: unknown; text?: unknown };
      return p.type === "text" ? String(p.text ?? "") : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function TextPart({ text }: { text: string }) {
  return (
    <>
      <span className="whitespace-pre-wrap">{text}</span>
      <MessagePartPrimitive.InProgress>
        <span className="ml-0.5 inline-block animate-pulse">▍</span>
      </MessagePartPrimitive.InProgress>
    </>
  );
}

/** 深度思考过程：默认折叠的 details，点开看全文。 */
function ReasoningPart({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <details
      className="border-border bg-secondary/40 mb-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground"
      data-testid="thinking-block"
    >
      <summary className="cursor-pointer select-none">深度思考</summary>
      <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{text}</p>
    </details>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-3 flex justify-end">
      <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm leading-relaxed shadow-sm">
        <MessagePrimitive.Parts components={{ Text: TextPart }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function FeedbackButton({
  direction,
}: {
  direction: "up" | "down";
}) {
  const Icon = direction === "up" ? ThumbsUp : ThumbsDown;
  const Primitive =
    direction === "up"
      ? ActionBarPrimitive.FeedbackPositive
      : ActionBarPrimitive.FeedbackNegative;

  return (
    <Primitive
      aria-label={direction === "up" ? "有帮助" : "没帮助"}
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors",
        "aria-pressed:text-primary data-[submitted]:text-primary",
        "aria-pressed:bg-accent data-[submitted]:bg-accent",
      )}
    >
      <Icon className="size-3.5" />
    </Primitive>
  );
}

/** 书架工具书单的 data part 渲染：书卡列表，点击直接开书。 */
function BooksData({ data }: { data: { books: ChatMessage["books"] } }) {
  const books = data?.books ?? [];
  if (!books.length) return null;
  return (
    <div data-testid="chat-books" className="mt-2 flex flex-col gap-1.5">
      {books.map((book) => (
        <ChatBookCard key={book.id} book={book} />
      ))}
    </div>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="mb-4">
      <div className="bg-card text-card-foreground border-border max-w-[92%] rounded-2xl rounded-bl-sm border px-3.5 py-2.5 text-sm leading-relaxed shadow-sm">
        <MessagePrimitive.Parts
          components={{
            Text: TextPart,
            Reasoning: ReasoningPart,
            data: { by_name: { books: BooksData } },
          }}
        />
      </div>
      <ActionBarPrimitive.Root className="mt-1 ml-1 flex items-center gap-0.5">
        <FeedbackButton direction="up" />
        <FeedbackButton direction="down" />
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function EmptyState({ book }: { book: CurrentBook }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <GradientHeading size="xxs" weight="semi" className="mb-2">
        和《{book.title}》聊聊
      </GradientHeading>
      <p className="text-muted-foreground text-xs leading-relaxed">
        划线、提问、让它解释某一段。当前会话只属于这本书，
        切换到别的书会打开它自己的对话。
      </p>
    </div>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="border-border bg-background border-t p-3">
      <div className="border-input bg-card focus-within:border-ring/60 flex items-end gap-2 rounded-xl border p-2 transition-colors">
        <ComposerPrimitive.Input
          rows={1}
          placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
          className="placeholder:text-muted-foreground max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none"
        />
        <ComposerPrimitive.Send asChild>
          <Button size="icon" className="size-8 shrink-0 rounded-lg" aria-label="发送">
            <ArrowUp className="size-4" />
          </Button>
        </ComposerPrimitive.Send>
      </div>
      <p className="text-muted-foreground mt-2 text-[11px]">
        {isTauriRuntime()
          ? "回复由你本机的 Claude Code 生成，深度思考常开，仅在本机运行。"
          : "未接入后端（浏览器预览），发送后返回的是本地演示回复。"}
      </p>
    </ComposerPrimitive.Root>
  );
}

export type ChatPanelDraft = {
  /** 预填到输入框的完整草稿（划选引用 + 提问引导）。 */
  text: string;
  /** 每次新草稿换新 id，驱动输入框重填同一段内容。 */
  id: number;
};

/** 章节总结等外部入口通过 ref 调用：prompt 发给 claude，气泡显示 displayText。 */
export type ChatPanelHandle = {
  send: (prompt: string, displayText?: string) => void;
};

/** 划选/总结等入口预填输入框：只改 composer 文本，不自动发送。 */
function ComposerPreset({ draft }: { draft: ChatPanelDraft }) {
  const aui = useAui();
  useEffect(() => {
    aui.composer.setText(draft.text);
  }, [aui, draft]);
  return null;
}

type PanelPhase = "entering" | "open" | "closing" | "closed";

export function ChatPanel({
  book,
  onClose,
  open = true,
  onExited,
  className,
  readingContext,
  draft,
  ref,
}: {
  book: CurrentBook;
  onClose: () => void;
  /** 侧栏开合：布局瞬时（宽度不参与过渡），内容带方向进出（200ms 入 / 150ms 出）。 */
  open?: boolean;
  /** 关闭动画播完（约 150ms）后通知外部摘除；只关不摘的宿主可忽略。 */
  onExited?: () => void;
  className?: string;
  /** 阅读上下文（N1）：每条消息的 prompt 前自动附带书名/章节/进度。 */
  readingContext?: ReadingContext | null;
  /** 外部入口预填输入框（划选问 Deer 等）；id 变化即重填。 */
  draft?: ChatPanelDraft | null;
  ref?: React.Ref<ChatPanelHandle>;
}) {
  const ready = useChatStore((s) => s.ready);
  const threads = useChatStore((s) => s.threads);
  const messagesByThread = useChatStore((s) => s.messages);
  const activeThreadId = useChatStore((s) => s.activeThreadByBook[book.id]);
  const feedback = useChatStore((s) => s.feedback);
  const load = useChatStore((s) => s.load);
  const ensureThread = useChatStore((s) => s.ensureThread);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setFeedback = useChatStore((s) => s.setFeedback);
  const clearThread = useChatStore((s) => s.clearThread);

  // presence 状态机：entering → open → closing → closed（closed 才允许宿主摘除）。
  // 用渲染期派生而不是 effect，避免关闭瞬间先被 display:none 掉、退场看不见。
  const [wasOpen, setWasOpen] = useState(open);
  const [phase, setPhase] = useState<PanelPhase>(
    open ? "entering" : "closed",
  );
  // 打断入场/退场时先「按住」旧动画类，layout effect 里读到当前画面、
  // 把起点写进 CSS 变量后再换类——渲染期不碰 DOM，也永远不出自然态帧。
  const [heldClass, setHeldClass] = useState<string | null>(null);
  // 打断时接续当前画面的起点；关键帧默认值只用于从零开始的那一次。
  const [startStyle, setStartStyle] = useState<React.CSSProperties>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  const exitRafRef = useRef<number | null>(null);

  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      // 入场未播完就关闭：从当前不透明度接着淡出，不跳到 from 的 opacity:1。
      if (phase === "entering") setHeldClass("deer-panel-in");
      setPhase("closing");
    } else if (phase === "closing") {
      // 退场途中又被打开：取消摘除，从当前状态平滑转回，不从 12px 重起。
      setHeldClass("deer-panel-out");
      setPhase("entering");
    } else {
      setStartStyle({});
      setPhase("entering");
    }
  }

  const exiting = phase === "closing";
  const visible = open || exiting;
  // 可见时永远挂着一条动画类：空 class 等于元素落回自然态（opacity 1 / 原位）。
  const contentAnimation =
    heldClass ??
    (phase === "closing"
      ? "deer-panel-out"
      : phase === "entering"
        ? "deer-panel-in"
        : "deer-panel-open");

  // 换类前读当前画面：此刻 DOM 仍挂着旧动画类，读到的是真实进度值。
  useLayoutEffect(() => {
    if (!heldClass) return;
    // 退场被打断时摘除用的 rAF 可能还挂着，先取消再接管画面。
    if (exitRafRef.current !== null) {
      cancelAnimationFrame(exitRafRef.current);
      exitRafRef.current = null;
    }
    const el = contentRef.current;
    if (el && typeof getComputedStyle === "function") {
      const cs = getComputedStyle(el);
      setStartStyle({
        "--panel-start-opacity": cs.opacity || "1",
        "--panel-start-transform": cs.transform || "none",
      } as React.CSSProperties);
    }
    setHeldClass(null);
  }, [heldClass]);

  const handleContentAnimationEnd = (
    event: React.AnimationEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (phase === "entering") {
      setStartStyle({});
      setPhase("open");
      return;
    }
    if (phase !== "closing") return;
    // 退场最后一帧由 fill-mode 粘住；下一帧才落定为 closed，
    // 保证摘除/折叠与「无动画类」落在同一次提交里。
    exitRafRef.current = requestAnimationFrame(() => {
      exitRafRef.current = null;
      setPhase("closed");
      onExited?.();
    });
  };

  useEffect(
    () => () => {
      if (exitRafRef.current !== null) {
        cancelAnimationFrame(exitRafRef.current);
        exitRafRef.current = null;
      }
    },
    [],
  );

  const [replying, setReplying] = useState(false);
  // replying 的 ref 镜像：命令式发送入口（章节总结等）不经 React 状态判并发。
  const replyingRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 阅读上下文经 ref 读取：relocate 会高频更新 progress，
  // 若进依赖会让 sendUserMessage/onNew 的闭包频繁失效。
  const ctxRef = useRef<ReadingContext | null>(null);
  useEffect(() => {
    ctxRef.current = readingContext ?? null;
  }, [readingContext]);
  // 运行时环境整个会话不会变，取一次即可。
  const [tauri] = useState(() => isTauriRuntime());
  // acpx 环境自检结果：进入聊天即查（acpx 是唯一链路），失败只提示不拦发送
  // （Rust 侧 acpx_chat 自带同样的检查与指引）。设置页共用同一份检测逻辑。
  const { status: envStatus } = useAcpxEnvStatus(tauri);

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  // 当前书没有会话就建一个；切书时 activeThreadId 跟着 book.id 走，天然隔离。
  useEffect(() => {
    if (!ready) return;
    ensureThread(book.id, book.title);
  }, [ready, book.id, book.title, ensureThread]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const thread = (threads[book.id] ?? []).find((t) => t.id === activeThreadId);
  const messages: ChatMessage[] = thread
    ? (messagesByThread[thread.id] ?? [])
    : [];

  const currentThreadId = useCallback(
    () =>
      useChatStore.getState().activeThreadByBook[book.id] ??
      useChatStore.getState().ensureThread(book.id, book.title).id,
    [book.id, book.title],
  );

  // 发送一条消息：displayText 进用户气泡，claudePrompt 才是发给 claude 的
  // 完整 prompt（N1 上下文注入后两者不再相同，章节总结也复用这条通路）。
  const sendUserMessage = useCallback(
    async (claudePrompt: string, displayText: string) => {
      if (replyingRef.current || !claudePrompt.trim()) return;
      const threadId = currentThreadId();
      appendMessage(threadId, "user", displayText);
      replyingRef.current = true;
      setReplying(true);

      // 浏览器预览（无 Tauri 后端）：写死的演示回复，不联网。
      if (!tauri) {
        const timer = setTimeout(() => {
          appendMessage(threadId, "assistant", mockReply(claudePrompt));
          replyingRef.current = false;
          setReplying(false);
          timers.current = timers.current.filter((t) => t !== timer);
        }, MOCK_DELAY);
        timers.current.push(timer);
        return;
      }

      // 桌面端：走 acpx 连接层（唯一链路），会话按线程命名（deer-<threadId>），
      // acpx 负责跨进程恢复；Deer 只存 ACP session id，NO_SESSION 时回传给它
      // 接回旧会话。深度思考恒开（Rust 侧每轮注入 MAX_THINKING_TOKENS）。
      const assistant = appendMessage(threadId, "assistant", "");
      const state = useChatStore.getState();
      try {
        const result = await acpxChat({
          prompt: claudePrompt,
          messageId: assistant.id,
          threadId,
          resumeSessionId: state.acpxSessionByThread[threadId] ?? null,
          onDelta: (delta) => {
            useChatStore.getState().appendToMessage(threadId, assistant.id, delta);
          },
          onThoughtDelta: (delta) => {
            useChatStore
              .getState()
              .appendToMessageThinking(threadId, assistant.id, delta);
          },
          onBooks: (books) => {
            useChatStore
              .getState()
              .appendToMessageBooks(threadId, assistant.id, books);
          },
        });
        useChatStore.getState().setAcpxSession(threadId, result.sessionId);
        // 以 Rust 侧累计的完整正文为准落库（含持久化）。
        useChatStore
          .getState()
          .setMessageContent(threadId, assistant.id, result.text);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        useChatStore
          .getState()
          .setMessageContent(threadId, assistant.id, `（出错了）${reason}`);
      } finally {
        replyingRef.current = false;
        setReplying(false);
      }
    },
    [appendMessage, book.id, currentThreadId, tauri],
  );

  const send = useCallback(
    (prompt: string, displayText?: string) => {
      void sendUserMessage(prompt, displayText ?? prompt);
    },
    [sendUserMessage],
  );
  useImperativeHandle(ref, () => ({ send }), [send]);

  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages,
    isRunning: replying,
    // 回复在途时禁用发送：连续发送会起两个 ACP 子进程、共写同一份
    // claude 会话状态，导致空气泡挂起。只禁发送，不禁输入框。
    isSendDisabled: replying,
    convertMessage: (m) => ({
      id: m.id,
      role: m.role,
      // 深度思考：thinking 作为 reasoning 部件放在正文前，渲染成折叠块；
      // 书单作为 data part（name=books）由 BooksData 渲染成书卡。
      content: [
        ...(m.role === "assistant" && m.thinking
          ? [{ type: "reasoning" as const, text: m.thinking }]
          : []),
        { type: "text" as const, text: m.content },
        ...(m.role === "assistant" && m.books?.length
          ? [
              {
                type: "data" as const,
                name: "books",
                data: { books: m.books },
              },
            ]
          : []),
      ],
      createdAt: new Date(m.createdAt),
      metadata: feedback[m.id]
        ? {
            submittedFeedback: {
              type: feedback[m.id] === "up" ? "positive" : "negative",
            },
          }
        : undefined,
    }),
    onNew: async (message) => {
      const text = extractText(message);
      if (!text) return;
      const prompt = buildPrompt(
        text,
        ctxRef.current ?? { bookTitle: book.title },
      );
      await sendUserMessage(prompt, text);
    },
    adapters: {
      feedback: {
        submit: ({ message, type }) => {
          setFeedback(message.id, type === "positive" ? "up" : "down");
        },
      },
    },
  });

  const handleClear = () => {
    if (thread) clearThread(thread.id);
  };

  return (
    <aside
      aria-label="AI 伴读"
      aria-hidden={open ? undefined : true}
      className={cn(
        "bg-background border-border w-96 shrink-0 flex-col overflow-hidden border-l",
        // 退场动画期间保持布局占位，播完才折叠；宽度始终不参与过渡。
        // overflow-hidden：入场/退场的内容侧移只在本盒内裁掉，不越出到滚动祖先，
        // 否则阅读页的 main 会因为它多出的 12px 闪出横向滚动条。
        visible ? "flex" : "hidden",
        exiting && "pointer-events-none",
        className,
      )}
    >
      <div
        ref={contentRef}
        className={cn("flex h-full min-h-0 flex-col", contentAnimation)}
        style={startStyle}
        onAnimationEnd={handleContentAnimationEnd}
      >
      <header className="border-border flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <GradientHeading size="xxs" weight="semi" className="pb-0">
            AI 伴读
          </GradientHeading>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {book.title}
          </p>
        </div>
        <Badge variant="secondary" className="mt-1 shrink-0 text-[11px]">
          {tauri ? "acpx · Claude" : "未接后端（浏览器预览）"}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="清空当前会话"
          onClick={handleClear}
        >
          <Trash2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="关闭面板"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="bg-secondary/60 text-secondary-foreground border-border border-b px-4 py-2 text-[11px] leading-relaxed">
        {tauri ? (
          <p
            data-testid="acpx-env-note"
            className={cn(
              envStatus && !envStatus.ok ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {envStatus
              ? envStatus.ok
                ? "acpx 连接层：会话由 acpx 管理，每个会话线程独立命名并跨进程恢复，深度思考常开。"
                : envStatus.message
              : "正在检查 acpx 环境…"}
          </p>
        ) : (
          "浏览器预览：没有 Tauri 后端，回复是写死的占位文本，不会联网。"
        )}
      </div>

      <AssistantRuntimeProvider runtime={runtime}>
        {draft ? <ComposerPreset key={draft.id} draft={draft} /> : null}
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <ThreadPrimitive.Empty>
              <EmptyState book={book} />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
            {replying && (
              <p className="text-muted-foreground mb-3 ml-1 text-xs">正在输入…</p>
            )}
          </ThreadPrimitive.Viewport>
          <Composer />
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
      </div>
    </aside>
  );
}
