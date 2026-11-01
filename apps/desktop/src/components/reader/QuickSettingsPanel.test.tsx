// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickSettingsPanel } from "./QuickSettingsPanel";

afterEach(cleanup);

const baseProps = {
  fontSize: 15,
  paperColor: "#ffffff",
  pageFlow: "paginated",
  onFontSizeChange: vi.fn(),
  onPaperColorChange: vi.fn(),
  onPageFlowChange: vi.fn(),
  onClose: vi.fn(),
} as const;

describe("QuickSettingsPanel", () => {
  it("渲染三组设置：四档字号、四个色块、两种翻页方式，当前项标记选中", () => {
    render(<QuickSettingsPanel {...baseProps} />);

    for (const size of [14, 15, 17, 19]) {
      expect(screen.getByRole("button", { name: String(size) })).toHaveAttribute(
        "aria-pressed",
        size === 15 ? "true" : "false",
      );
    }
    expect(screen.getByLabelText("背景色：米黄")).toBeInTheDocument();
    expect(screen.getByLabelText("背景色：豆沙绿")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "翻页" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "滚动" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("点字号把对应档位交给 onFontSizeChange", async () => {
    const onFontSizeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuickSettingsPanel {...baseProps} onFontSizeChange={onFontSizeChange} />,
    );

    await user.click(screen.getByRole("button", { name: "17" }));
    expect(onFontSizeChange).toHaveBeenCalledOnce();
    expect(onFontSizeChange).toHaveBeenCalledWith(17);
  });

  it("点色块把对应纸色交给 onPaperColorChange", async () => {
    const onPaperColorChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuickSettingsPanel
        {...baseProps}
        paperColorDisabled={false}
        onPaperColorChange={onPaperColorChange}
      />,
    );

    await user.click(screen.getByLabelText("背景色：豆沙绿"));
    expect(onPaperColorChange).toHaveBeenCalledOnce();
    expect(onPaperColorChange).toHaveBeenCalledWith("#c7edcc");
  });

  it("点翻页方式把对应档位交给 onPageFlowChange", async () => {
    const onPageFlowChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuickSettingsPanel {...baseProps} onPageFlowChange={onPageFlowChange} />,
    );

    await user.click(screen.getByRole("button", { name: "滚动" }));
    expect(onPageFlowChange).toHaveBeenCalledOnce();
    expect(onPageFlowChange).toHaveBeenCalledWith("scrolled");
  });

  it("深色主题下纸色禁用且不可点击，提示文案出现", async () => {
    const onPaperColorChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuickSettingsPanel
        {...baseProps}
        paperColorDisabled
        onPaperColorChange={onPaperColorChange}
      />,
    );

    expect(screen.getByText("背景色（深色主题下不生效）")).toBeInTheDocument();
    const swatch = screen.getByLabelText("背景色：米黄");
    expect(swatch).toBeDisabled();
    await user.click(swatch);
    expect(onPaperColorChange).not.toHaveBeenCalled();
  });

  it("点击关闭按钮触发 onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<QuickSettingsPanel {...baseProps} onClose={onClose} />);

    await user.click(screen.getByLabelText("关闭显示设置"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("按 Esc 触发 onClose（布局重排 P8）", async () => {
    const onClose = vi.fn();
    render(<QuickSettingsPanel {...baseProps} onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
