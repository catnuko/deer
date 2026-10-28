import { PageHeader } from "@/components/layout/PageHeader";

export function SettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="设置" description="AI 提供方、外观与数据存储位置。" />
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-8 text-sm">
        设置页占位：提供方配置与偏好项待接入。
      </div>
    </div>
  );
}
