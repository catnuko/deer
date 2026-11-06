import { useEffect, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";

/** M5a 起不再有全局侧边栏：书架是唯一主页，其余页面通过页内入口进出。 */
export function AppShell({ children }: { children?: ReactNode }) {
  // ⌘, / Ctrl+, 在书架、阅读、笔记页都能打开设置。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        useSettingsDialogStore.getState().openDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="bg-background text-foreground relative flex h-screen w-full overflow-hidden">
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      {children}
    </div>
  );
}