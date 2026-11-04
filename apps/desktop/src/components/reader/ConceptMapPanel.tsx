import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ReaderOverlay } from "@/components/reader/ReaderOverlay";
import { RefreshCw, Sparkles, X } from "lucide-react";
import {
  buildConceptMapPrompt,
  layoutConceptMap,
  parseConceptMap,
  type ConceptMapData,
} from "@/lib/ai/conceptMap";
import { buildPrompt } from "@/lib/ai/readingContext";
import { acpxChat, isTauriRuntime } from "@/lib/ai/claudeBackend";
import { useConceptMapStore } from "@/store/conceptMapStore";
import { cn } from "@/lib/utils";

/**
 * 章节概念地图面板（R2）：生成当前章节的关键概念关系图（手写 SVG 环形布局），
 * 结果按「书 + 章」缓存，重开不重新生成，可手动重新生成。
 * 浏览器预览（无 Tauri 后端）用固定演示数据走完整渲染路径。
 */

/** 浏览器预览的演示地图，让无后端也能看到渲染与交互。 */
const DEMO_MAP: ConceptMapData = {
  nodes: [
    { id: "n1", label: "工作记忆", summary: "容量有限，负责当下加工" },
    { id: "n2", label: "长期记忆", summary: "知识的持久仓库" },
    { id: "n3", label: "提取练习", summary: "主动回忆比重读更有效" },
    { id: "n4", label: "间隔重复", summary: "把复习摊开在时间上" },
    { id: "n5", label: "遗忘曲线", summary: "记忆随时间衰减的规律" },
  ],
  edges: [
    { from: "n1", to: "n2", label: "编码进" },
    { from: "n3", to: "n2", label: "强化" },
    { from: "n4", to: "n5", label: "对抗" },
    { from: "n5", to: "n2", label: "约束" },
  ],
};

type ConceptMapPhase =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: ConceptMapData; generatedAt: number }
  | { status: "error"; message: string };

const NODE_RADIUS = 30;

type ConceptMapPanelProps = {
  /** 开合由父级持有；关闭时保留挂载，好播 150ms 退场。 */
  open?: boolean;
  /** navigation 关闭时立即摘除。 */
  immediate?: boolean;
  bookId: string;
  bookTitle: string;
  /** 章节标识（缓存 key 的一半），如 "sec:3"。 */
  chapterKey: string;
  chapterTitle: string | null;
  /** 取当前章节可读正文；返回 null 表示抽不出（图片书等），走错误兜底。 */
  getChapterText: () => Promise<string | null>;
  onClose: () => void;
};

