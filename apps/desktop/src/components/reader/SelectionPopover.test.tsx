// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HIGHLIGHT_COLORS } from "./highlightColors";
import { SelectionPopover } from "./SelectionPopover";

afterEach(cleanup);

const baseProps = {
  x: 120,
  y: 64,
  placement: "above" as const,
  text: "被划选的句子",
};

function renderPopover(overrides: Partial<Parameters<typeof SelectionPopover>[0]> = {}) {
  const props = {
    ...baseProps,
    onCopy: vi.fn(),
    onHighlight: vi.fn(),
    onNote: vi.fn(),
    onAsk: vi.fn(),
    ...overrides,
  };
  const rendered = render(<SelectionPopover {...props} />);
  return { container: rendered.container, ...props };
}

describe("SelectionPopover", () => {
  it("按传入坐标绝对定位，四个动作按钮齐全", () => {
    const { container } = renderPopover();

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.left).toBe("120px");
    expect(wrapper.style.top).toBe("64px");
    expect(wrapper.className).toContain("absolute");
    expect(wrapper.className).toContain("z-20");
    for (const name of ["复制", "高亮", "笔记", "问 Deer"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("点击复制把选中文本交给 onCopy，且不冒泡到正文容器", async () => {
    const onCopy = vi.fn();
    const onHostClick = vi.fn();
    const user = userEvent.setup();
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    render(
      <div onClick={onHostClick}>
        <SelectionPopover
          {...baseProps}
          onCopy={onCopy}
          onHighlight={() => {}}
          onNote={() => {}}
          onAsk={() => {}}
        />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "复制" }));
    expect(onCopy).toHaveBeenCalledWith("被划选的句子");
    expect(onHostClick).not.toHaveBeenCalled();
  });

  it("点击高亮展开色条，四个颜色按钮各带无障碍名", async () => {
    renderPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "高亮" }));
    for (const color of HIGHLIGHT_COLORS) {
      expect(
        screen.getByRole("button", { name: `高亮：${color.label}` }),
      ).toBeInTheDocument();
    }
  });

  it("在色条里选色，把颜色值交给 onHighlight", async () => {
    const props = renderPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "高亮" }));
    await user.click(
      screen.getByRole("button", { name: `高亮：${HIGHLIGHT_COLORS[1]!.label}` }),
    );
    expect(props.onHighlight).toHaveBeenCalledWith(HIGHLIGHT_COLORS[1]!.value);
  });

  it("点击笔记展开输入框，保存按钮在内容为空时禁用", async () => {
    renderPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "笔记" }));
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("笔记内容"), "这段写得很好");
    expect(save).toBeEnabled();
  });

  it("笔记输入后点保存，把裁剪后的内容交给 onNote", async () => {
    const props = renderPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "笔记" }));
    await user.type(screen.getByLabelText("笔记内容"), "  有感  ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(props.onNote).toHaveBeenCalledWith("有感");
  });

  it("点击问 Deer 把选中文本交给 onAsk", async () => {
    const props = renderPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "问 Deer" }));
    expect(props.onAsk).toHaveBeenCalledWith("被划选的句子");
  });
});
