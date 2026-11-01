/**
 * 章节概念地图（R2）：取当前章节全文，让模型输出结构化 JSON
 * （节点 = 概念 + 一句话说明，边 = 关系短语），前端手写 SVG 布局渲染。
 * 纯函数便于单测：prompt 组装、输出解析兜底、环形布局。
 */
import { truncateChapterText } from "@/lib/ai/chapterSummary";

export type ConceptMapNode = {
  id: string;
  label: string;
  summary?: string;
};

export type ConceptMapEdge = {
  from: string;
  to: string;
  label?: string;
};

export type ConceptMapData = {
  nodes: ConceptMapNode[];
  edges: ConceptMapEdge[];
};

/** 节点数上限：图太大环形布局会挤成一团，也防模型跑飞。 */
export const MAX_CONCEPT_NODES = 16;

/** 章节全文带入 prompt 的字符上限（与章节总结共用截断逻辑）。 */
export const CONCEPT_MAP_CHAR_LIMIT = 30_000;

/**
 * 组装发给 claude 的概念地图 prompt（外层仍会套 N1 的书名/章节上下文）。
 * 要求只输出一个 JSON 对象，便于 parseConceptMap 解析。
 */
export function buildConceptMapPrompt(
  chapterText: string,
  limit: number = CONCEPT_MAP_CHAR_LIMIT,
): { prompt: string; truncated: boolean } {
  const { text, truncated } = truncateChapterText(chapterText, limit);
  const note = truncated
    ? `\n本章过长，以下只包含前 ${limit} 字符，概念地图基于这个范围。`
    : "";
  return {
    prompt: [
      "请根据下面这一章的内容，生成一张「本章概念地图」：把本章的关键概念提炼为节点，概念之间的关系为连线。",
      "只输出一个 JSON 对象，不要输出任何其他文字或代码块标记，格式如下：",
      '{"nodes":[{"id":"n1","label":"概念名","summary":"一句话说明"}],"edges":[{"from":"n1","to":"n2","label":"关系短语"}]}',
      "要求：节点 5 到 12 个，概念名 2 到 12 个字，说明用一句话；边两端必须引用节点 id；关系短语不超过 8 个字；没有把握的关系不要编。",
      ...note.split("\n").filter(Boolean),
      "",
      "以下是章节全文：",
      "",
      text,
    ].join("\n"),
    truncated,
  };
}

/**
 * 解析模型输出的概念地图 JSON，非法输入一律返回 null（调用方兜底提示，不崩）。
 * 容忍代码块围栏和 JSON 前后的闲话：取首个 { 到最后一个 } 之间再解析。
 */
export function parseConceptMap(raw: string): ConceptMapData | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { nodes: rawNodes, edges: rawEdges } = parsed as {
    nodes?: unknown;
    edges?: unknown;
  };
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) return null;

  const nodes: ConceptMapNode[] = [];
  const seenIds = new Set<string>();
  for (const item of rawNodes) {
    if (typeof item !== "object" || item === null) continue;
    const { id, label, summary } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) continue;
    if (typeof label !== "string" || !label.trim()) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    nodes.push({
      id,
      label: label.trim(),
      ...(typeof summary === "string" && summary.trim()
        ? { summary: summary.trim() }
        : {}),
    });
    if (nodes.length >= MAX_CONCEPT_NODES) break;
  }
  if (nodes.length === 0) return null;

  const edges: ConceptMapEdge[] = [];
  if (Array.isArray(rawEdges)) {
    for (const item of rawEdges) {
      if (typeof item !== "object" || item === null) continue;
      const { from, to, label } = item as Record<string, unknown>;
      if (typeof from !== "string" || typeof to !== "string") continue;
      // 端点不存在的边丢弃（模型编了不存在的 id 也不让它渲染成悬空线）。
      if (!seenIds.has(from) || !seenIds.has(to) || from === to) continue;
      edges.push({
        from,
        to,
        ...(typeof label === "string" && label.trim()
          ? { label: label.trim() }
          : {}),
      });
    }
  }
  return { nodes, edges };
}

export type ConceptMapLayout = {
  /** nodeId -> 圆心坐标（环形均布）。 */
  positions: Record<string, { x: number; y: number }>;
  /** 渲染直接可用的线段端点（两端都是节点圆心，画线时按半径截断交给 SVG 层）。 */
  edges: Array<{ from: { x: number; y: number }; to: { x: number; y: number }; label?: string }>;
  radius: number;
  center: { x: number; y: number };
};

/**
 * 环形布局：节点沿圆周均布，从正上方开始顺时针。纯几何，坐标都在画布内。
 * 只有 1 个节点时放圆心。
 */
export function layoutConceptMap(
  nodes: ConceptMapNode[],
  edges: ConceptMapEdge[],
  width: number,
  height: number,
): ConceptMapLayout {
  const center = { x: width / 2, y: height / 2 };
  const radius = Math.max(0, Math.min(width, height) / 2 - 56);
  const positions: Record<string, { x: number; y: number }> = {};
  const n = nodes.length;
  if (n === 1) {
    positions[nodes[0]!.id] = { ...center };
  } else if (n > 1) {
    nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      positions[node.id] = {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      };
    });
  }
  return {
    positions,
    edges: edges
      .map((edge) => {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) return null;
        return { from, to, ...(edge.label ? { label: edge.label } : {}) };
      })
      .filter((edge): edge is NonNullable<typeof edge> => edge !== null),
    radius,
    center,
  };
}
