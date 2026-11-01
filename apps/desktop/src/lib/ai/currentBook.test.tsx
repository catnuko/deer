// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_BOOK, currentBookFromParams, useCurrentBook } from "./currentBook";

afterEach(cleanup);

function renderAt(route: string) {
  return renderHook(() => useCurrentBook(), {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    ),
  });
}

describe("currentBookFromParams", () => {
  it("没有 book 参数时回落到演示书，title 单独出现不算数", () => {
    for (const [book, title] of [
      [null, null],
      [null, "三体"],
      ["", null],
      ["", "三体"],
    ] as const) {
      expect(currentBookFromParams(book, title)).toEqual(DEMO_BOOK);
    }
  });

  it("占位书名取 id 前 6 位，再怪的 id 也只影响显示不影响回落", () => {
    for (const id of ["abc123def456", "a", "很长的中文id也照切六位", "x".repeat(512)]) {
      expect(currentBookFromParams(id, null)).toEqual({
        id,
        title: `书籍 ${id.slice(0, 6)}`,
      });
    }
  });

  it("title 前后的空白被剥掉后照常使用，全空白的 title 等于没有", () => {
    expect(currentBookFromParams("abc123", "三体")).toEqual({ id: "abc123", title: "三体" });
    expect(currentBookFromParams("abc123", "  三体  ")).toEqual({ id: "abc123", title: "三体" });
    expect(currentBookFromParams("abc123", "")).toEqual({ id: "abc123", title: "书籍 abc123" });
    expect(currentBookFromParams("abc123", " \t\n ")).toEqual({ id: "abc123", title: "书籍 abc123" });
  });

  it("地址栏里 URL 编码的书名由 searchParams 解码，纯函数拿到的是明文", () => {
    expect(currentBookFromParams("abc123", "银河系漫游指南")).toEqual({
      id: "abc123",
      title: "银河系漫游指南",
    });
  });
});

describe("useCurrentBook", () => {
  it("没有 ?book= 参数时回落到演示书", () => {
    const { result } = renderAt("/reader");
    expect(result.current).toEqual(DEMO_BOOK);
  });

  it("只有 ?book= 时用 id 生成占位书名", () => {
    const { result } = renderAt("/reader?book=abc123def456");
    expect(result.current).toEqual({ id: "abc123def456", title: "书籍 abc123" });
  });

  it("?title= 存在且非空白时优先使用", () => {
    const { result } = renderAt("/reader?book=abc123&title=三体");
    expect(result.current).toEqual({ id: "abc123", title: "三体" });
  });

  it("?title= 为空白时回落到占位书名", () => {
    const { result } = renderAt(`/reader?book=abc123&title=${encodeURIComponent("  ")}`);
    expect(result.current).toEqual({ id: "abc123", title: "书籍 abc123" });
  });

  it("地址栏编码过的中文书名正常解码", () => {
    const { result } = renderAt(`/reader?book=abc123&title=${encodeURIComponent("银河系漫游指南")}`);
    expect(result.current).toEqual({ id: "abc123", title: "银河系漫游指南" });
  });
});
