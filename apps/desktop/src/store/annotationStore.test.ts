import { beforeEach, describe, expect, it, vi } from "vitest";

// annotationStore 只在读写时触碰 localStorage，先替换成内存实现。
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
});

const { useAnnotationStore } = await import("./annotationStore");

function reset() {
  memory.clear();
  useAnnotationStore.setState({ annotations: {}, ready: true });
}

describe("划选注解持久化（按书隔离，CFI 定位）", () => {
  beforeEach(reset);

  it("add 存下 CFI、颜色、摘录和笔记，新书互不污染", () => {
    const store = useAnnotationStore.getState();
    const a = store.add({
      bookId: "book-a",
      cfi: "epubcfi(/6/4!/4/2)",
      color: "#FFD60A",
      excerpt: "被划的句子",
      note: "想到一件事",
    });
    store.add({
      bookId: "book-b",
      cfi: "epubcfi(/6/8!/4/2)",
      color: "#6FB6FF",
    });

    const list = useAnnotationStore.getState().listForBook("book-a");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: a.id,
      cfi: "epubcfi(/6/4!/4/2)",
      color: "#FFD60A",
      excerpt: "被划的句子",
      note: "想到一件事",
    });
    expect(useAnnotationStore.getState().listForBook("book-b")).toHaveLength(1);
  });

  it("没有笔记时不写 note 字段，省得回显层判空字符串", () => {
    useAnnotationStore.getState().add({
      bookId: "book-a",
      cfi: "epubcfi(/6/4!/4/2)",
      color: "#FFD60A",
    });

    const list = useAnnotationStore.getState().listForBook("book-a");
    expect(list[0]?.note).toBeUndefined();
    expect(list[0]?.excerpt).toBeUndefined();
  });

  it("setColor 只改指定注解的颜色", () => {
    const store = useAnnotationStore.getState();
    const a = store.add({
      bookId: "book-a",
      cfi: "epubcfi(/6/4!/4/2)",
      color: "#FFD60A",
    });
    const b = store.add({
      bookId: "book-a",
      cfi: "epubcfi(/6/4!/4/6)",
      color: "#FFD60A",
    });

    store.setColor(b.id, "#5AD45A");

    const list = useAnnotationStore.getState().listForBook("book-a");
    expect(list.find((x) => x.id === a.id)?.color).toBe("#FFD60A");
    expect(list.find((x) => x.id === b.id)?.color).toBe("#5AD45A");
  });

  it("setNote 编辑与清空笔记，其他字段不动", () => {
    const store = useAnnotationStore.getState();
    const a = store.add({
      bookId: "book-a",
      cfi: "epubcfi(/6/4!/4/2)",
      color: "#FFD60A",
      excerpt: "句子",
      note: "旧笔记",
    });

    store.setNote(a.id, "新笔记");
    expect(
      useAnnotationStore.getState().listForBook("book-a")[0]?.note,
    ).toBe("新笔记");

    store.setNote(a.id, "");
    const after = useAnnotationStore.getState().listForBook("book-a")[0];
    expect(after?.note).toBeUndefined();
    expect(after?.excerpt).toBe("句子");
  });

  it("remove 删掉指定注解，同书其他注解保留", () => {
    const store = useAnnotationStore.getState();
    const a = store.add({
      bookId: "book-a",
      cfi: "epubcfi(/6/4!/4/2)",
      color: "#FFD60A",
    });
    const b = store.add({
      bookId: "book-a",
      cfi: "epubcfi(/6/4!/4/6)",
      color: "#6FB6FF",
    });

    store.remove(a.id);

    const list = useAnnotationStore.getState().listForBook("book-a");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(b.id);
  });

  it("持久化：落盘数据能还原书与注解的对应关系", async () => {
    useAnnotationStore.getState().add({
      bookId: "book-a",
      cfi: "epubcfi(/6/4!/4/2)",
      color: "#FFD60A",
      note: "笔记",
    });

    // writePersisted 是异步落盘，等一轮微任务。
    await new Promise((r) => setTimeout(r, 0));

    const raw = memory.get("deer.annotations.v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.annotations["book-a"]).toHaveLength(1);
    expect(parsed.annotations["book-a"][0].note).toBe("笔记");
  });
});
