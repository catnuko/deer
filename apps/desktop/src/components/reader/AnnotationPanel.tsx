import { StickyNote, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { StoredAnnotation } from "@/store/annotationStore";

type AnnotationPanelProps = {
  annotations: StoredAnnotation[];
  onSelect: (cfi: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function formatTime(createdAt: number): string {
  const date = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 笔记管理面板（M3）：当前书的全部高亮/笔记，点击跳原文，列表内删除。 */
export function AnnotationPanel({
  annotations,
  onSelect,
  onDelete,
  onClose,
}: AnnotationPanelProps) {
  return (
    <aside
      className={cn(
        "border-border bg-sidebar flex w-72 shrink-0 flex-col border-r",
      )}
      aria-label="笔记列表"
    >
      <div className="text-muted-foreground flex h-10 shrink-0 items-center gap-2 px-4 text-xs font-medium">
        <StickyNote className="size-3.5" />
        笔记与高亮
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          aria-label="关闭笔记列表"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {annotations.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-6 text-center text-xs">
          还没有高亮或笔记，去正文里划一段试试。
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-1 px-2 pb-4">
            {annotations.map((annotation) => (
              <li
                key={annotation.id}
                className="bg-background hover:bg-sidebar-accent group relative rounded-md"
              >
                <button
                  type="button"
                  onClick={() => onSelect(annotation.cfi)}
                  className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: annotation.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground line-clamp-2 block text-[13px] leading-snug">
                      {annotation.excerpt || annotation.note || "（无文本摘录）"}
                    </span>
                    {annotation.note && annotation.excerpt ? (
                      <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-snug">
                        {annotation.note}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground mt-1 block text-[11px] tabular-nums">
                      {formatTime(annotation.createdAt)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="删除这条笔记"
                  className="absolute top-1.5 right-1 size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onDelete(annotation.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </aside>
  );
}
