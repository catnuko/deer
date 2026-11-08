import { useCallback, useEffect, useState } from "react";
import { ReaderOverlay } from "@/components/reader/ReaderOverlay";
import { Compass, RefreshCw, X } from "lucide-react";
import {
  buildBookBriefingPrompt,
  parseBookBriefing,
  type BookBriefingData,
} from "@/lib/ai/bookBriefing";
import { buildPrompt } from "@/lib/ai/readingContext";
import { acpxChat, acpxEnvCheck } from "@/lib/ai/claudeBackend";
import { resolveEngine } from "@/lib/ai/engineRouter";
import { runCloudOnce } from "@/lib/ai/cloudEngine";
import { isTauri } from "@/lib/platform";
import { useAppSettings } from "@/store/appSettings";
import { useBookBriefingStore } from "@/store/bookBriefingStore";

/**
 * 开读简报面板：读一本书之前，用 AI 生成一张「全书骨架」卡——心智模型、
 * 章节地图、核心概念。结果按书缓存，重开不重新生成，可手动重新生成。
 * 生成管线与章节概念地图同构（R2）：本地引擎走 acpx 一次性会话，
 * 云引擎走 runCloudOnce；浏览器预览（无 Tauri 后端）用固定演示数据。
 */

/** 浏览器预览的演示简报，让无后端也能看到渲染与交互。 */
const DEMO_BRIEFING: BookBriefingData = {
  mentalModel:
    "这本书围绕「注意力如何被劫持」展开：先给出分心的现状与代价，再拆解商业产品的设计动机，最后给出一套可操作的对抗策略。整体是「现象—机制—对策」的三段式论证。",
  chapters: [
    { title: "第一章 深度工作", note: "定义问题：分心正在吃掉产出。" },
    { title: "第二章 诱因设计", note: "解释机制：产品如何争夺注意力。" },
    { title: "第三章 对抗策略", note: "给出对策：把注意力收回来。" },
  ],
  concepts: [
    { term: "深度工作", note: "无干扰、高专注的产出状态" },
    { term: "诱因设计", note: "产品为留存而做的心理钩子" },
    { term: "注意力残余", note: "切换任务后残留的认知负担" },
  ],
};

type BriefingPhase =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: BookBriefingData; generatedAt: number }
  | { status: "error"; message: string };

type BookBriefingPanelProps = {
  /** 开合由父级持有；关闭时保留挂载，好播 150ms 退场。 */
  open?: boolean;
  /** navigation 关闭时立即摘除。 */
  immediate?: boolean;
  bookId: string;
  bookTitle: string;
  /** 目录标题（章节地图的参照系）；无目录时允许为空数组。 */
  chapterTitles: string[];
  /** 抽全书可读正文；返回 null 表示抽不出（图片书等），走错误兜底。 */
  getBookText: () => Promise<string | null>;
  onClose: () => void;
};

