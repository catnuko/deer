import { create } from "zustand";
import type { CurrentBook } from "@/lib/ai/currentBook";

interface AIPanelStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** 书架详情页打开时绑定当前书；为空时面板回落到 URL 参数/演示书。 */
  book: CurrentBook | null;
  setBook: (book: CurrentBook | null) => void;
}

/** 书架 AI 面板开关，临时 UI 状态不持久化；顶栏入口按钮与面板本体共享。 */
export const useAIPanelStore = create<AIPanelStore>((set) => ({
  open: false,
  // 关闭面板即解除详情书绑定，下次从书架顶栏打开不按旧书作答。
  setOpen: (open) => set(open ? { open } : { open, book: null }),
  book: null,
  setBook: (book) => set({ book }),
}));