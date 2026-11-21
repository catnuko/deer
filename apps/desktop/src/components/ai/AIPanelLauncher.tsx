import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useCurrentBook } from "@/lib/ai/currentBook";
import { useAIPanelStore } from "@/store/aiPanelStore";

// ChatPanel 背后是 assistant-ui + AI SDK 的重依赖链：懒加载，
// 书架首屏不拉聊天面板代码，点开 AI 入口时才加载。
const ChatPanel = lazy(() =>
  import("@/components/ai/ChatPanel").then((m) => ({ default: m.ChatPanel })),
);

/** 面板加载中的占位：与面板同宽的空态，避免闪烁。 */
function PanelFallback() {
  return (
    <div
      role="status"
      aria-label="加载中"
      className="bg-panel border-border text-muted-foreground flex h-full w-full items-center justify-center border-l text-sm"
    >
      加载中…
    </div>
  );
}

/** 只在书架页露出入口，避免和阅读页（泳道 B）右侧的 AI 栏抢位置。 */
const ENTRY_ROUTES = ["/bookshelf", "/"];

export function AIPanelLauncher() {
  const location = useLocation();
  // 书架详情页把当前书写进 store；没有（停在书架列表）才回落到 URL 参数。
  const shelfBook = useAIPanelStore((s) => s.book);
  const urlBook = useCurrentBook();
  const book = shelfBook ?? urlBook;
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
    <Suspense fallback={<PanelFallback />}>
      <ChatPanel
        book={book}
        open={open}
        // 书架与阅读页同一形态：面板嵌入式停靠在主区右侧、推挤主区，
        // 打开后常驻（点面板外/Esc 不收起），只有面板内关闭按钮能收。
        onExited={() => setMounted(false)}
        onClose={() => setOpen(false)}
        // 书架没有章节/页概念，只露「这本书说了什么？」；书架不打开书文件，
        // 一期只发问题本身（N1 上下文带书名，桌面端 AI 可借书架 MCP 作答）。
        quickCommands={{ book: {} }}
      />
    </Suspense>
  );
}
