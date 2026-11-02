import { describe, expect, it } from "vitest";
import { summarizeStorage } from "./storageSummary";
import type { ChatMessage } from "@/lib/types";
import type { StoredAnnotation } from "@/store/annotationStore";

function message(id: string): ChatMessage {
  return { id, role: "user", content: "x", createdAt: 1 };
}

function annotation(over: Partial<StoredAnnotation> = {}): StoredAnnotation {
  return {
    id: over.id ?? "a1",
    cfi: over.cfi ?? "epubcfi(/6/4!/4/2)",
    color: over.color ?? "#FFD60A",
    createdAt: over.createdAt ?? 1,
    ...over,
  };
}

describe("summarizeStorage", () => {
  it("汇总书籍、标注、含笔记条数与聊天消息", () => {
    const summary = summarizeStorage({
      books: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
      annotations: {
        b1: [
          annotation({ id: "a1", note: "有笔记" }),
          annotation({ id: "a2", note: "  " }),
        ],
        b2: [annotation({ id: "a3", note: "也有" })],
        b3: [],
      },
      messages: {
        t1: [message("m1"), message("m2")],
        t2: [],
        t3: [message("m3")],
      },
    });

    expect(summary).toEqual({
      bookCount: 3,
      annotationCount: 3,
      noteCount: 2,
      chatMessageCount: 3,
      chatThreadCount: 2,
    });
  });

  it("空库全为 0", () => {
    expect(
      summarizeStorage({ books: [], annotations: {}, messages: {} }),
    ).toEqual({
      bookCount: 0,
      annotationCount: 0,
      noteCount: 0,
      chatMessageCount: 0,
      chatThreadCount: 0,
    });
  });
});