import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AIPanelLauncher } from "@/components/ai/AIPanelLauncher";
import { AppShell } from "@/components/layout/AppShell";
import { BookshelfPage } from "@/routes/bookshelf/BookshelfPage";
import { ReaderPage } from "@/routes/reader/ReaderPage";
import { NotesPage } from "@/routes/notes/NotesPage";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

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
          <Route path="/reader" element={<ReaderPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="*" element={<Navigate to="/bookshelf" replace />} />
        </Route>
      </Routes>
      {/* 全局只挂一个设置弹窗：书架、阅读页与 ⌘, 共用同一实例。 */}
      <SettingsDialog />
    </>
  );
}
