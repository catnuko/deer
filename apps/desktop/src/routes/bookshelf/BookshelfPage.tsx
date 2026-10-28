import { PageHeader } from "@/components/layout/PageHeader";

export function BookshelfPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="书架"
        description="导入、整理与阅读你的本地 EPUB 书籍。"
      />
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-8 text-sm">
        书架页占位：EPUB 导入 / 删除 / 整理待接入。
      </div>
    </div>
  );
}
