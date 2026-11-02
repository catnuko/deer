// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsDialog } from "./SettingsDialog";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";
import { useReadingSettings } from "@/store/readingSettings";
import { useAppSettings } from "@/store/appSettings";

beforeEach(() => {
  useSettingsDialogStore.getState().setOpen(true);
  useReadingSettings.getState().reset();
  useAppSettings.getState().reset();
});

afterEach(() => {
  cleanup();
  useSettingsDialogStore.getState().setOpen(false);
});

describe("SettingsDialog", () => {
  it("左栏五个分组齐全，默认落在通用", () => {
    render(<SettingsDialog />);

    for (const label of ["通用", "外观", "阅读", "AI 伴读", "关于"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "通用" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("启动时打开")).toBeInTheDocument();
  });

  it("切换分组只换右栏内容，外框尺寸类保持不变", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);

    const popup = document.querySelector('[data-slot="dialog-content"]');
    expect(popup).not.toBeNull();
    const before = popup?.className;
    // 视口够大走 900×640，不够时 94vw×86vh；两种都是固定尺寸，
    // 关键是切换分组前后 class 不变。
    expect(before).toMatch(/h-\[(640px|86vh)\]/);
    expect(before).toMatch(/w-\[(900px|94vw)\]/);

    await user.click(screen.getByRole("button", { name: "阅读" }));
    expect(screen.getByText("正文字号")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "阅读" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(screen.getByRole("button", { name: "AI 伴读" }));
    expect(screen.getByText("AI 伴读引擎")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关于" }));
    expect(screen.getByText("Deer")).toBeInTheDocument();

    expect(popup?.className).toBe(before);
  });

  it("外观是跟随系统 / 浅色 / 深色三选一，选中即写入设置", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);

    await user.click(screen.getByRole("button", { name: "外观" }));
    await user.click(screen.getByRole("radio", { name: /^深色/ }));
    expect(useReadingSettings.getState().theme).toBe("dark");
    expect(screen.getByRole("radio", { name: /^深色/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});