import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  BookPlus,
  Folder,
  FolderMinus,
  FolderPlus,
  Info,
  Library,
  MoreHorizontal,
  NotebookText,
  Pencil,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TextureButton } from "@/components/ui/texture-button";
import { PREVIEW_BOOKS, PREVIEW_FOLDERS } from "@/lib/preview";
import { isTauri } from "@/lib/platform";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import type { Book, Folder as BookFolder } from "@/lib/types";
import { useBookStore } from "@/store/bookStore";
import { useAIPanelStore } from "@/store/aiPanelStore";
import { useAppSettings } from "@/store/appSettings";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";
import { BookCard } from "./BookCard";
import { BookDetailView } from "./BookDetailView";
import { ContinueReadingCard } from "./ContinueReadingCard";
import { FolderNameDialog } from "./FolderNameDialog";
import { continueReadingBookOf } from "./continueReading";
import { sortBooks } from "./sortBooks";

type FolderForm =
  | { mode: "create" }
  | { mode: "rename"; folder: BookFolder };

/** 选中「未分类」视图的哨兵值；null 表示「全部书籍」，其余是文件夹 id。 */
const UNCATEGORIZED = "uncategorized";

const MIGRATION_NOTICE_COPY =
  "书架已升级为文件夹：原来的每个书架都变成了同名文件夹。同时放在多个书架的书，已归入其中最靠前的一个；没归类的书在「未分类」里随时可以移动。";

/** 冷启动「继续上次阅读」每个进程只处理一次；从阅读页返回书架不再跳。 */
let startupContinueHandled = false;

