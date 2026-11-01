import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { useCurrentBook } from "@/lib/ai/currentBook";
import { useAIPanelStore } from "@/store/aiPanelStore";

/** 只在书架页露出入口，避免和阅读页（泳道 B）右侧的 AI 栏抢位置。 */
const ENTRY_ROUTES = ["/bookshelf", "/"];

export function AIPanelLauncher() {
  const location = useLocation();
  const book = useCurrentBook();
  const open = useAIPanelStore((s) => s.open);
  const setOpen = useAIPanelStore((s) => s.setOpen);

  // ?ai=1 直接展开面板，便于浏览器截图验证。
  useEffect(() => {
    if (new URLSearchParams(location.search).get("ai") === "1") setOpen(true);
  }, [location.search, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!ENTRY_ROUTES.includes(location.pathname)) return null;

  if (!open) return null;

  return <ChatPanel book={book} onClose={() => setOpen(false)} />;
}
