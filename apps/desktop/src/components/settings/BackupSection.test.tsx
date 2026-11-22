// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 备份/恢复的打包与合并在 Rust command 完成（另有 Rust 侧测试），这里只验
// BackupSection 的编排：入口按钮态、进度展示、结果与错误反馈。
vi.mock("@/lib/backup", () => ({
  pickExportDestination: vi.fn(),
  pickImportSource: vi.fn(),
  runExport: vi.fn(),
  runImport: vi.fn(),
}));

import {
  pickExportDestination,
  pickImportSource,
  runExport,
  runImport,
} from "@/lib/backup";
import { BackupSection } from "./BackupSection";

const mockedPickExport = vi.mocked(pickExportDestination);
const mockedPickImport = vi.mocked(pickImportSource);
const mockedRunExport = vi.mocked(runExport);
const mockedRunImport = vi.mocked(runImport);

function setDesktop(desktop: boolean) {
  if (desktop) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
}

beforeEach(() => {
  setDesktop(true);
  vi.mocked(window.location.reload).mockClear?.();
  vi.mocked(window.location.reload).mockImplementation?.(() => {});
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe("BackupSection", () => {
  it("浏览器预览模式：按钮禁用并给出说明", () => {
    setDesktop(false);
    render(<BackupSection />);
    expect(screen.getByRole("button", { name: /导出…/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /导入…/ })).toBeDisabled();
    expect(screen.getByText(/浏览器预览模式不支持备份/)).toBeTruthy();
  });

  it("导出成功：选目标路径 → Rust command → 结果摘要；过程展示进度", async () => {
    let resolveExport!: (value: {
      formatVersion: number;
      appVersion: string;
      createdAt: number;
      books: number;
      covers: number;
      annotations: number;
    }) => void;
    mockedPickExport.mockResolvedValue("/mock/backup.deer-backup");
    mockedRunExport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    render(<BackupSection />);
    fireEvent.click(screen.getByRole("button", { name: /导出…/ }));

    // 进行中：按钮全部禁用，展示阶段文案。
    expect(await screen.findByText("准备中…")).toBeTruthy();
    expect(screen.getByRole("button", { name: /导入…/ })).toBeDisabled();

    resolveExport({
      formatVersion: 1,
      appVersion: "0.3.0",
      createdAt: 0,
      books: 3,
      covers: 2,
      annotations: 7,
    });
    expect(
      await screen.findByText(/导出完成：3 本书 · 2 张封面 · 7 条笔记/),
    ).toBeTruthy();
    expect(screen.getByText(/导出自 Deer 0.3.0/)).toBeTruthy();
    // 完成后恢复可用。
    expect(screen.getByRole("button", { name: /导入…/ })).toBeEnabled();
    expect(mockedRunExport).toHaveBeenCalledWith(
      "/mock/backup.deer-backup",
      expect.any(Function),
    );
  });

  it("取消选择目标路径：不执行导出，busy 复位", async () => {
    mockedPickExport.mockResolvedValue(null);
    render(<BackupSection />);
    fireEvent.click(screen.getByRole("button", { name: /导出…/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /导出…/ })).toBeEnabled(),
    );
    expect(mockedRunExport).not.toHaveBeenCalled();
    expect(screen.queryByText(/导出完成/)).toBeNull();
  });

  it("导出失败：错误以 alert 呈现，按钮恢复可用", async () => {
    mockedPickExport.mockResolvedValue("/mock/backup.deer-backup");
    mockedRunExport.mockRejectedValue(new Error("磁盘空间不足"));
    render(<BackupSection />);
    fireEvent.click(screen.getByRole("button", { name: /导出…/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("磁盘空间不足");
    expect(screen.getByRole("button", { name: /导出…/ })).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("导入成功：展示恢复报告并调度整页刷新", async () => {
    vi.useFakeTimers();
    try {
      const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
      mockedPickImport.mockResolvedValue("/mock/restore.deer-backup");
      mockedRunImport.mockResolvedValue({
        booksAdded: 1,
        booksSkipped: 2,
        coversAdded: 0,
        foldersAdded: 0,
        annotationsAdded: 4,
        manifest: {
          formatVersion: 1,
          appVersion: "0.3.0",
          createdAt: 0,
          books: 3,
          covers: 0,
          annotations: 4,
        },
        settings: {},
      });
      render(<BackupSection />);
      fireEvent.click(screen.getByRole("button", { name: /导入…/ }));
      // fake timers 下不用 waitFor：flush 微任务让结果落地。
      await act(async () => {});

      expect(
        screen.getByText(
          /恢复完成：新增 1 本书（跳过 2 本重复）、0 张封面、0 个文件夹、4 条笔记/,
        ),
      ).toBeTruthy();

      // 结果展示 1.8s 后自动刷新应用。
      expect(reload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1800);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
