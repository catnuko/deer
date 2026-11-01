import { create } from "zustand";

interface AIPanelStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** 书架 AI 面板开关，临时 UI 状态不持久化；顶栏入口按钮与面板本体共享。 */
export const useAIPanelStore = create<AIPanelStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
