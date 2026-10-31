import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  BookPlus,
  FolderPlus,
  Layers,
  Library,
  MoreHorizontal,
  NotebookText,
  Pencil,
  Settings as SettingsIcon,
  Trash2,
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
import { Skeleton } from "@/components/ui/skeleton";
import { TextureButton } from "@/components/ui/texture-button";
import { cn } from "@/lib/utils";
import { PREVIEW_BOOKS, PREVIEW_SHELVES } from "@/lib/preview";
import { isTauri } from "@/lib/platform";
import type { Book, Shelf } from "@/lib/types";
import { useBookStore } from "@/store/bookStore";
import { BookCard } from "./BookCard";
import { ContinueReadingCard } from "./ContinueReadingCard";
import { continueReadingBookOf } from "./continueReading";
import { ShelfNameDialog } from "./ShelfNameDialog";

type ShelfForm =
  | { mode: "create" }
  | { mode: "rename"; shelf: Shelf };

export function BookshelfPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 只有浏览器里（没有 Tauri）用 ?preview=1 看界面用，桌面应用不会走到这条分支。
  const preview = !isTauri() && searchParams.get("preview") === "1";

  const storeBooks = useBookStore((state) => state.books);
  const storeShelves = useBookStore((state) => state.shelves);
  const ready = useBookStore((state) => state.ready);
  const importing = useBookStore((state) => state.importing);
  const storeError = useBookStore((state) => state.error);
  const load = useBookStore((state) => state.load);
  const importEpub = useBookStore((state) => state.importEpub);
  const removeBook = useBookStore((state) => state.removeBook);
  const createShelf = useBookStore((state) => state.createShelf);
  const renameShelf = useBookStore((state) => state.renameShelf);
  const deleteShelf = useBookStore((state) => state.deleteShelf);
  const moveBookToShelf = useBookStore((state) => state.moveBookToShelf);
  const clearError = useBookStore((state) => state.clearError);

  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const [bookToDelete, setBookToDelete] = useState<Book | null>(null);
  const [shelfToDelete, setShelfToDelete] = useState<Shelf | null>(null);
  const [shelfForm, setShelfForm] = useState<ShelfForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const books = preview ? PREVIEW_BOOKS : storeBooks;
  const shelves = preview ? PREVIEW_SHELVES : storeShelves;
  const isReady = preview || ready;

  // 书架被删掉后，筛选自然退回「全部」——用派生值而不是副作用改 state。
  const effectiveShelfId =
    activeShelfId && shelves.some((shelf) => shelf.id === activeShelfId)
      ? activeShelfId
      : null;

  const visibleBooks = useMemo(
    () =>
      effectiveShelfId
        ? books.filter((book) => book.shelfIds.includes(effectiveShelfId))
        : books,
    [books, effectiveShelfId],
  );

  const activeShelf =
    shelves.find((shelf) => shelf.id === effectiveShelfId) ?? null;
  const countInShelf = (shelfId: string) =>
    books.filter((book) => book.shelfIds.includes(shelfId)).length;

  // 「继续阅读」卡片（M5a）：有保存过阅读位置的书才显示。
  const continueReading = useMemo(
    () => (isReady ? continueReadingBookOf(books) : null),
    [books, isReady],
  );

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

  async function handleToggleShelf(book: Book, shelf: Shelf) {
    if (!requireDesktop()) return;
    try {
      await moveBookToShelf(book.id, shelf.id);
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
      setBookToDelete(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitShelf(name: string) {
    if (!requireDesktop()) return;
    if (shelfForm?.mode === "rename") {
      await renameShelf(shelfForm.shelf.id, name);
    } else {
      const shelf = await createShelf(name);
      setActiveShelfId(shelf.id);
    }
  }

  async function handleConfirmDeleteShelf() {
    if (!shelfToDelete) return;
    if (!requireDesktop()) {
      setShelfToDelete(null);
      return;
    }
    setBusy(true);
    try {
      await deleteShelf(shelfToDelete.id);
      setShelfToDelete(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const errorBanner = actionError ?? storeError;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="书架"
        description="导入、整理与阅读你的本地电子书。"
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
                    onClick={() => navigate("/settings")}
                  />
                }
              >
                <SettingsIcon />
              </TooltipTrigger>
              <TooltipContent>设置</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="border-border flex w-56 shrink-0 flex-col border-r">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              书架
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="新建书架"
                      onClick={() => setShelfForm({ mode: "create" })}
                    />
                  }
                >
                  <FolderPlus />
                </TooltipTrigger>
                <TooltipContent>新建书架</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <nav className="flex flex-col gap-0.5 px-2 py-1">
            <button
              type="button"
              onClick={() => setActiveShelfId(null)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                effectiveShelfId === null
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Library className="size-3.5" />
              <span className="flex-1 truncate text-left">全部书籍</span>
              <span className="text-xs">{books.length}</span>
            </button>

            {shelves.map((shelf) => (
              <div
                key={shelf.id}
                className={cn(
                  "flex items-center gap-0.5 rounded-md",
                  effectiveShelfId === shelf.id && "bg-sidebar-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveShelfId(shelf.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    effectiveShelfId === shelf.id
                      ? "text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Layers className="size-3.5 shrink-0" />
                  <span className="flex-1 truncate text-left">{shelf.name}</span>
                  <span className="text-xs">{countInShelf(shelf.id)}</span>
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`管理书架「${shelf.name}」`}
                      />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() => setShelfForm({ mode: "rename", shelf })}
                    >
                      <Pencil />
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setShelfToDelete(shelf)}
                    >
                      <Trash2 />
                      删除书架
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {shelves.length === 0 && (
              <p className="text-muted-foreground px-2 py-1.5 text-xs leading-relaxed">
                还没有书架，点右上角 + 建一个来归类书籍。
              </p>
            )}
          </nav>

          <div className="mt-auto px-4 py-3">
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              书籍文件保存在应用数据目录
            </p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-border flex flex-wrap items-center gap-3 border-b px-6 py-3">
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

            <span className="text-muted-foreground text-sm">
              {activeShelf ? `「${activeShelf.name}」` : "全部书籍"} ·{" "}
              {visibleBooks.length} 本
            </span>

            {preview && <Badge variant="secondary">预览数据（浏览器）</Badge>}
            {!isTauri() && !preview && (
              <span className="text-muted-foreground text-xs">
                浏览器里只能看界面，导入/删除请在桌面应用内操作
              </span>
            )}
          </div>

          {errorBanner && (
            <div className="border-destructive/30 bg-destructive/10 text-destructive mx-6 mt-4 flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
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

          <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
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
                hasAnyBook={books.length > 0}
                shelfName={activeShelf?.name}
                onImport={handleImport}
              />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4">
                {visibleBooks.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    shelves={shelves}
                    onOpen={(target) =>
                      navigate(`/reader?book=${encodeURIComponent(target.id)}`)
                    }
                    onToggleShelf={handleToggleShelf}
                    onDelete={setBookToDelete}
                  />
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
        open={shelfToDelete !== null}
        onOpenChange={(next) => {
          if (!next) setShelfToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除书架「{shelfToDelete?.name}」？</DialogTitle>
            <DialogDescription>
              书架里的书不会被删除，只会从该书架移出。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShelfToDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={handleConfirmDeleteShelf}
            >
              {busy ? "删除中…" : "删除书架"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {shelfForm && (
        <ShelfNameDialog
          key={
            shelfForm.mode === "rename" ? `rename-${shelfForm.shelf.id}` : "create"
          }
          open
          title={shelfForm.mode === "rename" ? "重命名书架" : "新建书架"}
          description={
            shelfForm.mode === "rename"
              ? "改个更好认的名字，书不会动。"
              : "建一个书架，把书按主题归类。"
          }
          submitLabel={shelfForm.mode === "rename" ? "保存" : "创建"}
          initialValue={shelfForm.mode === "rename" ? shelfForm.shelf.name : ""}
          onOpenChange={(next) => {
            if (!next) setShelfForm(null);
          }}
          onSubmit={handleSubmitShelf}
        />
      )}
    </div>
  );
}

function EmptyState({
  hasAnyBook,
  shelfName,
  onImport,
}: {
  hasAnyBook: boolean;
  shelfName?: string;
  onImport(): void;
}) {
  return (
    <div className="border-border text-muted-foreground flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
      <Library className="text-muted-foreground/60 size-8" />
      {hasAnyBook ? (
        <>
          <p className="text-sm">书架「{shelfName}」还是空的。</p>
          <p className="text-xs">在书籍卡片的菜单里把书加入这个书架。</p>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
