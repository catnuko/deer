import { PageHeader } from "@/components/layout/PageHeader";

export function NotesPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="笔记" description="集中查看划线、摘录与随书笔记。" />
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-8 text-sm">
        笔记页占位：划线摘录与笔记列表待接入。
      </div>
    </div>
  );
}
