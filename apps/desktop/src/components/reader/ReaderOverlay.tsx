import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/useReducedMotion";

/** 退出规格：panel 播 150ms 退场（仅大面积面板），none 立即摘除。 */
export type OverlayExit = "panel" | "none";
/** 进入形态：drop 自上缘落入 4px；scale 用于无锚点的概念地图。 */
export type OverlayVariant = "drop" | "scale";

type ReaderOverlayProps = {
  open: boolean;
  onClose: () => void;
  /**
   * 关闭来源为 navigation（翻页、跳章）时立即摘除：150ms 残影会盖在
   * 翻页动画上（motion.md §M2）。父级与 open=false 同一次更新里置位。
   */
  immediate?: boolean;
  exit?: OverlayExit;
  variant?: OverlayVariant;
  role?: string;
  ariaLabel?: string;
  /** 承载定位与面板外观（位置、宽度、边框、阴影）。 */
  className?: string;
  /** 点浮层外关闭；工具栏按钮除外（否则与按钮自身的 toggle 打架）。 */
  closeOnOutside?: boolean;
  closeOnEscape?: boolean;
  /**
   * 视口居中模态（概念地图）：挂到 body、铺遮罩、用网格居中。
   * 不要用 translate(-50%,-50%) 居中——那会和缩放入场的 transform 打架。
   */
  modal?: boolean;
  children: ReactNode;
};

const EXIT_MS = 150;

/**
 * L1 阅读浮层壳（motion.md §2）：统一 presence、层级 z-20、Esc 与点外关闭。
 * 进入/退出的位移与时长只在这里定义一次，面板自身不再写动画。
 *
 * 挂载策略：`open` 为 false 且允许退出动画时保留 DOM 到动画结束，这样
 * 「进有出有」成立；navigation 关闭与减少动态效果下直接摘除。
 */
export function ReaderOverlay({
  open,
  onClose,
  immediate = false,
  exit = "none",
  variant = "drop",
  role = "group",
  ariaLabel,
  className,
  closeOnOutside = false,
  closeOnEscape = true,
  modal = false,
  children,
}: ReaderOverlayProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [presence, setPresence] = useState(() => ({
    shown: open,
    closing: false,
  }));

  // 渲染期跟着 open 校正挂载态（React 的「随 props 调整 state」写法），
  // 不在 effect 里同步 setState，避免级联渲染。
  if (open && (!presence.shown || presence.closing)) {
    setPresence({ shown: true, closing: false });
  } else if (!open && presence.shown) {
    if (immediate || exit === "none" || prefersReducedMotion()) {
      setPresence({ shown: false, closing: false });
    } else if (!presence.closing) {
      setPresence({ shown: true, closing: true });
    }
  }

  useEffect(() => {
    if (!presence.closing) return;
    const timer = window.setTimeout(
      () => setPresence({ shown: false, closing: false }),
      EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [presence.closing]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  useEffect(() => {
    if (!open || !closeOnOutside) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (surfaceRef.current?.contains(target)) return;
      // 工具栏按钮自己负责开合，这里放过，避免 pointerdown 关闭后
      // 按钮的 click 又按旧状态把它打开。
      if (target.closest('[id^="reader-toolbar-"]')) return;
      onClose();
    };
    // 捕获阶段：模态层在包装元素上 stopPropagation 挡正文，冒泡阶段会先被掐断。
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, closeOnOutside, onClose]);

  if (!presence.shown) return null;

  const surface = (
    <div
      ref={surfaceRef}
      role={role}
      aria-label={ariaLabel}
      aria-modal={modal ? true : undefined}
      className={cn(
        modal ? "relative" : "absolute z-20",
        presence.closing
          ? variant === "scale"
            ? "deer-overlay-out-scale"
            : "deer-overlay-out-drop"
          : variant === "scale"
            ? "deer-overlay-in-scale"
            : "deer-overlay-in-drop",
        className,
      )}
      onClick={(event) => {
        // 别让点击冒泡到正文的边缘翻页捕获层。
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );

  if (!modal) return surface;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-black/10",
          presence.closing ? "deer-backdrop-out" : "deer-backdrop-in",
        )}
      />
      {surface}
    </div>,
    document.body,
  );
}