import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AIPanelLauncher } from "@/components/ai/AIPanelLauncher";
import { AppShell } from "@/components/layout/AppShell";
import { BookshelfPage } from "@/routes/bookshelf/BookshelfPage";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

// 阅读页/笔记页与书架首屏无关：React.lazy 拆 chunk，书架首屏只加载书架所需代码。
// Tauri 以相对路径从 tauri://localhost 加载产物，默认 base "./" 下动态 import 可用。
const ReaderPage = lazy(() =>
  import("@/routes/reader/ReaderPage").then((m) => ({ default: m.ReaderPage })),
);
const NotesPage = lazy(() =>
  import("@/routes/notes/NotesPage").then((m) => ({ default: m.NotesPage })),
);

/** 懒加载路由的占位：阅读页/笔记页按秒级内完成加载，仅防白屏闪烁。 */
function RouteFallback() {
  return (
    <div
      role="status"
      aria-label="加载中"
      className="text-muted-foreground flex h-full w-full items-center justify-center text-sm"
    >
      加载中…
    </div>
  );
}

export default function App() {
  // 首页重定向要带上查询串，否则 `?preview=1`、`?ai=1` 这类参数在跳转时丢失。
  const { search } = useLocation();

  return (
    <>
      <Routes>
        <Route
          element={
            <AppShell>
              <AIPanelLauncher />
            </AppShell>
          }
        >
          <Route index element={<Navigate to={`/bookshelf${search}`} replace />} />
          <Route path="/bookshelf" element={<BookshelfPage />} />
          <Route
            path="/reader"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ReaderPage />
              </Suspense>
            }
          />
          <Route
            path="/notes"
            element={
              <Suspense fallback={<RouteFallback />}>
                <NotesPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/bookshelf" replace />} />
        </Route>
      </Routes>
      {/* 全局只挂一个设置弹窗：书架、阅读页与 ⌘, 共用同一实例。 */}
      <SettingsDialog />
    </>
  );
}
