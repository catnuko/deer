// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
} from "./highlightColors";
import { SelectionPopover } from "./SelectionPopover";

afterEach(cleanup);

const baseProps = {
  x: 120,
  y: 64,
  placement: "above" as const,
  selTop: 72,
  selBottom: 96,
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
    for (const name of ["复制", "划线", "写想法", "问 Deer"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("新选区没有行 2（样式/颜色行），落线后才展开", () => {
    renderPopover();
    expect(
      screen.queryByRole("button", { name: "样式：马克笔" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "颜色：浅蓝" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("selection-menu-submenu")).not.toBeInTheDocument();
  });

  it("点击复制把选中文本交给 onCopy，且不冒泡到正文容器", async () => {
    const onCopy = vi.fn();
    const onHostClick = vi.fn();
    const user = userEvent.setup();
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

  it("点「划线」立即用默认配置（马克笔 + 第一色）落线", async () => {
    const props = renderPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "划线" }));
    expect(props.onHighlight).toHaveBeenCalledWith(
      DEFAULT_ANNOTATION_STYLE,
      DEFAULT_HIGHLIGHT_COLOR,
    );
  });

  it("点击写想法展开输入框，保存按钮在内容为空时禁用", async () => {
    renderPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "写想法" }));
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("笔记内容"), "这段写得很好");
    expect(save).toBeEnabled();
  });

  it("笔记输入后点保存，把裁剪后的内容交给 onNote", async () => {
    const props = renderPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "写想法" }));
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

describe("SelectionPopover 编辑已有划线", () => {
  const existing = {
    color: HIGHLIGHT_COLORS[0]!.value,
    style: DEFAULT_ANNOTATION_STYLE,
    note: "旧笔记",
  };

  function renderEditPopover(
    overrides: Partial<Parameters<typeof SelectionPopover>[0]> = {},
  ) {
    return renderPopover({ existing, ...overrides });
  }

  it("编辑模式行 1 是复制/删除划线/写想法/问 Deer，不出「划线」", () => {
    renderEditPopover();

    for (const name of ["复制", "删除划线", "写想法", "问 Deer"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "划线" })).not.toBeInTheDocument();
  });

  it("编辑模式行 2 常驻：三枚样式钮 + 五枚色点，当前项呈选中态", () => {
    renderEditPopover();

    for (const style of ["马克笔", "直线", "波浪线"]) {
      expect(
        screen.getByRole("button", { name: `样式：${style}` }),
      ).toBeInTheDocument();
    }
    for (const color of HIGHLIGHT_COLORS) {
      expect(
        screen.getByRole("button", { name: `颜色：${color.label}` }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: "样式：马克笔" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "颜色：浅蓝" }),
    ).toHaveAttribute("aria-pressed", "true");

    // 行 2 是独立浮层（二级菜单），挂在主菜单上方而不是同一张卡片里。
    const submenu = screen.getByTestId("selection-menu-submenu");
    const main = screen.getByTestId("selection-menu-main");
    expect(submenu.className).toContain("absolute");
    expect(submenu.contains(screen.getByRole("button", { name: "样式：马克笔" }))).toBe(
      true,
    );
    expect(main.contains(screen.getByRole("button", { name: "样式：马克笔" }))).toBe(
      false,
    );
    expect(submenu.nextElementSibling).toBe(main);
  });

  it("行 2 点样式把新样式连同当前颜色交给 onHighlight，菜单不关", async () => {
    const props = renderEditPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "样式：波浪线" }));
    expect(props.onHighlight).toHaveBeenCalledWith("dash", existing.color);
    expect(screen.getByRole("button", { name: "删除划线" })).toBeInTheDocument();
  });

  it("行 2 点颜色把新颜色连同当前样式交给 onHighlight", async () => {
    const props = renderEditPopover();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: `颜色：${HIGHLIGHT_COLORS[2]!.label}` }),
    );
    expect(props.onHighlight).toHaveBeenCalledWith(
      existing.style,
      HIGHLIGHT_COLORS[2]!.value,
    );
  });

  it("点删除划线调用 onDelete", async () => {
    const props = renderEditPopover({ onDelete: vi.fn() });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "删除划线" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("笔记预填旧笔记，保存把新内容交给 onNote", async () => {
    const props = renderEditPopover();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "写想法" }));
    expect(screen.getByLabelText("笔记内容")).toHaveValue("旧笔记");

    await user.type(screen.getByLabelText("笔记内容"), "，再补一句");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(props.onNote).toHaveBeenCalledWith("旧笔记，再补一句");
  });
});
