// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_BOOK, useCurrentBook } from "./currentBook";

afterEach(cleanup);

function renderAt(route: string) {
  return renderHook(() => useCurrentBook(), {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    ),
  });
}

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
});
