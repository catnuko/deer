import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { ArrowUp, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { MOCK_DELAY, mockReply } from "@/lib/ai/mockReply";
import { claudeChat, isTauriRuntime } from "@/lib/ai/claudeBackend";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { Badge } from "@/components/ui/badge";
import type { CurrentBook } from "@/lib/ai/currentBook";
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

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="mb-4">
      <div className="bg-card text-card-foreground border-border max-w-[92%] rounded-2xl rounded-bl-sm border px-3.5 py-2.5 text-sm leading-relaxed shadow-sm">
        <MessagePrimitive.Parts components={{ Text: TextPart }} />
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
          ? "回复由你本机的 Claude Code 生成，仅在本机运行。"
          : "未接入后端（浏览器预览），发送后返回的是本地演示回复。"}
      </p>
    </ComposerPrimitive.Root>
  );
}

export function ChatPanel({
  book,
  onClose,
  embedded = false,
  className,
}: {
  book: CurrentBook;
  onClose: () => void;
  /** 内联常驻侧栏模式（阅读页用）；默认 false = 书架/首页的 fixed 浮层。 */
  embedded?: boolean;
  className?: string;
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

  const [replying, setReplying] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 运行时环境整个会话不会变，取一次即可。
  const [tauri] = useState(() => isTauriRuntime());

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

  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages,
    isRunning: replying,
    convertMessage: (m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
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
      const threadId = currentThreadId();
      appendMessage(threadId, "user", text);
      setReplying(true);

      // 浏览器预览（无 Tauri 后端）：写死的演示回复，不联网。
      if (!tauri) {
        const timer = setTimeout(() => {
          appendMessage(threadId, "assistant", mockReply(text));
          setReplying(false);
          timers.current = timers.current.filter((t) => t !== timer);
        }, MOCK_DELAY);
        timers.current.push(timer);
        return;
      }

      // 桌面端：走本地 claude（ACP），同书追问续接上一轮会话上下文。
      const assistant = appendMessage(threadId, "assistant", "");
      const resumeSessionId =
        useChatStore.getState().claudeSessionByBook[book.id] ?? null;
      try {
        const result = await claudeChat({
          prompt: `你是《${book.title}》这本书的伴读助手。\n\n${text}`,
          messageId: assistant.id,
          resumeSessionId,
          onDelta: (delta) => {
            useChatStore.getState().appendToMessage(threadId, assistant.id, delta);
          },
        });
        // 以 Rust 侧累计的完整正文为准落库（含持久化）。
        useChatStore
          .getState()
          .setMessageContent(threadId, assistant.id, result.text);
        useChatStore
          .getState()
          .setClaudeSession(book.id, result.sessionId);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        useChatStore
          .getState()
          .setMessageContent(threadId, assistant.id, `（出错了）${reason}`);
      } finally {
        setReplying(false);
      }
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
      className={cn(
        "bg-background border-border flex flex-col border-l",
        embedded
          ? "w-96 shrink-0"
          : "fixed inset-y-0 right-0 z-40 w-[420px] max-w-full shadow-2xl",
        className,
      )}
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
          {tauri ? "本地 Claude Code" : "未接后端（浏览器预览）"}
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
        {tauri
          ? "本地 Claude Code (ACP)：回复由你本机的 claude CLI 生成，会话按书隔离，追问自动续接上下文。"
          : "浏览器预览：没有 Tauri 后端，回复是写死的占位文本，不会联网。"}
      </div>

      <AssistantRuntimeProvider runtime={runtime}>
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
    </aside>
  );
}
