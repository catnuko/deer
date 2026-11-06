// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderToolbar } from "./ReaderToolbar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** useMediaQuery 靠 matchMedia 分宽窄窗，测试里显式钉死。 */
function stubMatchMedia(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia);
}

type ToolbarProps = Parameters<typeof ReaderToolbar>[0];

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  return render(
    <MemoryRouter>
      <ReaderToolbar
        bookTitle="三体"
        author="刘慈欣"
        tocOpen={false}
        onToggleToc={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("ReaderToolbar", () => {
  it("宽窗：左区返回/目录，右区分组图标按钮齐全且带无障碍名", () => {
    stubMatchMedia(true);
    renderToolbar({
      onToggleNotes: vi.fn(),
      onToggleQuickSettings: vi.fn(),
      onToggleConceptMap: vi.fn(),
      onOpenPanel: vi.fn(),
    });

    for (const label of [
      "返回书架",
      "目录",
      "笔记与高亮",
      "显示设置",
      "AI 伴读",
      "概念地图",
      "设置",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // 死信息徽章已删：章节位置移底栏、字号/行距进显示设置面板。
    expect(screen.queryByText(/第 .* 章/)).not.toBeInTheDocument();
    expect(screen.queryByText(/字号/)).not.toBeInTheDocument();
  });

  it("开关面板打开时对应按钮带激活态（aria-pressed=true）", () => {
    stubMatchMedia(true);
    renderToolbar({
      tocOpen: true,
      notesOpen: true,
      quickSettingsOpen: true,
      conceptMapOpen: true,
      onToggleNotes: vi.fn(),
      onToggleQuickSettings: vi.fn(),
      onToggleConceptMap: vi.fn(),
    });

    expect(screen.getByRole("button", { name: "目录" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "笔记与高亮" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "显示设置" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "概念地图" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("窄窗：AI 伴读保持直按，概念地图收进「更多」", async () => {
    stubMatchMedia(false);
    const onOpenPanel = vi.fn();
    const onToggleConceptMap = vi.fn();
    renderToolbar({ onOpenPanel, onToggleConceptMap });

    const aiButton = screen.getByRole("button", { name: "AI 伴读" });
    await userEvent.click(aiButton);
    expect(onOpenPanel).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("menuitem", { name: "AI 伴读" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "更多 AI 动作" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "概念地图" }));
    expect(onToggleConceptMap).toHaveBeenCalledOnce();
  });

  it("AI 伴读按钮只开面板：点击只触发 onOpenPanel，无发送类回调", async () => {
    stubMatchMedia(true);
    const onOpenPanel = vi.fn();
    renderToolbar({ onOpenPanel, panelOpen: true });
    const user = userEvent.setup();

    const aiButton = screen.getByRole("button", { name: "AI 伴读" });
    expect(aiButton).toHaveAttribute("aria-pressed", "true");
    await user.click(aiButton);
    expect(onOpenPanel).toHaveBeenCalledOnce();
  });

  it("没提供回调时不显示对应入口", () => {
    stubMatchMedia(true);
    renderToolbar();

    expect(
      screen.queryByRole("button", { name: "笔记与高亮" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "显示设置" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "AI 伴读" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "概念地图" }),
    ).not.toBeInTheDocument();
  });

  it("无目录的书：目录按钮置灰不可点", async () => {
    stubMatchMedia(true);
    const onToggleToc = vi.fn();
    renderToolbar({ tocDisabled: true, onToggleToc });
    const user = userEvent.setup();

    const tocButton = screen.getByRole("button", { name: "目录" });
    expect(tocButton).toBeDisabled();
    await user.click(tocButton);
    expect(onToggleToc).not.toHaveBeenCalled();
  });
});
