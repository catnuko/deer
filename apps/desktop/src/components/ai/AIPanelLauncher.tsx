import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { TextureButton } from "@/components/ui/texture-button";
import { useCurrentBook } from "@/lib/ai/currentBook";

/** 只在书架页露出入口，避免和阅读页（泳道 B）右侧的 AI 栏抢位置。 */
const ENTRY_ROUTES = ["/bookshelf", "/"];

export function AIPanelLauncher() {
  const location = useLocation();
  const book = useCurrentBook();
  // ?ai=1 直接展开面板，便于浏览器截图验证。
  const [open, setOpen] = useState(
    () => new URLSearchParams(location.search).get("ai") === "1",
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!ENTRY_ROUTES.includes(location.pathname)) return null;

  if (open) {
    return <ChatPanel book={book} onClose={() => setOpen(false)} />;
  }

  return (
    <TextureButton
      variant="primary"
      size="default"
      className="fixed right-6 bottom-6 z-30 shadow-lg"
      onClick={() => setOpen(true)}
      aria-label="打开 AI 伴读面板"
    >
      <span className="flex items-center gap-2">
        <Sparkles className="size-4" />
        AI 伴读
      </span>
    </TextureButton>
  );
}
