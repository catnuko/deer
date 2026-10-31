import { describe, expect, it } from "vitest";
import {
  CONCEPT_MAP_CHAR_LIMIT,
  MAX_CONCEPT_NODES,
  buildConceptMapPrompt,
  layoutConceptMap,
  parseConceptMap,
} from "./conceptMap";

describe("buildConceptMapPrompt", () => {
  it("正常章节：固定指令（含 JSON 格式要求）+ 章节全文", () => {
    const { prompt, truncated } = buildConceptMapPrompt("本章讲了一个概念。");
    expect(truncated).toBe(false);
    expect(prompt).toContain("只输出一个 JSON 对象");
    expect(prompt).toContain('"nodes"');
    expect(prompt).toContain('"edges"');
    expect(prompt).toContain("\n\n以下是章节全文：\n\n本章讲了一个概念。");
  });

  it("超长章节按码点截断，并说明地图基于前 limit 字符", () => {
    const { prompt, truncated } = buildConceptMapPrompt(
      "字".repeat(CONCEPT_MAP_CHAR_LIMIT + 3),
    );
    expect(truncated).toBe(true);
    expect(prompt).toContain(
      `本章过长，以下只包含前 ${CONCEPT_MAP_CHAR_LIMIT} 字符`,
    );
    expect(prompt).toContain(`\n\n${"字".repeat(CONCEPT_MAP_CHAR_LIMIT)}`);
    expect(prompt).not.toContain("字".repeat(CONCEPT_MAP_CHAR_LIMIT + 1));
  });
});

describe("parseConceptMap", () => {
  const valid =
    '{"nodes":[{"id":"n1","label":"记忆","summary":"存储与提取"},{"id":"n2","label":"遗忘"}],"edges":[{"from":"n1","to":"n2","label":"导致"},{"from":"n1","to":"n9"}]}';

  it("合法 JSON（裸对象）解析出节点和边", () => {
    const data = parseConceptMap(valid);
    expect(data).toEqual({
      nodes: [
        { id: "n1", label: "记忆", summary: "存储与提取" },
        { id: "n2", label: "遗忘" },
      ],
      edges: [{ from: "n1", to: "n2", label: "导致" }],
    });
  });

  it("容忍代码块围栏和 JSON 前后的闲话", () => {
    const fenced = `好的，这是概念地图：\n\`\`\`json\n${valid}\n\`\`\`\n希望有帮助。`;
    expect(parseConceptMap(fenced)).toEqual(parseConceptMap(valid));
  });

  it.each([
    ["空字符串", ""],
    ["没有 JSON", "模型说：本章没有明显概念。"],
    ["JSON 语法错误", '{"nodes":[{"id":"n1",}]}'],
    ["nodes 不是数组", '{"nodes":"很多","edges":[]}'],
    ["nodes 为空", '{"nodes":[],"edges":[]}'],
    ["节点缺 id", '{"nodes":[{"label":"记忆"}],"edges":[]}'],
    ["节点缺 label", '{"nodes":[{"id":"n1"}],"edges":[]}'],
    ["顶层不是对象", "[1,2,3]"],
  ])("%s → 返回 null", (_name, raw) => {
    expect(parseConceptMap(raw)).toBeNull();
  });

  it("端点不存在的边、自环边被丢弃，其余保留", () => {
    const data = parseConceptMap(
      '{"nodes":[{"id":"a","label":"甲"},{"id":"b","label":"乙"}],"edges":[{"from":"a","to":"x"},{"from":"a","to":"a"},{"from":"a","to":"b"}]}',
    );
    expect(data?.edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("重复 id 的节点只保留第一个，节点数截到上限", () => {
    const dup = parseConceptMap(
      '{"nodes":[{"id":"a","label":"甲"},{"id":"a","label":"乙"}],"edges":[]}',
    );
    expect(dup?.nodes).toEqual([{ id: "a", label: "甲" }]);

    const many = Array.from(
      { length: MAX_CONCEPT_NODES + 5 },
      (_, i) => `{"id":"n${i}","label":"概念${i}"}`,
    ).join(",");
    const capped = parseConceptMap(`{"nodes":[${many}],"edges":[]}`);
    expect(capped?.nodes).toHaveLength(MAX_CONCEPT_NODES);
  });
});

describe("layoutConceptMap", () => {
  const nodes = [
    { id: "a", label: "甲" },
    { id: "b", label: "乙" },
    { id: "c", label: "丙" },
  ];
  const edges = [
    { from: "a", to: "b", label: "相关" },
    { from: "a", to: "zz" },
  ];

  it("节点沿圆周均布且都在画布内，边只保留两端有节点的", () => {
    const layout = layoutConceptMap(nodes, edges, 600, 400);
    expect(Object.keys(layout.positions).sort()).toEqual(["a", "b", "c"]);
    for (const p of Object.values(layout.positions)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(600);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(400);
    }
    // 三节点均布：相邻间距相等，都落在半径上。
    expect(layout.radius).toBe(400 / 2 - 56);
    expect(layout.edges).toEqual([
      {
        from: layout.positions.a,
        to: layout.positions.b,
        label: "相关",
      },
    ]);
  });

  it("单个节点放圆心；零节点返回空布局不报错", () => {
    const single = layoutConceptMap([nodes[0]!], [], 600, 400);
    expect(single.positions.a).toEqual({ x: 300, y: 200 });

    const empty = layoutConceptMap([], [], 600, 400);
    expect(empty.positions).toEqual({});
    expect(empty.edges).toEqual([]);
  });
});
