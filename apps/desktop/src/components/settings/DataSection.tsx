import { useEffect, useMemo, useState } from "react";
import { FolderOpen, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SettingRow } from "@/components/settings/SettingRow";
import { ConfirmDialog } from "@/components/settings/ConfirmDialog";
import { isTauri } from "@/lib/platform";
import { summarizeStorage } from "@/lib/storageSummary";
import { useDataDir } from "@/lib/useDataDir";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { useChatStore } from "@/store/chatStore";

type PendingClear = "annotations" | "chat" | null;

/** 数据组：本机数据目录、只读存储概况，以及两个带二次确认的清空操作。 */
export function DataSection() {
  const desktop = isTauri();
  const dataDir = useDataDir();
  const [openError, setOpenError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingClear>(null);

  const books = useBookStore((state) => state.books);
  const loadBooks = useBookStore((state) => state.load);
  const annotations = useAnnotationStore((state) => state.annotations);
  const loadAnnotations = useAnnotationStore((state) => state.load);
  const messages = useChatStore((state) => state.messages);
  const loadChat = useChatStore((state) => state.load);
  const clearAllAnnotations = useAnnotationStore(
    (state) => state.clearAllAnnotations,
  );
  const clearAllChat = useChatStore((state) => state.clearAllChat);

  useEffect(() => {
    void loadBooks();
    void loadAnnotations();
    void loadChat();
  }, [loadBooks, loadAnnotations, loadChat]);

  const summary = useMemo(
    () => summarizeStorage({ books, annotations, messages }),
    [books, annotations, messages],
  );

  async function openDataDir() {
    if (!dataDir) return;
    setOpenError(null);
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(dataDir);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  }

  function confirmClear() {
    if (pending === "annotations") clearAllAnnotations();
    if (pending === "chat") clearAllChat();
    setPending(null);
  }

  return (
    <div className="max-w-xl space-y-2">
      <SettingRow
        title="数据目录"
        description={
          desktop
            ? "书籍文件、封面与阅读记录都保存在这个目录。"
            : "浏览器预览模式无本地数据目录，桌面应用内可用。"
        }
        className="items-start"
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!desktop || !dataDir}
          onClick={() => void openDataDir()}
        >
          <FolderOpen className="size-3.5" />
          打开文件夹
        </Button>
      </SettingRow>

      <div className="border-border bg-muted/30 -mt-1 rounded-lg border px-3 py-2">
        <p className="font-mono text-xs leading-relaxed break-all">
          {desktop ? (dataDir ?? "读取中…") : "浏览器预览模式无本地数据目录"}
        </p>
        {openError ? (
          <p className="text-destructive mt-1 text-xs leading-relaxed">
            打开失败：{openError}
          </p>
        ) : null}
      </div>

      <Separator />

      <div className="py-2">
        <p className="text-sm font-medium">存储概况</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {summary.bookCount} 本书 · {summary.annotationCount} 条标注 · 其中{" "}
          {summary.noteCount} 条含笔记 · {summary.chatThreadCount} 个会话共{" "}
          {summary.chatMessageCount} 条聊天消息
        </p>
      </div>

      <Separator />

      <SettingRow
        title="清空笔记"
        description="删除全部书里的高亮与笔记，立即生效且不可恢复。"
      >
        <Button
          variant="destructive"
          size="sm"
          disabled={summary.annotationCount === 0}
          onClick={() => setPending("annotations")}
        >
          <Trash2 className="size-3.5" />
          清空笔记
        </Button>
      </SettingRow>

      <SettingRow
        title="清空聊天记录"
        description="只清空本机 Deer 保存的聊天记录，不影响 acpx 自己的会话缓存（~/.acpx）。"
      >
        <Button
          variant="destructive"
          size="sm"
          disabled={summary.chatMessageCount === 0}
          onClick={() => setPending("chat")}
        >
          <MessageSquare className="size-3.5" />
          清空聊天记录
        </Button>
      </SettingRow>

      <ConfirmDialog
        open={pending === "annotations"}
        title="清空全部笔记？"
        description={`将删除全部书籍的 ${summary.annotationCount} 条高亮与笔记，包括其中的 ${summary.noteCount} 条笔记内容。此操作不可恢复。`}
        onCancel={() => setPending(null)}
        onConfirm={confirmClear}
      />

      <ConfirmDialog
        open={pending === "chat"}
        title="清空聊天记录？"
        description={`将删除本机保存的 ${summary.chatMessageCount} 条聊天消息（共 ${summary.chatThreadCount} 个会话）。acpx 在 ~/.acpx 下的会话缓存不会被删除。`}
        onCancel={() => setPending(null)}
        onConfirm={confirmClear}
      />
    </div>
  );
}