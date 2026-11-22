import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/settings/ConfirmDialog";
import { MEMORY_TYPE_LABELS } from "@/lib/ai/readingContext";
import { useBookStore } from "@/store/bookStore";
import { useMemoryStore, type MemoryEntry } from "@/store/memoryStore";

type PendingClear =
  | { kind: "entry"; entryId: string; content: string }
  | { kind: "book"; bookId: string; bookTitle: string; count: number }
  | { kind: "all"; total: number }
  | null;

type Editing = { entryId: string; draft: string } | null;

type MemoryGroup = {
  bookId: string;
  bookTitle: string;
  entries: MemoryEntry[];
};

/** 确认弹窗里的内容预览：超长截头，避免弹窗被长记忆撑开。 */
function preview(content: string, limit = 40): string {
  const chars = Array.from(content.trim());
  return chars.length <= limit
    ? chars.join("")
    : `${chars.slice(0, limit).join("")}…`;
}

/**
 * 设置页 · AI 分组的读书记忆区块：按书分组查看、编辑、清除记忆条目。
 * 破坏性操作（单条删除 / 按书清除 / 全部清除）统一走 ConfirmDialog 二次确认。
 */
export function MemorySection() {
  const memories = useMemoryStore((s) => s.memories);
  const loadMemory = useMemoryStore((s) => s.load);
  const updateEntry = useMemoryStore((s) => s.updateEntry);
  const deleteEntry = useMemoryStore((s) => s.deleteEntry);
  const clearByBook = useMemoryStore((s) => s.clearByBook);
  const clearAll = useMemoryStore((s) => s.clearAll);
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.load);

  const [pending, setPending] = useState<PendingClear>(null);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    void loadMemory();
    void loadBooks();
  }, [loadMemory, loadBooks]);

  const groups = useMemo(() => {
    const knownIds = new Set(books.map((b) => b.id));
    const grouped: MemoryGroup[] = books
      .filter((b) => (memories[b.id]?.length ?? 0) > 0)
      .map((b) => ({
        bookId: b.id,
        bookTitle: b.title,
        entries: memories[b.id],
      }));
    // 书已删除但记忆还在的条目也展示出来，保证用户能看见并清掉所有落盘内容。
    for (const [bookId, entries] of Object.entries(memories)) {
      if (entries.length > 0 && !knownIds.has(bookId)) {
        grouped.push({ bookId, bookTitle: "已删除的书", entries });
      }
    }
    return grouped;
  }, [books, memories]);

  const total = useMemo(
    () => groups.reduce((sum, g) => sum + g.entries.length, 0),
    [groups],
  );

  function saveEdit() {
    if (!editing) return;
    const content = editing.draft.trim();
    if (content) updateEntry(editing.entryId, { content });
    setEditing(null);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-6 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">读书记忆</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            AI 面板关闭时自动总结的跨会话记忆，按书保存，新会话会注入对应书的记忆。你可以查看、编辑或清除。
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={total === 0}
          onClick={() => setPending({ kind: "all", total })}
        >
          <Trash2 className="size-3.5" />
          清空记忆
        </Button>
      </div>

      {total === 0 ? (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
          暂无记忆
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.bookId}>
              <div className="flex items-center justify-between gap-2 py-1">
                <p className="text-sm font-medium">
                  {group.bookTitle}
                  <span className="text-muted-foreground ml-2 text-xs">
                    {group.entries.length} 条
                  </span>
                </p>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setPending({
                      kind: "book",
                      bookId: group.bookId,
                      bookTitle: group.bookTitle,
                      count: group.entries.length,
                    })
                  }
                >
                  清除本书
                </Button>
              </div>
              <ul className="space-y-2">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="border-border rounded-lg border px-3 py-2"
                  >
                    {editing?.entryId === entry.id ? (
                      <div>
                        <Textarea
                          value={editing.draft}
                          aria-label="编辑记忆内容"
                          className="min-h-16"
                          onChange={(e) =>
                            setEditing({ entryId: entry.id, draft: e.target.value })
                          }
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setEditing(null)}
                          >
                            取消
                          </Button>
                          <Button
                            size="xs"
                            disabled={editing.draft.trim().length === 0}
                            onClick={saveEdit}
                          >
                            保存
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-muted-foreground text-xs">
                            {MEMORY_TYPE_LABELS[entry.type]} · 更新于{" "}
                            {new Date(entry.updatedAt).toLocaleString("zh-CN")}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap">
                            {entry.content}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="编辑记忆"
                            onClick={() =>
                              setEditing({
                                entryId: entry.id,
                                draft: entry.content,
                              })
                            }
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            aria-label="删除记忆"
                            onClick={() =>
                              setPending({
                                kind: "entry",
                                entryId: entry.id,
                                content: entry.content,
                              })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pending?.kind === "entry"}
        title="删除这条记忆？"
        description={`将删除「${preview(pending?.kind === "entry" ? pending.content : "")}」。此操作不可恢复。`}
        confirmLabel="删除"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending?.kind === "entry") deleteEntry(pending.entryId);
          setPending(null);
        }}
      />

      <ConfirmDialog
        open={pending?.kind === "book"}
        title={`清除《${pending?.kind === "book" ? pending.bookTitle : ""}》的记忆？`}
        description={`将删除该书的 ${pending?.kind === "book" ? pending.count : 0} 条记忆。此操作不可恢复。`}
        confirmLabel="清除"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending?.kind === "book") clearByBook(pending.bookId);
          setPending(null);
        }}
      />

      <ConfirmDialog
        open={pending?.kind === "all"}
        title="清空全部读书记忆？"
        description={`将删除全部书的 ${pending?.kind === "all" ? pending.total : 0} 条记忆。此操作不可恢复。`}
        confirmLabel="全部清除"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending?.kind === "all") clearAll();
          setPending(null);
        }}
      />
    </div>
  );
}
