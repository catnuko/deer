import { PageHeader } from "@/components/layout/PageHeader";

export function ReaderPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="阅读" description="打开一本书开始阅读，右侧可唤起 AI 伴读。" />
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-8 text-sm">
        阅读页占位：章节渲染与阅读进度待接入。
      </div>
    </div>
  );
}
