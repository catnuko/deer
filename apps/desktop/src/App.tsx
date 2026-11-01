import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AIPanelLauncher } from "@/components/ai/AIPanelLauncher";
import { AppShell } from "@/components/layout/AppShell";
import { BookshelfPage } from "@/routes/bookshelf/BookshelfPage";
import { ReaderPage } from "@/routes/reader/ReaderPage";
import { NotesPage } from "@/routes/notes/NotesPage";
import { SettingsPage } from "@/routes/settings/SettingsPage";

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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/bookshelf" replace />} />
        </Route>
      </Routes>
    </>
  );
}
