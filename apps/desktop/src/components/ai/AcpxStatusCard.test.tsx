// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const acpxEnvCheck = vi.fn();

vi.mock("@/lib/ai/claudeBackend", () => ({
  isTauriRuntime: () => true,
  acpxEnvCheck: () => acpxEnvCheck(),
}));

const { AcpxStatusCard } = await import("./AcpxStatusCard");

afterEach(() => {
  cleanup();
  acpxEnvCheck.mockReset();
});

describe("AcpxStatusCard", () => {
  it("环境就绪：显示 Node / acpx 版本与就绪徽章", async () => {
    acpxEnvCheck.mockResolvedValue({
      ok: true,
      nodeOk: true,
      nodeVersion: "v24.20.0",
      acpxVersion: "0.21.1",
      message: "",
    });
    render(<AcpxStatusCard />);

    expect(await screen.findByText("就绪")).toBeInTheDocument();
    expect(screen.getByText("v24.20.0")).toBeInTheDocument();
    expect(screen.getByText("0.21.1")).toBeInTheDocument();
    expect(screen.queryByText("安装指引：")).not.toBeInTheDocument();
  });

  it("未就绪：显示原因与安装指引，重新检测会再次检查", async () => {
    acpxEnvCheck.mockResolvedValue({
      ok: false,
      nodeOk: false,
      nodeVersion: null,
      acpxVersion: null,
      message: "需要 Node ≥ 22.13（当前：未找到 node）。",
    });
    render(<AcpxStatusCard />);

    expect(await screen.findByText("未就绪")).toBeInTheDocument();
    expect(
      screen.getByText("需要 Node ≥ 22.13（当前：未找到 node）。"),
    ).toBeInTheDocument();
    expect(screen.getByText("安装指引：")).toBeInTheDocument();
    expect(
      screen.getByText("2. npm install -g acpx@0.21.1"),
    ).toBeInTheDocument();
    expect(acpxEnvCheck).toHaveBeenCalledTimes(1);

    screen.getByRole("button", { name: "重新检测" }).click();
    await vi.waitFor(() => expect(acpxEnvCheck).toHaveBeenCalledTimes(2));
  });
});