// @vitest-environment happy-dom
import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIPanelLauncher } from "./AIPanelLauncher";
import { useAIPanelStore } from "@/store/aiPanelStore";

// 面板本体另有测试；这里只验挂载/摘除时序，用轻量替身把 onExited 暴露成按钮。
vi.mock("@/components/ai/ChatPanel", () => ({
  ChatPanel: ({ open, onExited }: { open?: boolean; onExited?: () => void }) => (
    <div data-testid="chat-panel" data-open={String(open)}>
      <button onClick={onExited}>退场结束</button>
    </div>
  ),
}));

function setPanelOpen(open: boolean) {
  act(() => useAIPanelStore.setState({ open }));
}

beforeEach(() => {
  useAIPanelStore.setState({ open: false });
});

afterEach(cleanup);

describe("AIPanelLauncher", () => {
  it("关闭时不挂载；打开才挂载", () => {
    render(
      <MemoryRouter initialEntries={["/bookshelf"]}>
        <AIPanelLauncher />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("chat-panel")).toBeNull();

    setPanelOpen(true);
    expect(screen.getByTestId("chat-panel")).toHaveAttribute("data-open", "true");
  });

  it("关闭后仍留在树上等退场动画，onExited 后才摘除", () => {
    render(
      <MemoryRouter initialEntries={["/bookshelf"]}>
        <AIPanelLauncher />
      </MemoryRouter>,
    );
    setPanelOpen(true);
    setPanelOpen(false);

    expect(screen.getByTestId("chat-panel")).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByText("退场结束"));
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("非入口路由不渲染", () => {
    render(
      <MemoryRouter initialEntries={["/reader"]}>
        <AIPanelLauncher />
      </MemoryRouter>,
    );
    setPanelOpen(true);
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("离开入口路由立即摘除，不播退场", () => {
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
    setPanelOpen(true);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByText("去阅读页"));
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });
});