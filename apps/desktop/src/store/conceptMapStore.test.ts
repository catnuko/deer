// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { conceptMapKey, useConceptMapStore } from "./conceptMapStore";
import type { ConceptMapData } from "@/lib/ai/conceptMap";

const map: ConceptMapData = {
  nodes: [
    { id: "n1", label: "记忆" },
    { id: "n2", label: "遗忘", summary: "随时间衰减" },
  ],
  edges: [{ from: "n1", to: "n2", label: "导致" }],
};

beforeEach(() => {
  localStorage.clear();
  useConceptMapStore.setState({ maps: {}, ready: false });
});

describe("conceptMapStore", () => {
  it("save 后 get 能取回，key 按书+章隔离", () => {
    useConceptMapStore.getState().save("book1", "sec:3", map);
    const cached = useConceptMapStore.getState().get("book1", "sec:3");
    expect(cached?.nodes).toEqual(map.nodes);
    expect(cached?.edges).toEqual(map.edges);
    expect(typeof cached?.createdAt).toBe("number");
    expect(useConceptMapStore.getState().get("book1", "sec:4")).toBeUndefined();
    expect(useConceptMapStore.getState().get("book2", "sec:3")).toBeUndefined();
  });

  it("save 落 localStorage，重新 load 能恢复缓存", async () => {
    useConceptMapStore.getState().save("book1", "sec:1", map);
    expect(localStorage.getItem("deer.conceptmaps.v1")).toContain("记忆");

    useConceptMapStore.setState({ maps: {}, ready: false });
    await useConceptMapStore.getState().load();
    expect(useConceptMapStore.getState().get("book1", "sec:1")?.nodes).toEqual(
      map.nodes,
    );
    expect(useConceptMapStore.getState().ready).toBe(true);
  });

  it("remove 只删指定章，其他章不动", () => {
    useConceptMapStore.getState().save("book1", "sec:1", map);
    useConceptMapStore.getState().save("book1", "sec:2", map);
    useConceptMapStore.getState().remove("book1", "sec:1");
    expect(useConceptMapStore.getState().get("book1", "sec:1")).toBeUndefined();
    expect(useConceptMapStore.getState().get("book1", "sec:2")).toBeDefined();
  });

  it("conceptMapKey 用 :: 连接书与章", () => {
    expect(conceptMapKey("b1", "sec:2")).toBe("b1::sec:2");
  });
});
