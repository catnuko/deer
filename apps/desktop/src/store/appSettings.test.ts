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
    expect(DEFAULT_APP_SETTINGS).toEqual({
      startupView: "bookshelf",
      bookshelfSort: "recent",
      aiEngine: DEFAULT_APP_SETTINGS.aiEngine,
    });
    expect(useAppSettings.getState().startupView).toBe("bookshelf");
    expect(useAppSettings.getState().bookshelfSort).toBe("recent");
  });

  it("设置项可独立更新", () => {
    useAppSettings.getState().setStartupView("continue");
    useAppSettings.getState().setBookshelfSort("title");
    expect(useAppSettings.getState().startupView).toBe("continue");
    expect(useAppSettings.getState().bookshelfSort).toBe("title");
  });

  it("非法持久化值回落默认", () => {
    const migrate = useAppSettings.persist.getOptions().migrate;
    expect(
      migrate?.({ startupView: "reader", bookshelfSort: "size" }, 0),
    ).toEqual({
      startupView: "bookshelf",
      bookshelfSort: "recent",
      aiEngine: DEFAULT_APP_SETTINGS.aiEngine,
    });
  });

  it("选项守卫只认预设值", () => {
    expect(isStartupView("continue")).toBe(true);
    expect(isStartupView("notes")).toBe(false);
    expect(isBookshelfSort("author")).toBe(true);
    expect(isBookshelfSort("size")).toBe(false);
  });
});