export function BookBriefingPanel({
  open = true,
  immediate = false,
  bookId,
  bookTitle,
  chapterTitles,
  getBookText,
  onClose,
}: BookBriefingPanelProps) {
  const load = useBookBriefingStore((s) => s.load);
  const save = useBookBriefingStore((s) => s.save);
  const [phase, setPhase] = useState<BriefingPhase>({ status: "idle" });
  const [tauri] = useState(() => isTauri());

  // 打开面板时先查缓存：有就直接展示，没有停在「未生成」。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
      const cached = useBookBriefingStore.getState().get(bookId);
      if (cached) {
        setPhase({
          status: "ready",
          data: {
            mentalModel: cached.mentalModel,
            chapters: cached.chapters,
            concepts: cached.concepts,
          },
          generatedAt: cached.createdAt,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, load, open]);

  const generate = useCallback(async () => {
    setPhase({ status: "loading" });
    try {
      let data: BookBriefingData | null;
      if (!tauri) {
        data = DEMO_BRIEFING;
      } else {
        const bookText = await getBookText();
        if (!bookText) {
          setPhase({
            status: "error",
            message:
              "这本书没有可读正文（图片书或抽不出文本），生成不了开读简报。",
          });
          return;
        }
        const prompt = buildPrompt(
          buildBookBriefingPrompt(bookText, chapterTitles).prompt,
          { bookTitle, chapterTitle: null, progress: null },
        );
        // 简报不走聊天面板：一次性生成（无历史）。引擎先路由——
        // 本地经 acpx 开「书」稳定命名的新会话；云走 runCloudOnce，
        // system 与上下文都压在 prompt 里（沿用 N1 的 buildPrompt）。
        const mode = useAppSettings.getState().aiEngineMode;
        const localAvailable =
          mode === "local"
            ? true
            : mode === "cloud"
              ? false
              : (await acpxEnvCheck()).ok;
        if (resolveEngine(mode, localAvailable) === "local") {
          const result = await acpxChat({
            prompt,
            messageId: `briefing_${Date.now()}`,
            threadId: `briefing-${bookId}`,
            resumeSessionId: null,
            onDelta: () => undefined,
          });
          data = parseBookBriefing(result.text);
        } else {
          const text = await runCloudOnce({
            system: `你是电子书伴读助手，为《${bookTitle}》生成开读简报。`,
            prompt,
          });
          data = parseBookBriefing(text);
        }
        if (!data) {
          setPhase({
            status: "error",
            message: "这次没能生成有效的开读简报（模型输出解析失败），请重试一次。",
          });
          return;
        }
      }
      save(bookId, data);
      setPhase({ status: "ready", data, generatedAt: Date.now() });
    } catch (err) {
      setPhase({
        status: "error",
        message: `生成失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [bookId, bookTitle, chapterTitles, getBookText, save, tauri]);

  return (
    <ReaderOverlay
      open={open}
      immediate={immediate}
      exit="panel"
      variant="scale"
      modal
      role="dialog"
      ariaLabel="开读简报"
      // 与概念地图同规格：900×640，视口放不下时退回 94vw×86vh。
      className="border-border bg-background flex h-[640px] max-h-[86vh] w-[900px] max-w-[94vw] flex-col overflow-hidden rounded-lg border shadow-md"
      closeOnOutside
      onClose={onClose}
    >
      <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">开读简报</p>
          <p className="text-muted-foreground truncate text-xs">
            {bookTitle}
            {phase.status === "ready"
              ? ` · 生成于 ${new Date(phase.generatedAt).toLocaleString()}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {phase.status === "ready" || phase.status === "error" ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
              onClick={() => void generate()}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              重新生成
            </button>
          ) : null}
          <button
            type="button"
            aria-label="关闭开读简报"
            className="text-muted-foreground hover:text-foreground rounded p-0.5"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {phase.status === "idle" ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <Compass className="size-6" aria-hidden="true" />
            <p className="text-sm">
              还没有这本书的开读简报。生成后会给一张「全书骨架」卡：这本书要解决什么问题、
              每一章在全书中的作用、反复出现的核心概念。读厚书之前先看一眼，开读就有地图。
            </p>
            <button
              type="button"
              data-testid="briefing-generate"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-1.5 text-sm transition-colors"
              onClick={() => void generate()}
            >
              生成开读简报
            </button>
            {!tauri ? (
              <p className="text-[11px]">浏览器预览：生成的是演示数据。</p>
            ) : null}
          </div>
        ) : null}

        {phase.status === "loading" ? (
          <div
            className="text-muted-foreground flex h-full items-center justify-center text-sm"
            role="status"
          >
            正在读这本书、提炼全书骨架…
          </div>
        ) : null}

        {phase.status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-destructive text-sm">{phase.message}</p>
            <button
              type="button"
              className="border-input text-foreground hover:bg-accent rounded-md border px-4 py-1.5 text-sm"
              onClick={() => void generate()}
            >
              重试
            </button>
          </div>
        ) : null}

        {phase.status === "ready" ? (
          <div className="space-y-6">
            <section data-testid="briefing-mental-model">
              <h3 className="text-muted-foreground text-xs font-medium tracking-wide">
                全书骨架
              </h3>
              <p className="text-foreground mt-2 text-sm leading-relaxed">
                {phase.data.mentalModel}
              </p>
            </section>

            {phase.data.chapters.length > 0 ? (
              <section data-testid="briefing-chapters">
                <h3 className="text-muted-foreground text-xs font-medium tracking-wide">
                  章节地图
                </h3>
                <ol className="mt-2 space-y-2">
                  {phase.data.chapters.map((chapter, index) => (
                    <li
                      key={`${index}:${chapter.title}`}
                      className="border-border/60 flex gap-3 border-l pl-3 text-sm leading-relaxed"
                    >
                      <span className="text-foreground min-w-0 shrink-0 font-medium">
                        {chapter.title}
                      </span>
                      <span className="text-muted-foreground min-w-0">
                        {chapter.note}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {phase.data.concepts.length > 0 ? (
              <section data-testid="briefing-concepts">
                <h3 className="text-muted-foreground text-xs font-medium tracking-wide">
                  核心概念
                </h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {phase.data.concepts.map((concept) => (
                    <li
                      key={concept.term}
                      className="bg-muted/50 border-border/60 rounded-md border px-3 py-2 text-sm leading-relaxed"
                    >
                      <span className="text-foreground font-medium">
                        {concept.term}
                      </span>
                      <span className="text-muted-foreground">
                        ：{concept.note}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className="border-border text-muted-foreground min-h-10 shrink-0 border-t px-4 py-2 text-xs leading-relaxed"
        data-testid="briefing-footer"
      >
        <p>
          {tauri
            ? useAppSettings.getState().aiEngineMode === "cloud"
              ? "开读简报由云 API 模型按全书内容生成，只提炼结构，不复述原文。"
              : "开读简报由当前 AI 引擎按全书内容生成，只提炼结构，不复述原文。"
            : "浏览器预览：没有 Tauri 后端。"}
        </p>
      </div>
    </ReaderOverlay>
  );
}
