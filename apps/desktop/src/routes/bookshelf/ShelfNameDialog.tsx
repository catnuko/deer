import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ShelfNameDialogProps = {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  initialValue?: string;
  onOpenChange(open: boolean): void;
  onSubmit(name: string): Promise<void>;
};

/** 新建/重命名书架共用的单输入弹窗。 */
export function ShelfNameDialog({
  open,
  title,
  description,
  submitLabel,
  initialValue = "",
  onOpenChange,
  onSubmit,
}: ShelfNameDialogProps) {
  // 由调用方以 key 控制挂载：每次打开都是新实例，不需要 effect 重置。
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
      onOpenChange(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : String(submitError),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <label htmlFor="shelf-name" className="text-sm font-medium">
              书架名称
            </label>
            <Input
              id="shelf-name"
              value={name}
              autoFocus
              maxLength={40}
              placeholder="例如：想读、技术、小说"
              onChange={(event) => setName(event.target.value)}
            />
            {error && <p className="text-destructive text-xs">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy || name.trim().length === 0}>
              {busy ? "保存中…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
