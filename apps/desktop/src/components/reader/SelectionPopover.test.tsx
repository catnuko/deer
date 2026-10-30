// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionPopover } from "./SelectionPopover";

afterEach(cleanup);

describe("SelectionPopover", () => {
  it("按传入坐标绝对定位，按钮文案「问 Deer」带无障碍名", () => {
    const { container } = render(
      <SelectionPopover x={120} y={64} placement="above" onAsk={() => {}} />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.left).toBe("120px");
    expect(wrapper.style.top).toBe("64px");
    expect(wrapper.className).toContain("absolute");
    expect(wrapper.className).toContain("z-20");
    expect(screen.getByRole("button", { name: "问 Deer" })).toBeInTheDocument();
  });

  it("点击按钮触发 onAsk 且不冒泡到正文容器", async () => {
    const onAsk = vi.fn();
    const onHostClick = vi.fn();
    const user = userEvent.setup();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onClick={onHostClick}>
        <SelectionPopover x={100} y={100} placement="below" onAsk={onAsk} />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "问 Deer" }));
    expect(onAsk).toHaveBeenCalledOnce();
    expect(onHostClick).not.toHaveBeenCalled();
  });
});
