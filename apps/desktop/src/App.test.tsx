// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// 拆包（ALNA-193）后阅读页/笔记页走 React.lazy：这里只验证路由的懒加载
// 挂载链路（fallback → chunk 解析 → 页面渲染），页面本体各有自己的测试。
vi.mock("@/routes/reader/ReaderPage", () => ({
  ReaderPage: () => <div>阅读页测试桩</div>,
}));
vi.mock("@/routes/notes/NotesPage", () => ({
  NotesPage: () => <div>笔记页测试桩</div>,
}));
// 同步运行时会读设置、起定时器，与本测试无关，桩掉。
vi.mock("@/lib/sync/runtime", () => ({
  startSyncRuntime: vi.fn(async () => {}),
}));

import App from "./App";

afterEach(cleanup);

function mountApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App 懒加载路由", () => {
  it("/reader：Suspense 占位后挂载懒加载的 ReaderPage", async () => {
    mountApp("/reader");
    expect(screen.getByRole("status", { name: "加载中" })).toBeTruthy();
    expect(await screen.findByText("阅读页测试桩")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "加载中" })).toBeNull(),
    );
  });

  it("/notes：Suspense 占位后挂载懒加载的 NotesPage", async () => {
    mountApp("/notes");
    expect(screen.getByRole("status", { name: "加载中" })).toBeTruthy();
    expect(await screen.findByText("笔记页测试桩")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "加载中" })).toBeNull(),
    );
  });
});
