import { useEffect, useState } from "react";
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
  const onEntryRoute = ENTRY_ROUTES.includes(location.pathname);
  // 打开即挂载；关闭后留在树上播完 150ms 退场，由 onExited 摘除。
  // 状态派生放在渲染期（与 ChatPanel 的 presence 同一手法），
  // 避免关闭/切路由时先被 effect 延迟一帧。
  const [mounted, setMounted] = useState(open);
  const [routeAtMount, setRouteAtMount] = useState(location.pathname);
  if (routeAtMount !== location.pathname) {
    setRouteAtMount(location.pathname);
    // 离开入口路由立即摘除，不播退场；回到入口时按当前开关重建。
    setMounted(open && onEntryRoute);
  }
  if (open && !mounted) setMounted(true);

  // ?ai=1 直接展开面板，便于浏览器截图验证。
  useEffect(() => {
    if (new URLSearchParams(location.search).get("ai") === "1") setOpen(true);
  }, [location.search, setOpen]);

  if (!onEntryRoute || !mounted) return null;

  return (
    <ChatPanel
      book={book}
      open={open}
      // 书架与阅读页同一形态：面板嵌入式停靠在主区右侧、推挤主区，
      // 打开后常驻（点面板外/Esc 不收起），只有面板内关闭按钮能收。
      onExited={() => setMounted(false)}
      onClose={() => setOpen(false)}
    />
  );
}
