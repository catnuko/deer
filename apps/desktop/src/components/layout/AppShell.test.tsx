// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";

beforeEach(() => {
  useSettingsDialogStore.getState().setOpen(false);
});

afterEach(cleanup);

describe("AppShell", () => {
  it("⌘, 与 Ctrl+, 都能打开设置弹窗", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>书架</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: ",", metaKey: true, cancelable: true }),
    );
    expect(useSettingsDialogStore.getState().open).toBe(true);

    useSettingsDialogStore.getState().setOpen(false);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: ",", ctrlKey: true, cancelable: true }),
    );
    expect(useSettingsDialogStore.getState().open).toBe(true);
  });

  it("其他按键不会误开设置", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>书架</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: ",", cancelable: true }),
    );
    expect(useSettingsDialogStore.getState().open).toBe(false);
  });
});