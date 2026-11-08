import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  isBookshelfSort,
  isStartupView,
  useAppSettings,
} from "@/store/appSettings";

describe("appSettings store", () => {
  beforeEach(() => {
    useAppSettings.getState().reset();
  });

  it("默认启动落在书架、按最近阅读排序", () => {
    expect(DEFAULT_APP_SETTINGS.startupView).toBe("bookshelf");
    expect(DEFAULT_APP_SETTINGS.bookshelfSort).toBe("recent");
    expect(DEFAULT_APP_SETTINGS.aiProvider).toBe("openai-compatible");
    expect(DEFAULT_APP_SETTINGS.aiBaseUrl).toBe(
      "https://open.bigmodel.cn/api/paas/v4",
    );
    expect(DEFAULT_APP_SETTINGS.aiModel).toBe("glm-4.6");
    expect(DEFAULT_APP_SETTINGS.aiApiKey).toBe("");
    expect(useAppSettings.getState().startupView).toBe("bookshelf");
    expect(useAppSettings.getState().bookshelfSort).toBe("recent");
  });

  it("设置项可独立更新", () => {
    useAppSettings.getState().setStartupView("continue");
    useAppSettings.getState().setBookshelfSort("title");
    useAppSettings.getState().setAiProvider("anthropic");
    useAppSettings.getState().setAiBaseUrl("https://example.com/v1");
    useAppSettings.getState().setAiModel("claude-sonnet-4-5");
    useAppSettings.getState().setAiApiKey("test-key");
    expect(useAppSettings.getState().startupView).toBe("continue");
    expect(useAppSettings.getState().bookshelfSort).toBe("title");
    expect(useAppSettings.getState().aiProvider).toBe("anthropic");
    expect(useAppSettings.getState().aiBaseUrl).toBe("https://example.com/v1");
    expect(useAppSettings.getState().aiModel).toBe("claude-sonnet-4-5");
    expect(useAppSettings.getState().aiApiKey).toBe("test-key");
  });

  it("非法持久化值回落默认", () => {
    const migrate = useAppSettings.persist.getOptions().migrate;
    expect(
      migrate?.({ startupView: "reader", bookshelfSort: "size" }, 0),
    ).toEqual({
      startupView: "bookshelf",
      bookshelfSort: "recent",
      aiEngine: "claude",
      aiEngineMode: "auto",
      aiProvider: "openai-compatible",
      aiBaseUrl: DEFAULT_APP_SETTINGS.aiBaseUrl,
      aiModel: DEFAULT_APP_SETTINGS.aiModel,
      aiApiKey: "",
      syncEnabled: false,
      syncUrl: "",
      syncUsername: "",
      syncPassword: "",
      syncBooks: true,
    });
  });

  it("v4 旧数据迁移：aiEngine/aiEngineMode 补默认，云引擎字段保留", () => {
    const migrate = useAppSettings.persist.getOptions().migrate;
    const migrated = migrate?.(
      {
        startupView: "continue",
        bookshelfSort: "title",
        aiProvider: "anthropic",
        aiApiKey: "k",
      },
      4,
    ) as Record<string, unknown>;
    expect(migrated.startupView).toBe("continue");
    expect(migrated.bookshelfSort).toBe("title");
    expect(migrated.aiEngine).toBe("claude");
    expect(migrated.aiEngineMode).toBe("auto");
    expect(migrated.aiProvider).toBe("anthropic");
    expect(migrated.aiApiKey).toBe("k");
  });

  it("v3 旧数据迁移：aiEngine 保留、云引擎字段补默认", () => {
    const migrate = useAppSettings.persist.getOptions().migrate;
    const migrated = migrate?.(
      {
        startupView: "continue",
        bookshelfSort: "title",
        aiEngine: "codex",
        aiApiKey: "k",
      },
      3,
    ) as Record<string, unknown>;
    expect(migrated.startupView).toBe("continue");
    expect(migrated.bookshelfSort).toBe("title");
    expect(migrated.aiEngine).toBe("codex");
    expect(migrated.aiEngineMode).toBe("auto");
    expect(migrated.aiProvider).toBe("openai-compatible");
    expect(migrated.aiApiKey).toBe("k");
  });

  it("非法 aiEngine/aiEngineMode 回落默认", () => {
    const migrate = useAppSettings.persist.getOptions().migrate;
    const migrated = migrate?.(
      { aiEngine: "not-an-engine", aiEngineMode: "magic" },
      5,
    ) as Record<string, unknown>;
    expect(migrated.aiEngine).toBe("claude");
    expect(migrated.aiEngineMode).toBe("auto");
  });

  it("选项守卫只认预设值", () => {
    expect(isStartupView("continue")).toBe(true);
    expect(isStartupView("notes")).toBe(false);
    expect(isBookshelfSort("author")).toBe(true);
    expect(isBookshelfSort("size")).toBe(false);
  });
});