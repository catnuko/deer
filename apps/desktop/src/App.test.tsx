// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// App 的重依赖一律替换：这里只验证路由拆包与懒加载挂载本身。
vi.mock("@/lib/sync/runtime", () => ({ startSyncRuntime: vi.fn() }));
vi.mock("@/components/settings/SettingsDialog", () => ({
  SettingsDialog: () => null,
}));
vi.mock("@/components/ai/AIPanelLauncher", () => ({
  AIPanelLauncher: () => null,
}));
vi.mock("@/routes/bookshelf/BookshelfPage", () => ({
  BookshelfPage: () => <div data-testid="bookshelf-stub" />,
}));

import App from "./App";

describe("App 懒加载路由", () => {
  it("/reader 经 React.lazy 拆包加载，Suspense 回退后挂载阅读页", async () => {
    render(
      <MemoryRouter initialEntries={["/reader"]}>
        <App />
      </MemoryRouter>,
    );

    // 浏览器预览（无 Tauri）走演示书：懒 chunk 加载完成后 DemoReader 就绪。
    // 全量测试并发跑时动态 import 会变慢，超时放宽到 5s。
    await waitFor(
      () =>
        expect(
          screen.getByRole("progressbar", { name: "本章阅读进度" }),
        ).toBeTruthy(),
      { timeout: 5000 },
    );
    expect(screen.getAllByText("山中来信").length).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
