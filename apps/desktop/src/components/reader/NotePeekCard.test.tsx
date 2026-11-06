// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotePeekCard } from "./NotePeekCard";

afterEach(cleanup);

function renderCard(overrides: { closing?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const containerRef = { current: container };
  render(
    <NotePeekCard
      anchor={{ left: 40, top: 60, width: 8, height: 12 }}
      text="这是一条脚注。"
      type="footnote"
      containerRef={containerRef}
      onPointerEnter={vi.fn()}
      onPointerLeave={vi.fn()}
      {...overrides}
    />,
  );
  return screen.getByTestId("note-peek-card");
}

describe("NotePeekCard", () => {
  it("进入是原地淡入，不带位移", () => {
    const card = renderCard();
    expect(card.className).toContain("deer-peek-in");
    expect(card.className).not.toContain("deer-pop-in");
    expect(card.className).not.toContain("translate");
  });

  it("closing 时播原地淡出，且退出期间不接受指针", () => {
    const card = renderCard({ closing: true });
    expect(card.className).toContain("deer-peek-out");
    expect(card.className).toContain("pointer-events-none");
    expect(card.className).not.toContain("deer-pop-in");
    expect(card.className).not.toContain("translate");
  });
});