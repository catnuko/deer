// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { useBookBriefingStore } from "./bookBriefingStore";
import type { BookBriefingData } from "@/lib/ai/bookBriefing";

const briefing: BookBriefingData = {
  mentalModel: "现象—机制—对策。",
  chapters: [{ title: "第一章", note: "定义问题。" }],
  concepts: [{ term: "深度工作", note: "无干扰的高专注状态" }],
};

beforeEach(() => {
  localStorage.clear();
  useBookBriefingStore.setState({ briefings: {}, ready: false });
});

describe("bookBriefingStore", () => {
  it("save 后 get 能取回，key 按书隔离", () => {
    useBookBriefingStore.getState().save("book1", briefing);
    const cached = useBookBriefingStore.getState().get("book1");
    expect(cached?.mentalModel).toBe(briefing.mentalModel);
    expect(cached?.chapters).toEqual(briefing.chapters);
    expect(cached?.concepts).toEqual(briefing.concepts);
    expect(typeof cached?.createdAt).toBe("number");
    expect(useBookBriefingStore.getState().get("book2")).toBeUndefined();
  });

  it("save 落 localStorage，重新 load 能恢复缓存", async () => {
    useBookBriefingStore.getState().save("book1", briefing);
    expect(localStorage.getItem("deer.briefings.v1")).toContain("深度工作");

    useBookBriefingStore.setState({ briefings: {}, ready: false });
    await useBookBriefingStore.getState().load();
    expect(useBookBriefingStore.getState().get("book1")?.chapters).toEqual(
      briefing.chapters,
    );
    expect(useBookBriefingStore.getState().ready).toBe(true);
  });

  it("remove 只删指定书，其他书不动", () => {
    useBookBriefingStore.getState().save("book1", briefing);
    useBookBriefingStore.getState().save("book2", briefing);
    useBookBriefingStore.getState().remove("book1");
    expect(useBookBriefingStore.getState().get("book1")).toBeUndefined();
    expect(useBookBriefingStore.getState().get("book2")).toBeDefined();
  });

  it("同书重新 save 覆盖旧简报并刷新生成时间", () => {
    useBookBriefingStore.getState().save("book1", briefing);
    const first = useBookBriefingStore.getState().get("book1");
    useBookBriefingStore.getState().save("book1", {
      ...briefing,
      mentalModel: "新的骨架。",
    });
    const second = useBookBriefingStore.getState().get("book1");
    expect(second?.mentalModel).toBe("新的骨架。");
    expect(second?.createdAt).toBeGreaterThanOrEqual(first?.createdAt ?? 0);
  });
});
