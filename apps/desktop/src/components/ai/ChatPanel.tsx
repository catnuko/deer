import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { ArrowUp, NotebookPen, Sparkles, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { MOCK_DELAY, mockReply } from "@/lib/ai/mockReply";
import { buildSystemPrompt, type ReadingContext } from "@/lib/ai/readingContext";
import {
  buildBookSummaryPrompt,
  buildPageSummaryPrompt,
} from "@/lib/ai/bookSummary";
import { buildChapterSummaryPrompt } from "@/lib/ai/chapterSummary";
import { acpxChat, acpxEnvCheck } from "@/lib/ai/claudeBackend";
import {
  localUnavailableError,
  resolveEngine,
} from "@/lib/ai/engineRouter";
import { runCloudChat } from "@/lib/ai/cloudEngine";
import { isTauri } from "@/lib/platform";
import { useAppSettings } from "@/store/appSettings";
import { useAcpxEnvStatus } from "@/lib/ai/useAcpxEnvStatus";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { CurrentBook } from "@/lib/ai/currentBook";
import { ChatBookCard } from "@/components/ai/ChatBookCard";
import { useChatStore } from "@/store/chatStore";
import { AI_NOTE_COLOR, useAnnotationStore } from "@/store/annotationStore";

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

/** 助手消息存笔记需要的面板内能力：回复在途状态与落库动作。 */
const SaveNoteContext = createContext<{
  replying: boolean;
  saveNote: (assistantMessageId: string, note: string) => void;
} | null>(null);

/** 用户提问截前 120 字作为 AI 笔记的摘录（按码点，不切代理对）。 */
function excerptOf(text: string, limit = 120): string {
  return Array.from(text.trim()).slice(0, limit).join("");
}

function SaveNoteDialog({
  open,
  draft,
  onDraftChange,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: (note: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>总结为笔记</DialogTitle>
          <DialogDescription>
            保存后会出现在这本书的笔记列表里，来源标记为 AI 对话。
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="笔记内容"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          rows={8}
          className="max-h-64 overflow-y-auto text-[13px]"
        />
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={!draft.trim()}
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 助手消息操作条上的「总结为笔记」：弹小编辑框，确认后写入当前书的笔记列表。 */
function SaveNoteButton() {
  const ctx = useContext(SaveNoteContext);
  const messageId = useAuiState((s) => s.message.id);
  const content = useAuiState((s) => s.message.content);
  const messageText = useMemo(
    () =>
      content
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n\n"),
    [content],
  );
  const [open, setOpen] = useState(false);
  // 草稿放在这一层：打开瞬间用点击处理器重置为回复全文，不需要 effect。
  const [draft, setDraft] = useState("");
  if (!messageText.trim()) return null;

  return (
    <>
      <button
        type="button"
        aria-label="总结为笔记"
        title="总结为笔记"
        disabled={!ctx || ctx.replying}
        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50"
        onClick={() => {
          setDraft(messageText);
          setOpen(true);
        }}
      >
        <NotebookPen className="size-3.5" />
      </button>
      <SaveNoteDialog
        open={open}
        draft={draft}
        onDraftChange={setDraft}
        onOpenChange={setOpen}
        onSave={(note) => {
          if (messageId) ctx?.saveNote(messageId, note);
        }}
      />
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
        <SaveNoteButton />
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

/** 快捷指令：点击直接发送的问题按钮（输入区上方一排 chip）。 */
export type QuickCommand = {
  /** 返回要随问题一起发送的正文；null/缺省表示拿不到正文，只发问题本身。 */
  getText?: () => Promise<string | null>;
  /** false 时按钮置灰并显示 unavailableReason（如图片书无可读正文）。 */
  available?: boolean;
  unavailableReason?: string;
};

export type QuickCommands = {
  chapter?: QuickCommand;
  book?: QuickCommand;
  page?: QuickCommand;
};

const QUICK_COMMAND_LABELS: Record<keyof QuickCommands, string> = {
  chapter: "这个章节讲了什么？",
  book: "这本书说了什么？",
  page: "当前页讲了什么？",
};

const QUICK_COMMAND_ORDER: (keyof QuickCommands)[] = [
  "chapter",
  "book",
  "page",
];

function QuickCommandsBar({
  commands,
  disabled,
  onSelect,
}: {
  commands: QuickCommands;
  disabled: boolean;
  onSelect: (kind: keyof QuickCommands) => void;
}) {
  const items = QUICK_COMMAND_ORDER.filter((kind) => commands[kind]);
  if (items.length === 0) return null;

  return (
    <div
      data-testid="quick-commands"
      role="toolbar"
      aria-label="快捷指令"
      className="mb-2 flex gap-1.5 overflow-x-auto"
    >
      {items.map((kind) => {
        const command = commands[kind]!;
        const unavailable = command.available === false;
        return (
          <button
            key={kind}
            type="button"
            disabled={disabled || unavailable}
            title={unavailable ? (command.unavailableReason ?? "该格式不支持") : undefined}
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
            onClick={() => onSelect(kind)}
          >
            {QUICK_COMMAND_LABELS[kind]}
          </button>
        );
      })}
    </div>
  );
}

function Composer({
  quickCommands,
  onQuickSend,
  quickSendDisabled,
}: {
  quickCommands?: QuickCommands;
  onQuickSend: (kind: keyof QuickCommands) => void;
  quickSendDisabled: boolean;
}) {
  const aiEngineMode = useAppSettings((s) => s.aiEngineMode);
  return (
    <ComposerPrimitive.Root className="border-border bg-background border-t p-3">
      {quickCommands ? (
        <QuickCommandsBar
          commands={quickCommands}
          disabled={quickSendDisabled}
          onSelect={onQuickSend}
        />
      ) : null}
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
        {!isTauri()
          ? "未接入后端（浏览器预览），发送后返回的是本地演示回复。"
          : aiEngineMode === "cloud"
            ? "回复由云 API 模型生成；是否输出思考过程由所选模型决定。"
            : aiEngineMode === "local"
              ? "回复由你本机的 Claude Code 生成，深度思考常开，仅在本机运行。"
              : "本机引擎可用时走本地 Claude Code，否则自动改走云 API 模型。"}
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
  onSummarizeChapter,
  quickCommands,
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
  /** 「总结本章」显式动作（面板内快捷入口）；不提供则不显示。打开面板本身不发消息。 */
  onSummarizeChapter?: () => void;
  /** 输入区上方的快捷指令 chip（点击直接发送）；不提供则不显示。 */
  quickCommands?: QuickCommands;
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
  const [tauri] = useState(() => isTauri());
  const aiModel = useAppSettings((s) => s.aiModel);
  const aiEngineMode = useAppSettings((s) => s.aiEngineMode);
  // acpx 环境自检：进入聊天即查，结果决定 auto 模式走向与本地链路的提示；
  // 失败只提示不拦发送（Rust 侧 acpx_chat 自带同样的检查与指引）。
  const { status: envStatus } = useAcpxEnvStatus(tauri);
  // 徽标/说明按当前路由结果展示（auto 下随环境自检结果切换）。
  const displayEngine = resolveEngine(aiEngineMode, envStatus?.ok ?? null);

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

  // 发送一条消息：displayText 进用户气泡，claudePrompt 才是发给云引擎的
  // 完整内容（章节总结等入口会带正文）；system 在这里按阅读上下文组装。
  const sendUserMessage = useCallback(
    async (claudePrompt: string, displayText: string) => {
      if (replyingRef.current || !claudePrompt.trim()) return;
      const threadId = currentThreadId();
      // 历史在追加本轮提问前截取：prompt 单独随发，不重复计入。
      const history = useChatStore.getState().messages[threadId] ?? [];
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

      // 引擎路由：云引擎（AI SDK agent 循环）桌面/Android/iOS 通吃；
      // 本地走 acpx 连接层（会话按线程命名，acpx 负责跨进程恢复）。
      // auto 下自检未完成时现查一次（PATH 探测，毫秒级）再决定。
      const assistant = appendMessage(threadId, "assistant", "");
      const state = useChatStore.getState();
      try {
        const localAvailable =
          aiEngineMode === "local"
            ? true
            : aiEngineMode === "cloud"
              ? false
              : (envStatus?.ok ?? (await acpxEnvCheck()).ok);
        const engine = resolveEngine(aiEngineMode, localAvailable);
        if (engine === "local") {
          if (envStatus && !envStatus.ok) throw localUnavailableError(envStatus);
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
          state.setAcpxSession(threadId, result.sessionId);
          // 以 Rust 侧累计的完整正文为准落库（含持久化）。
          useChatStore
            .getState()
            .setMessageContent(threadId, assistant.id, result.text);
        } else {
          const result = await runCloudChat({
            system: buildSystemPrompt(ctxRef.current ?? { bookTitle: book.title }),
            prompt: claudePrompt,
            history,
            callbacks: {
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
            },
          });
          // 以累计正文落库（含持久化）；空回复兜底一句可读提示。
          useChatStore
            .getState()
            .setMessageContent(
              threadId,
              assistant.id,
              result.text || "（模型没有返回内容，请重试。）",
            );
        }
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
    [aiEngineMode, appendMessage, book.id, book.title, currentThreadId, envStatus, tauri],
  );

  const send = useCallback(
    (prompt: string, displayText?: string) => {
      void sendUserMessage(prompt, displayText ?? prompt);
    },
    [sendUserMessage],
  );
  useImperativeHandle(ref, () => ({ send }), [send]);

  // 快捷指令：取文本期间整条禁点（pendingCommand），发送后由 replying 接管。
  const [pendingCommand, setPendingCommand] = useState<keyof QuickCommands | null>(
    null,
  );
  const quickSend = useCallback(
    async (kind: keyof QuickCommands) => {
      const command = quickCommands?.[kind];
      if (!command || command.available === false) return;
      if (replyingRef.current || pendingCommand !== null) return;
      const question = QUICK_COMMAND_LABELS[kind];
      setPendingCommand(kind);
      try {
        const text = command.getText ? await command.getText() : null;
        let raw = question;
        if (text) {
          if (kind === "chapter") {
            raw = buildChapterSummaryPrompt(text).prompt;
          } else if (kind === "book") {
            raw = buildBookSummaryPrompt(text).prompt;
          } else {
            raw = buildPageSummaryPrompt(text).prompt;
          }
        }
        // 拿不到正文时只发问题本身：system 仍会带上书名/章节上下文，
        // AI 还能借助书架/书内工具作答。
        await sendUserMessage(raw, question);
      } finally {
        setPendingCommand(null);
      }
    },
    [pendingCommand, quickCommands, sendUserMessage],
  );

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
      await sendUserMessage(text, text);
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

  // 存 AI 笔记（需求：从对话总结出笔记）：note=回复全文，excerpt=用户提问
  // 截前 120 字，无 CFI、source=ai。按 assistantMessageId 反查它前面的提问。
  const saveNote = useCallback(
    (assistantMessageId: string, note: string) => {
      const trimmed = note.trim();
      if (!trimmed) return;
      const state = useChatStore.getState();
      const threadId = state.activeThreadByBook[book.id];
      if (!threadId) return;
      const list = state.messages[threadId] ?? [];
      const index = list.findIndex((m) => m.id === assistantMessageId);
      const previous = index > 0 ? list[index - 1] : undefined;
      const question =
        previous?.role === "user" ? excerptOf(previous.content) : "";
      useAnnotationStore.getState().add({
        bookId: book.id,
        color: AI_NOTE_COLOR,
        ...(question ? { excerpt: question } : {}),
        note: trimmed,
        source: "ai",
      });
    },
    [book.id],
  );
  const saveNoteContext = useMemo(
    () => ({ replying, saveNote }),
    [replying, saveNote],
  );

  return (
    <aside
      aria-label="AI 伴读"
      aria-hidden={open ? undefined : true}
      className={cn(
        "bg-background border-border w-96 shrink-0 flex-col overflow-hidden border-l",
        // <820px：固定宽度停靠列会挤没正文，退化为全屏覆盖层（脱离文档流盖住主区）。
        "max-[819px]:fixed max-[819px]:inset-0 max-[819px]:z-50 max-[819px]:w-full max-[819px]:border-l-0",
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
        <Badge variant="secondary" className="mt-1 shrink-0 text-[11px] max-[819px]:hidden">
          {!tauri
            ? "未接后端（浏览器预览）"
            : displayEngine === "local"
              ? "acpx · Claude"
              : `云引擎 · ${aiModel.trim() || "未配置模型"}`}
        </Badge>
        {onSummarizeChapter ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs"
            onClick={onSummarizeChapter}
          >
            <Sparkles className="size-3.5" />
            总结本章
          </Button>
        ) : null}
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
        {!tauri ? (
          <p className="text-muted-foreground">
            浏览器预览：没有 Tauri 后端，回复是写死的占位文本，不会联网。
          </p>
        ) : displayEngine === "local" ? (
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
          <p data-testid="cloud-engine-note" className="text-muted-foreground">
            {`回复由云 API 模型（${aiModel.trim() || "未配置模型"}）生成，书籍、对话与 API Key 都留在本机。未配置 Key 时发送会提示前往设置填写。`}
          </p>
        )}
      </div>

      <AssistantRuntimeProvider runtime={runtime}>
        <SaveNoteContext.Provider value={saveNoteContext}>
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
          <Composer
            quickCommands={quickCommands}
            onQuickSend={(kind) => void quickSend(kind)}
            quickSendDisabled={replying || pendingCommand !== null}
          />
        </ThreadPrimitive.Root>
        </SaveNoteContext.Provider>
      </AssistantRuntimeProvider>
      </div>
    </aside>
  );
}
