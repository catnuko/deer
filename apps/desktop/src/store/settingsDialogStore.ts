import { create } from "zustand";

type SettingsDialogStore = {
  open: boolean;
  setOpen(open: boolean): void;
  openDialog(): void;
};

/**
 * 设置弹窗的全局开关：书架、阅读页各自只负责按钮，弹窗本体由 App 挂载一次，
 * 任何页面（含 ⌘,）都能打开同一个实例，位置与尺寸不会因入口不同而变化。
 */
export const useSettingsDialogStore = create<SettingsDialogStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  openDialog: () => set({ open: true }),
}));