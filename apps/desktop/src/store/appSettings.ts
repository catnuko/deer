import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  isAiProviderKind,
  type AiProviderKind,
} from "@/lib/ai/cloudProvider";
import { DEFAULT_AI_ENGINE, isAiEngineId } from "@/lib/ai/engines";

export const AI_ENGINE_MODES = ["auto", "local", "cloud"] as const;
export type AiEngineMode = (typeof AI_ENGINE_MODES)[number];

export function isAiEngineMode(value: string): value is AiEngineMode {
  return (AI_ENGINE_MODES as readonly string[]).includes(value);
}

export const STARTUP_VIEWS = ["bookshelf", "continue"] as const;
export type StartupView = (typeof STARTUP_VIEWS)[number];

export const BOOKSHELF_SORTS = ["recent", "title", "author", "added"] as const;
export type BookshelfSort = (typeof BOOKSHELF_SORTS)[number];

export type AppSettings = {
  /** 冷启动落在书架，还是直接接着上次读的书。 */
  startupView: StartupView;
  bookshelfSort: BookshelfSort;
  /** AI 伴读选中的本地引擎（acpx agent id），本地链路聊天与会话命名都按它走。 */
  aiEngine: string;
  /** 引擎选择模式：自动（本地可用走本地，否则云）/ 仅本地 / 仅云。 */
  aiEngineMode: AiEngineMode;
  /** 云引擎 provider 类型：OpenAI 兼容接口或 Anthropic 接口。 */
  aiProvider: AiProviderKind;
  /** 云引擎接口地址（OpenAI 兼容端点完整 base URL）。 */
  aiBaseUrl: string;
  /** 云引擎模型名（可编辑文本，任意型号）。 */
  aiModel: string;
  /** 云引擎 API Key，仅存本机持久化，绝不进代码/git。 */
  aiApiKey: string;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  startupView: "bookshelf",
  bookshelfSort: "recent",
  aiEngine: DEFAULT_AI_ENGINE,
  aiEngineMode: "auto",
  aiProvider: DEFAULT_AI_PROVIDER,
  aiBaseUrl: DEFAULT_AI_BASE_URL,
  aiModel: DEFAULT_AI_MODEL,
  aiApiKey: "",
};

export function isStartupView(value: string): value is StartupView {
  return (STARTUP_VIEWS as readonly string[]).includes(value);
}

export function isBookshelfSort(value: string): value is BookshelfSort {
  return (BOOKSHELF_SORTS as readonly string[]).includes(value);
}

type AppSettingsStore = AppSettings & {
  setStartupView(startupView: StartupView): void;
  setBookshelfSort(bookshelfSort: BookshelfSort): void;
  setAiEngine(aiEngine: string): void;
  setAiEngineMode(aiEngineMode: AiEngineMode): void;
  setAiProvider(aiProvider: AiProviderKind): void;
  setAiBaseUrl(aiBaseUrl: string): void;
  setAiModel(aiModel: string): void;
  setAiApiKey(aiApiKey: string): void;
  reset(): void;
};

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useAppSettings = create<AppSettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_APP_SETTINGS,
      setStartupView: (startupView) => set({ startupView }),
      setBookshelfSort: (bookshelfSort) => set({ bookshelfSort }),
      setAiEngine: (aiEngine) => set({ aiEngine }),
      setAiEngineMode: (aiEngineMode) => set({ aiEngineMode }),
      setAiProvider: (aiProvider) => set({ aiProvider }),
      setAiBaseUrl: (aiBaseUrl) => set({ aiBaseUrl }),
      setAiModel: (aiModel) => set({ aiModel }),
      setAiApiKey: (aiApiKey) => set({ aiApiKey }),
      reset: () => set({ ...DEFAULT_APP_SETTINGS }),
    }),
    {
      name: "deer-app-settings",
      version: 5,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
      partialize: ({
        startupView,
        bookshelfSort,
        aiEngine,
        aiEngineMode,
        aiProvider,
        aiBaseUrl,
        aiModel,
        aiApiKey,
      }) => ({
        startupView,
        bookshelfSort,
        aiEngine,
        aiEngineMode,
        aiProvider,
        aiBaseUrl,
        aiModel,
        aiApiKey,
      }),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...state,
          startupView:
            typeof state.startupView === "string" &&
            isStartupView(state.startupView)
              ? state.startupView
              : DEFAULT_APP_SETTINGS.startupView,
          bookshelfSort:
            typeof state.bookshelfSort === "string" &&
            isBookshelfSort(state.bookshelfSort)
              ? state.bookshelfSort
              : DEFAULT_APP_SETTINGS.bookshelfSort,
          aiEngine:
            typeof state.aiEngine === "string" && isAiEngineId(state.aiEngine)
              ? state.aiEngine
              : DEFAULT_APP_SETTINGS.aiEngine,
          aiEngineMode: isAiEngineMode(String(state.aiEngineMode))
            ? (state.aiEngineMode as AiEngineMode)
            : DEFAULT_APP_SETTINGS.aiEngineMode,
          aiProvider: isAiProviderKind(String(state.aiProvider))
            ? (state.aiProvider as AiProviderKind)
            : DEFAULT_APP_SETTINGS.aiProvider,
          aiBaseUrl:
            typeof state.aiBaseUrl === "string"
              ? state.aiBaseUrl
              : DEFAULT_APP_SETTINGS.aiBaseUrl,
          aiModel:
            typeof state.aiModel === "string"
              ? state.aiModel
              : DEFAULT_APP_SETTINGS.aiModel,
          aiApiKey:
            typeof state.aiApiKey === "string"
              ? state.aiApiKey
              : DEFAULT_APP_SETTINGS.aiApiKey,
        };
      },
    },
  ),
);