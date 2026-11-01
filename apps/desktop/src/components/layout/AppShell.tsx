import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";

/** M5a 起不再有全局侧边栏：书架是唯一主页，其余页面通过页内入口进出。 */
export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <div className="bg-background text-foreground flex h-screen w-full overflow-hidden">
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      {children}
    </div>
  );
}
