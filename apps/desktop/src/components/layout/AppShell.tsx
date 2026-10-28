import { NavLink, Outlet } from "react-router-dom";
import {
  BookOpen,
  Library,
  NotebookPen,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/bookshelf", label: "书架", icon: Library },
  { to: "/reader", label: "阅读", icon: BookOpen },
  { to: "/notes", label: "笔记", icon: NotebookPen },
  { to: "/settings", label: "设置", icon: SettingsIcon },
] as const;

export function AppShell() {
  return (
    <div className="bg-background text-foreground flex h-screen w-full overflow-hidden">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-56 shrink-0 flex-col border-r">
        <div className="flex h-14 items-center gap-2 px-4">
          <span className="text-base font-semibold tracking-tight">Deer</span>
          <span className="text-muted-foreground text-xs">阅读器</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2 py-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="text-muted-foreground border-sidebar-border border-t px-4 py-3 text-xs">
          本地运行 · v0.1.0
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
