// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CloudEngineCard } from "./CloudEngineCard";
import { useAppSettings } from "@/store/appSettings";

beforeEach(() => {
  useAppSettings.setState({
    aiProvider: "openai-compatible",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "test-model",
    aiApiKey: "sk-test",
  });
});

afterEach(cleanup);

describe("CloudEngineCard", () => {
  it("切换接口类型时清空 Base URL，旧地址不得被新 provider 当端点", async () => {
    const user = userEvent.setup();
    render(<CloudEngineCard />);
    await user.click(screen.getByLabelText("接口类型"));
    await user.click(await screen.findByRole("option", { name: "Anthropic 接口" }));
    expect(useAppSettings.getState().aiProvider).toBe("anthropic");
    expect(useAppSettings.getState().aiBaseUrl).toBe("");
  });
});
