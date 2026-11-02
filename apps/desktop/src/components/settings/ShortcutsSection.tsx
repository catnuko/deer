import { Keyboard } from "lucide-react";

type ShortcutItem = { keys: string[]; description: string };
type ShortcutGroup = { title: string; items: ShortcutItem[] };

/** 只读快捷键：全部来自现有代码，未自定义改键（二期）。 */
const GROUPS: ShortcutGroup[] = [
  {
    title: "阅读",
    items: [
      { keys: ["←", "PgUp"], description: "上一页" },
      { keys: ["→", "PgDn"], description: "下一页" },
      {
        keys: ["Esc"],
        description: "关闭阅读浮层（快捷设置、概念地图、AI 面板）",
      },
    ],
  },
  {
    title: "全局",
    items: [
      { keys: ["⌘", ","], description: "打开设置（Windows / Linux 为 Ctrl + ,）" },
      { keys: ["Esc"], description: "关闭设置弹窗" },
    ],
  },
  {
    title: "AI 对话",
    items: [
      { keys: ["Enter"], description: "发送消息" },
      { keys: ["Shift", "Enter"], description: "换行，不发送" },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="border-border bg-muted text-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-mono text-[11px] leading-none">
      {children}
    </kbd>
  );
}

export function ShortcutsSection() {
  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-start gap-3">
        <Keyboard className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="text-muted-foreground text-xs leading-relaxed">
          当前版本的固定快捷键。暂不支持自定义，后续版本再提供改键。
        </p>
      </div>

      {GROUPS.map((group) => (
        <div key={group.title}>
          <p className="mb-2 text-sm font-medium">{group.title}</p>
          <ul className="divide-border border-border divide-y rounded-lg border">
            {group.items.map((item) => (
              <li
                key={`${group.title}-${item.description}`}
                className="flex items-center justify-between gap-4 px-3 py-2.5"
              >
                <span className="text-muted-foreground text-xs leading-relaxed">
                  {item.description}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {item.keys.map((key, index) => (
                    <span key={key} className="flex items-center gap-1">
                      {index > 0 ? (
                        <span className="text-muted-foreground text-[10px]">/</span>
                      ) : null}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}