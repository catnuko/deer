// @vitest-environment happy-dom
import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIPanelLauncher } from "./AIPanelLauncher";
import { useAIPanelStore } from "@/store/aiPanelStore";

// 面板本体另有测试；这里只验挂载/摘除时序，用轻量替身把 onExited 暴露成按钮。
// ChatPanel 已改为 React.lazy：mock 需提供 default 导出，懒解析后才能断言到替身。
vi.mock("@/components/ai/ChatPanel", () => ({
  ChatPanel: ({
    open,
    onExited,
    className,
  }: {
    open?: boolean;
    onExited?: () => void;
    className?: string;
  }) => (
    <div data-testid="chat-panel" data-open={String(open)} className={className}>
      <button onClick={onExited}>退场结束</button>
    </div>
  ),
}));

function setPanelOpen(open: boolean) {
  act(() => useAIPanelStore.setState({ open }));
}

/** 打开面板并等 lazy(ChatPanel) 解析完成（Suspense fallback 先渲染一帧）。 */
async function openPanelAndWait() {
  act(() => useAIPanelStore.setState({ open: true }));
  await screen.findByTestId("chat-panel");
}

beforeEach(() => {
  useAIPanelStore.setState({ open: false });
});

afterEach(cleanup);

describe("AIPanelLauncher", () => {
  it("关闭时不挂载；打开才挂载", async () => {
    render(
      <MemoryRouter initialEntries={["/bookshelf"]}>
        <AIPanelLauncher />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("chat-panel")).toBeNull();

    await openPanelAndWait();
    expect(screen.getByTestId("chat-panel")).toHaveAttribute("data-open", "true");
  });

  it("书架页面板是嵌入式停靠：不绝对定位，作为 flex 兄弟推挤主区", async () => {
    render(
      <MemoryRouter initialEntries={["/bookshelf"]}>
        <AIPanelLauncher />
      </MemoryRouter>,
    );
    await openPanelAndWait();
    const panel = screen.getByTestId("chat-panel");
    expect(panel.className).not.toContain("absolute");
    expect(panel.className).not.toContain("z-30");
  });

  it("关闭后仍留在树上等退场动画，onExited 后才摘除", async () => {
    render(
      <MemoryRouter initialEntries={["/bookshelf"]}>
        <AIPanelLauncher />
      </MemoryRouter>,
    );
    await openPanelAndWait();
    setPanelOpen(false);

    expect(screen.getByTestId("chat-panel")).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByText("退场结束"));
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("非入口路由不渲染", async () => {
    render(
      <MemoryRouter initialEntries={["/reader"]}>
        <AIPanelLauncher />
      </MemoryRouter>,
    );
    setPanelOpen(true);
    // 非入口路由连 Suspense 都不进入，面板（含 lazy 解析）永不出现；
    // 稍等一拍确认没有渲染出来即可。
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("离开入口路由立即摘除，不播退场", async () => {
    function Navigator() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/reader")}>去阅读页</button>;
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Navigator />
        <AIPanelLauncher />
      </MemoryRouter>,
    );
    await openPanelAndWait();
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByText("去阅读页"));
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });
});