export function BookshelfPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const aiPanelOpen = useAIPanelStore((s) => s.open);
  const setAIPanelOpen = useAIPanelStore((s) => s.setOpen);
  const setAIPanelBook = useAIPanelStore((s) => s.setBook);
  // 只有浏览器里（没有 Tauri）用 ?preview=1 看界面用，桌面应用不会走到这条分支。
  const preview = !isTauri() && searchParams.get("preview") === "1";

  const storeBooks = useBookStore((state) => state.books);
  const storeFolders = useBookStore((state) => state.folders);
  const ready = useBookStore((state) => state.ready);
  const importing = useBookStore((state) => state.importing);
  const storeError = useBookStore((state) => state.error);
  const migrationNotice = useBookStore((state) => state.migrationNotice);
  const load = useBookStore((state) => state.load);
  const importEpub = useBookStore((state) => state.importEpub);
  const removeBook = useBookStore((state) => state.removeBook);
  const createFolder = useBookStore((state) => state.createFolder);
  const renameFolder = useBookStore((state) => state.renameFolder);
  const deleteFolder = useBookStore((state) => state.deleteFolder);
  const moveBookToFolder = useBookStore((state) => state.moveBookToFolder);
  const dismissMigrationNotice = useBookStore(
    (state) => state.dismissMigrationNotice,
  );
  const clearError = useBookStore((state) => state.clearError);

  // null = 全部书籍；UNCATEGORIZED = 未分类；其余是文件夹 id。
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bookToDelete, setBookToDelete] = useState<Book | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<BookFolder | null>(null);
  const [folderForm, setFolderForm] = useState<FolderForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 整页详情（设计稿 v2）：覆盖在书架上，右滑进 / 左滑出；<820px 退化为底部全屏 sheet。
  const wide = useMediaQuery("(min-width: 820px)");
  // 只存 id，归属等字段随书库实时更新（移动文件夹后详情立即反映）。
  const [detailBookId, setDetailBookId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  const books = preview ? PREVIEW_BOOKS : storeBooks;
  const folders = preview ? PREVIEW_FOLDERS : storeFolders;
  const isReady = preview || ready;

  const detailBook = useMemo(
    () => books.find((book) => book.id === detailBookId) ?? null,
    [books, detailBookId],
  );

  const openDetail = useCallback(
    (book: Book) => {
      // 记下触发元素，返回时把焦点还给它。
      detailTriggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDetailBookId(book.id);
      // 详情页的 AI 面板按这本真实书作答（书架没有 ?book= 参数，否则会回落演示书）。
      setAIPanelBook({ id: book.id, title: book.title });
      requestAnimationFrame(() => setDetailOpen(true));
    },
    [setAIPanelBook],
  );

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    // 面板还开着就保持这本书的会话，别把对话切到演示书；面板关闭时由 store 释放绑定。
    if (!useAIPanelStore.getState().open) setAIPanelBook(null);
    detailTriggerRef.current?.focus();
    detailTriggerRef.current = null;
  }, [setAIPanelBook]);

  /** 详情页「问 AI」：面板按当前书打开；窄屏浮层要收起，但书上下文留给面板。 */
  const askAIFromDetail = useCallback(() => {
    if (!detailBook) return;
    setAIPanelBook({ id: detailBook.id, title: detailBook.title });
    setAIPanelOpen(true);
  }, [detailBook, setAIPanelBook, setAIPanelOpen]);

  const askAIFromDetailSheet = useCallback(() => {
    askAIFromDetail();
    // 面板已在收起浮层前打开；这里只收浮层、不清书，避免两个全屏层叠。
    setDetailOpen(false);
    detailTriggerRef.current = null;
  }, [askAIFromDetail]);

  // 离开书架（进阅读页等）时清掉详情书绑定，避免下次打开面板按旧书作答。
  useEffect(() => () => setAIPanelBook(null), [setAIPanelBook]);

  useEffect(() => {
    void load();
  }, [load]);

  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  // 文件夹被删掉后，筛选自然退回「全部」——用派生值而不是副作用改 state。
  const activeFolder =
    activeId && activeId !== UNCATEGORIZED
      ? folderById.get(activeId) ?? null
      : null;
  const view: "all" | "uncategorized" | "folder" = activeFolder
    ? "folder"
    : activeId === UNCATEGORIZED
      ? "uncategorized"
      : "all";

  const bookshelfSort = useAppSettings((state) => state.bookshelfSort);
  const startupView = useAppSettings((state) => state.startupView);
  const openSettings = useSettingsDialogStore((state) => state.openDialog);

  const visibleBooks = useMemo(() => {
    let filtered = books;
    if (view === "folder" && activeFolder) {
      filtered = books.filter((book) => book.folderId === activeFolder.id);
    } else if (view === "uncategorized") {
      filtered = books.filter(
        (book) => !book.folderId || !folderById.has(book.folderId),
      );
    }
    return sortBooks(filtered, bookshelfSort);
  }, [activeFolder, books, bookshelfSort, folderById, view]);

  const countInFolder = (folderId: string) =>
    books.filter((book) => book.folderId === folderId).length;
  const uncategorizedCount = books.filter(
    (book) => !book.folderId || !folderById.has(book.folderId),
  ).length;

  const viewTitle =
    activeFolder?.name ?? (view === "uncategorized" ? "未分类" : "全部书籍");

  // 「继续阅读」卡片（M5a）：有保存过阅读位置的书才显示；按文件夹筛选时不打扰。
  const continueReading = useMemo(
    () => (isReady && view === "all" ? continueReadingBookOf(books) : null),
    [books, isReady, view],
  );

  // 冷启动直达上次阅读：只在进程内第一次书架就绪时判定一次，
  // 返回书架不得再跳；没有阅读位置时照常落在书架。
  useEffect(() => {
    if (!isReady || preview || startupContinueHandled) return;
    startupContinueHandled = true;
    if (startupView !== "continue") return;
    const target = continueReadingBookOf(books);
    if (!target?.lastLocationCfi) return;
    navigate(
      `/reader?book=${encodeURIComponent(target.id)}&cfi=${encodeURIComponent(target.lastLocationCfi)}`,
      { replace: true },
    );
  }, [books, isReady, navigate, preview, startupView]);

  function requireDesktop(): boolean {
    if (preview || !isTauri()) {
      setActionError("该操作只在桌面应用里可用（当前是浏览器预览）");
      return false;
    }
    return true;
  }

  async function handleImport() {
    if (!requireDesktop()) return;
    setActionError(null);
    try {
      const selection = await openFileDialog({
        multiple: true,
        directory: false,
        filters: [
          {
            name: "电子书",
            extensions: ["epub", "mobi", "azw3", "fb2", "cbz", "pdf"],
          },
        ],
      });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      for (const path of paths) {
        try {
          await importEpub(path);
        } catch {
          // importEpub 已把失败原因写进 store.error，这里继续导入剩余文件。
        }
      }
    } catch (error) {
      setActionError(
        `打开文件选择器失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function handleMoveToFolder(book: Book, folderId: string | null) {
    if (!requireDesktop()) return;
    try {
      await moveBookToFolder(book.id, folderId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleConfirmDeleteBook() {
    if (!bookToDelete) return;
    if (!requireDesktop()) {
      setBookToDelete(null);
      return;
    }
    setBusy(true);
    try {
      await removeBook(bookToDelete.id);
      if (detailBook?.id === bookToDelete.id) {
        setDetailBookId(null);
        setDetailOpen(false);
        detailTriggerRef.current = null;
      }
      setBookToDelete(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitFolder(name: string) {
    if (!requireDesktop()) return;
    if (folderForm?.mode === "rename") {
      await renameFolder(folderForm.folder.id, name);
    } else {
      const folder = await createFolder(name);
      setActiveId(folder.id);
    }
  }

  async function handleConfirmDeleteFolder() {
    if (!folderToDelete) return;
    if (!requireDesktop()) {
      setFolderToDelete(null);
      return;
    }
    setBusy(true);
    try {
      await deleteFolder(folderToDelete.id);
      setFolderToDelete(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleDismissNotice() {
    setActionError(null);
    void dismissMigrationNotice();
  }

  const errorBanner = actionError ?? storeError;
  const showNotice = !preview && migrationNotice === "shelf-to-folder";

  return (
    <div className="relative flex h-full flex-col">
      <div
        className={cn(
          "flex h-full min-h-0 flex-col transition-[opacity,transform] duration-base ease-exit",
          detailOpen && wide && "pointer-events-none -translate-x-4 opacity-0",
        )}
      >
        <PageHeader
          title="书架"
          actions={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="打开笔记"
                      onClick={() => navigate("/notes")}
                    />
                  }
                >
                  <NotebookText />
                </TooltipTrigger>
                <TooltipContent>笔记</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="打开设置"
                      onClick={openSettings}
                    />
                  }
                >
                  <SettingsIcon />
                </TooltipTrigger>
                <TooltipContent>设置</TooltipContent>
              </Tooltip>
              {!aiPanelOpen && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="打开 AI 伴读面板"
                        onClick={() => setAIPanelOpen(true)}
                      />
                    }
                  >
                    <Sparkles />
                  </TooltipTrigger>
                  <TooltipContent>AI 伴读</TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
          }
        />

        <div className="border-border flex flex-none items-center gap-3 border-b px-6 py-2.5 max-[819px]:px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            {activeFolder ? (
              <Folder className="text-muted-foreground size-4 shrink-0" />
            ) : view === "uncategorized" ? (
              <FolderMinus className="text-muted-foreground size-4 shrink-0" />
            ) : (
              <Library className="text-muted-foreground size-4 shrink-0" />
            )}
            <span className="truncate font-medium">{viewTitle}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {visibleBooks.length} 本
            </span>
          </div>

          {preview && <Badge variant="secondary">预览数据（浏览器）</Badge>}
          {!isTauri() && !preview && (
            <span className="text-muted-foreground hidden text-xs sm:inline">
              浏览器里只能看界面，导入/删除请在桌面应用内操作
            </span>
          )}

          <TextureButton
            variant="primary"
            size="sm"
            className="w-auto"
            onClick={handleImport}
            disabled={importing}
          >
            <BookPlus className="size-3.5" />
            {importing ? "导入中…" : "导入书籍"}
          </TextureButton>
        </div>

        {showNotice && (
          <div className="border-border bg-muted/40 mx-6 mt-3 flex items-start gap-2.5 rounded-[14px] border px-3.5 py-3 max-[819px]:mx-3">
            <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <p className="flex-1 text-[13px] leading-relaxed">{MIGRATION_NOTICE_COPY}</p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="hover:bg-muted h-7 rounded-lg px-2 text-[13px] font-semibold"
                onClick={handleDismissNotice}
              >
                知道了
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="关闭提示"
                onClick={handleDismissNotice}
              >
                <X />
              </Button>
            </div>
          </div>
        )}

        {errorBanner && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive mx-6 mt-4 flex items-start gap-3 rounded-md border px-3 py-2 text-sm max-[819px]:mx-3">
            <span className="flex-1">{errorBanner}</span>
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                setActionError(null);
                clearError();
              }}
            >
              知道了
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {wide && (
            <aside
              aria-label="文件夹"
              className="border-border flex w-[216px] shrink-0 flex-col border-r"
            >
              <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-3 py-3">
                <FolderRailItem
                  icon={<Library className="size-4" />}
                  label="全部书籍"
                  count={books.length}
                  active={view === "all"}
                  onSelect={() => setActiveId(null)}
                />
                <FolderRailItem
                  icon={<FolderMinus className="size-4" />}
                  label="未分类"
                  count={uncategorizedCount}
                  active={view === "uncategorized"}
                  onSelect={() => setActiveId(UNCATEGORIZED)}
                />

                {folders.length > 0 && (
                  <div className="bg-border my-2 h-px" aria-hidden="true" />
                )}

                {folders.map((folder) => (
                  <FolderRailFolder
                    key={folder.id}
                    folder={folder}
                    count={countInFolder(folder.id)}
                    active={activeFolder?.id === folder.id}
                    onSelect={() => setActiveId(folder.id)}
                    onRename={() => setFolderForm({ mode: "rename", folder })}
                    onDelete={() => setFolderToDelete(folder)}
                  />
                ))}
              </nav>

              <div className="px-3 pb-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground w-full justify-start gap-2 px-2.5"
                  onClick={() => setFolderForm({ mode: "create" })}
                >
                  <FolderPlus className="size-4" />
                  新建文件夹
                </Button>
              </div>
            </aside>
          )}

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pt-5 pb-24 max-[819px]:px-3">
              {isReady && continueReading ? (
                <div className="mb-5 max-w-xl">
                  <ContinueReadingCard
                    book={continueReading}
                    onContinue={(book) =>
                      navigate(`/reader?book=${encodeURIComponent(book.id)}`)
                    }
                  />
                </div>
              ) : null}
              {!isReady ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="space-y-2">
                      <Skeleton className="aspect-[2/3] w-full rounded-[16px]" />
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : visibleBooks.length === 0 ? (
                <EmptyState
                  mode={books.length === 0 ? "library" : view}
                  folderName={activeFolder?.name}
                  onImport={handleImport}
                  onBrowseAll={() => setActiveId(null)}
                />
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4 max-[819px]:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] max-[819px]:gap-3">
                  {visibleBooks.map((book, index) => (
                    <div
                      key={book.id}
                      className="deer-list-item min-w-0"
                      // 前 12 项 40ms 错峰，第 13 项起延迟固定为 0（motion.md M4）。
                      style={{ "--deer-index": index < 12 ? index : 0 } as CSSProperties}
                    >
                      <BookCard
                        book={book}
                        folders={folders}
                        onOpen={openDetail}
                        onRead={(target) =>
                          navigate(`/reader?book=${encodeURIComponent(target.id)}`)
                        }
                        onMoveToFolder={handleMoveToFolder}
                        onDelete={setBookToDelete}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <Dialog
          open={bookToDelete !== null}
          onOpenChange={(next) => {
            if (!next) setBookToDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除《{bookToDelete?.title}》？</DialogTitle>
              <DialogDescription>
                会同时删除应用数据目录里的书籍文件与封面，此操作不可撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBookToDelete(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={handleConfirmDeleteBook}
              >
                {busy ? "删除中…" : "删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={folderToDelete !== null}
          onOpenChange={(next) => {
            if (!next) setFolderToDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除文件夹「{folderToDelete?.name}」？</DialogTitle>
              <DialogDescription>
                {folderToDelete
                  ? `里面的 ${countInFolder(folderToDelete.id)} 本书会移到「未分类」，不会被删除。`
                  : null}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFolderToDelete(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={handleConfirmDeleteFolder}
              >
                {busy ? "删除中…" : "删除文件夹"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {folderForm && (
          <FolderNameDialog
            key={
              folderForm.mode === "rename"
                ? `rename-${folderForm.folder.id}`
                : "create"
            }
            open
            title={folderForm.mode === "rename" ? "重命名文件夹" : "新建文件夹"}
            description={
              folderForm.mode === "rename"
                ? "改个更好认的名字，书不会动。"
                : "建一个文件夹，把书按主题归类。"
            }
            submitLabel={folderForm.mode === "rename" ? "保存" : "创建"}
            initialValue={
              folderForm.mode === "rename" ? folderForm.folder.name : ""
            }
            onOpenChange={(next) => {
              if (!next) setFolderForm(null);
            }}
            onSubmit={handleSubmitFolder}
          />
        )}
      </div>

      {detailBook && wide && (
        <div
          aria-hidden={!detailOpen}
          className={cn(
            "bg-background absolute inset-0 z-30 flex flex-col transition-[opacity,transform] duration-[220ms] ease-enter",
            detailOpen
              ? "translate-x-0 opacity-100"
              : "pointer-events-none translate-x-6 opacity-0",
          )}
        >
          <BookDetailView
            book={detailBook}
            variant="page"
            folders={folders}
            onBack={closeDetail}
            onContinueRead={() =>
              navigate(`/reader?book=${encodeURIComponent(detailBook.id)}`)
            }
            onLocate={(cfi) =>
              navigate(
                `/reader?book=${encodeURIComponent(detailBook.id)}&cfi=${encodeURIComponent(cfi)}`,
              )
            }
            onRemove={() => setBookToDelete(detailBook)}
            onAskAI={askAIFromDetail}
            onMoveToFolder={(folderId) =>
              void handleMoveToFolder(detailBook, folderId)
            }
          />
        </div>
      )}

      {detailBook && !wide && (
        <Sheet
          open={detailOpen}
          onOpenChange={(next) => {
            if (!next) closeDetail();
          }}
        >
          <SheetContent
            side="bottom"
            className="flex h-full flex-col gap-0 p-0"
          >
            <BookDetailView
              book={detailBook}
              variant="sheet"
              folders={folders}
              onBack={closeDetail}
              onContinueRead={() =>
                navigate(`/reader?book=${encodeURIComponent(detailBook.id)}`)
              }
              onLocate={(cfi) =>
                navigate(
                  `/reader?book=${encodeURIComponent(detailBook.id)}&cfi=${encodeURIComponent(cfi)}`,
                )
              }
              onRemove={() => setBookToDelete(detailBook)}
              onAskAI={askAIFromDetailSheet}
              onMoveToFolder={(folderId) =>
                void handleMoveToFolder(detailBook, folderId)
              }
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function FolderRailItem({
  icon,
  label,
  count,
  active,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  active: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] transition-colors duration-fast ease-enter focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-muted font-semibold"
          : "text-foreground hover:bg-muted/60",
      )}
      onClick={onSelect}
    >
      <span className="text-muted-foreground flex shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-muted-foreground text-xs font-normal tabular-nums">
        {count}
      </span>
    </button>
  );
}

function FolderRailFolder({
  folder,
  count,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  folder: BookFolder;
  count: number;
  active: boolean;
  onSelect(): void;
  onRename(): void;
  onDelete(): void;
}) {
  return (
    <div
      className={cn(
        "group/row flex h-9 items-center rounded-[10px] pr-0.5 transition-colors duration-fast ease-enter",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-[10px] pl-2.5 text-left text-[13px] focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          active ? "font-semibold" : "text-foreground",
        )}
        onClick={onSelect}
      >
        <Folder className="text-muted-foreground size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="text-muted-foreground text-xs font-normal tabular-nums">
          {count}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`文件夹「${folder.name}」更多操作`}
              className="opacity-0 group-hover/row:opacity-100 aria-expanded:opacity-100 focus-visible:opacity-100"
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onRename}>
            <Pencil />
            重命名
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function EmptyState({
  mode,
  folderName,
  onImport,
  onBrowseAll,
}: {
  mode: "library" | "all" | "folder" | "uncategorized";
  folderName?: string;
  onImport(): void;
  onBrowseAll(): void;
}) {
  if (mode === "library") {
    return (
      <div className="border-border text-muted-foreground my-auto flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
        <Library className="text-muted-foreground/60 size-8" />
        <p className="text-sm">书库还是空的。</p>
        <p className="max-w-xs text-xs leading-relaxed">
          导入本地电子书（EPUB / MOBI / AZW3 / FB2 / CBZ / PDF），
          自动读取书名、作者与封面，文件会复制到应用数据目录统一管理。
        </p>
        <TextureButton
          variant="secondary"
          size="sm"
          className="mt-1 w-auto"
          onClick={onImport}
        >
          <BookPlus className="size-3.5" />
          导入第一本书
        </TextureButton>
      </div>
    );
  }

  return (
    <div className="border-border text-muted-foreground my-auto flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
      <Folder className="text-muted-foreground/60 size-8" />
      <p className="text-sm">
        {mode === "folder"
          ? "这个文件夹还是空的，把书移进来吧"
          : mode === "uncategorized"
            ? "没有未分类的书"
            : `书架「${folderName ?? ""}」还是空的`}
      </p>
      <p className="text-xs">在书籍卡片的「⋯」菜单里选择「移动到文件夹」。</p>
      <Button variant="outline" size="sm" className="mt-1" onClick={onBrowseAll}>
        浏览全部书籍
      </Button>
    </div>
  );
}