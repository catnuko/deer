import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { BookshelfPage } from "@/routes/bookshelf/BookshelfPage";
import { ReaderPage } from "@/routes/reader/ReaderPage";
import { NotesPage } from "@/routes/notes/NotesPage";
import { SettingsPage } from "@/routes/settings/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/bookshelf" replace />} />
        <Route path="/bookshelf" element={<BookshelfPage />} />
        <Route path="/reader" element={<ReaderPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/bookshelf" replace />} />
      </Route>
    </Routes>
  );
}