export function ConceptMapPanel({
  open = true,
  immediate = false,
  bookId,
  bookTitle,
  chapterKey,
  chapterTitle,
  getChapterText,
  onClose,
}: ConceptMapPanelProps) {
  const load = useConceptMapStore((s) => s.load);
  const save = useConceptMapStore((s) => s.save);
  const [phase, setPhase] = useState<ConceptMapPhase>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tauri] = useState(() => isTauriRuntime());

  
  // 打开面板或切章时重置：渲染期比对 key 调整状态（React 推荐做法），
  // 避免 effect 内同步 setState；重挂载时初值本就是 idle/null，天然幂等。
  const panelKey = `${bookId}\u0000${chapterKey}`;
  const [prevPanelKey, setPrevPanelKey] = useState(panelKey);
  if (prevPanelKey !== panelKey) {
    setPrevPanelKey(panelKey);
    setPhase({ status: "idle" });
    setSelectedId(null);
  }

  // 打开面板时先查缓存：有就直接展示，没有停在「未生成」。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
      const cached = useConceptMapStore.getState().get(bookId, chapterKey);
      if (cached) {
        setPhase({
          status: "ready",
          data: { nodes: cached.nodes, edges: cached.edges },
          generatedAt: cached.createdAt,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterKey, load, open]);

  const generate = useCallback(async () => {
    setSelectedId(null);
    setPhase({ status: "loading" });
    try {
      let data: ConceptMapData | null;
      if (!tauri) {
        data = DEMO_MAP;
      } else {
        const chapterText = await getChapterText();
        if (!chapterText) {
          setPhase({
            status: "error",
            message: "这一章没有可读正文（图片书或空章节），生成不了概念地图。",
          });
          return;
        }
        const prompt = buildPrompt(buildConceptMapPrompt(chapterText).prompt, {
          bookTitle,
          chapterTitle,
          progress: null,
        });
        // 概念地图不走聊天面板：用「书 + 章」稳定的线程 id 映射 acpx 命名会话，
        // 每次生成都开新会话（resumeSessionId 恒空，模型不需要上一轮上下文）。
        const result = await acpxChat({
          prompt,
          messageId: `conceptmap_${Date.now()}`,
          threadId: `conceptmap-${bookId}-${chapterKey}`,
          resumeSessionId: null,
          onDelta: () => undefined,
        });
        data = parseConceptMap(result.text);
        if (!data) {
          setPhase({
            status: "error",
            message: "这次没能生成有效的概念地图（模型输出解析失败），请重试一次。",
          });
          return;
        }
      }
      save(bookId, chapterKey, data);
      setPhase({ status: "ready", data, generatedAt: Date.now() });
    } catch (err) {
      setPhase({
        status: "error",
        message: `生成失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [bookId, bookTitle, chapterKey, chapterTitle, getChapterText, save, tauri]);

  const selected =
    phase.status === "ready"
      ? (phase.data.nodes.find((n) => n.id === selectedId) ?? null)
      : null;
  // 换章即换 key，缓存查不到就回到未生成；布局随数据即时重算。
  const layout =
    phase.status === "ready"
      ? layoutConceptMap(phase.data.nodes, phase.data.edges, 600, 400)
      : null;

  return (
    <ReaderOverlay
      open={open}
      immediate={immediate}
      exit="panel"
      variant="scale"
      ariaLabel="章节概念地图"
      className="border-border bg-background inset-4 flex flex-col rounded-lg border shadow-md"
      closeOnOutside
      onClose={onClose}
    >
      <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">本章概念地图</p>
          <p className="text-muted-foreground truncate text-xs">
            {chapterTitle ?? bookTitle}
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
            aria-label="关闭概念地图"
            className="text-muted-foreground hover:text-foreground rounded p-0.5"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto p-2">
        {phase.status === "idle" ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <Sparkles className="size-6" aria-hidden="true" />
            <p className="text-sm">
              还没有这一章的概念地图。生成后会把本章的关键概念和关系画成一张图，
              下次打开直接看，不用重新生成。
            </p>
            <button
              type="button"
              data-testid="concept-map-generate"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-1.5 text-sm transition-colors"
              onClick={() => void generate()}
            >
              生成本章概念地图
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
            正在读这一章、提炼概念…
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

        {phase.status === "ready" && layout ? (
          <svg
            data-testid="concept-map-svg"
            viewBox="0 0 600 400"
            className="h-full max-h-full w-full"
            role="img"
            aria-label={`本章概念地图，${phase.data.nodes.length} 个概念、${phase.data.edges.length} 条关系`}
          >
            {layout.edges.map((edge, i) => {
              // 线段从圆边画到圆边：沿方向收缩一个半径，不压在圆下面。
              const dx = edge.to.x - edge.from.x;
              const dy = edge.to.y - edge.from.y;
              const len = Math.hypot(dx, dy) || 1;
              const x1 = edge.from.x + (dx / len) * NODE_RADIUS;
              const y1 = edge.from.y + (dy / len) * NODE_RADIUS;
              const x2 = edge.to.x - (dx / len) * NODE_RADIUS;
              const y2 = edge.to.y - (dy / len) * NODE_RADIUS;
              return (
                <g key={i} className="deer-edge-in">
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className="stroke-border"
                    strokeWidth={1.5}
                  />
                  {edge.label ? (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 4}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px]"
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {phase.data.nodes.map((node, index) => {
              const pos = layout.positions[node.id];
              if (!pos) return null;
              const selectedNode = node.id === selectedId;
              return (
                <g
                  key={node.id}
                  className="deer-node-in cursor-pointer"
                  style={
                    {
                      "--deer-index": index < 12 ? index : 0,
                    } as CSSProperties
                  }
                  onClick={() => setSelectedId(selectedNode ? null : node.id)}
                >
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={NODE_RADIUS}
                    className={cn(
                      "fill-card stroke-border transition-[stroke] duration-fast ease-enter",
                      selectedNode && "stroke-primary",
                    )}
                    strokeWidth={selectedNode ? 2.5 : 1.5}
                  />
                  <text
                    x={pos.x}
                    y={pos.y + NODE_RADIUS + 14}
                    textAnchor="middle"
                    className={cn(
                      "fill-foreground text-[11px] transition-colors duration-fast ease-enter",
                      selectedNode && "fill-primary font-medium",
                    )}
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>

      <div
        className="border-border text-muted-foreground min-h-10 shrink-0 border-t px-4 py-2 text-xs leading-relaxed"
        data-testid="concept-map-detail"
      >
        {selected ? (
          selected.summary ? (
            <p>
              <span className="text-foreground font-medium">
                {selected.label}
              </span>
              ：{selected.summary}
            </p>
          ) : (
            <p>
              <span className="text-foreground font-medium">{selected.label}</span>
              ：模型没有给出这一概念的说明。
            </p>
          )
        ) : phase.status === "ready" ? (
          <p>点击节点查看概念说明。</p>
        ) : (
          <p>
            {tauri
              ? "概念地图由你本机的 Claude Code 按当前章节生成。"
              : "浏览器预览：没有 Tauri 后端。"}
          </p>
        )}
      </div>
    </ReaderOverlay>
  );
}
