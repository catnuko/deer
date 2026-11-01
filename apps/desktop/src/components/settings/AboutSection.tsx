import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const STACK = [
  ["运行外壳", "Tauri v2"],
  ["界面", "React 19 + TypeScript + Vite"],
  ["样式", "Tailwind CSS v4"],
  ["组件库", "assistant-ui（AI 聊天）· cult-ui（界面）"],
  ["基础件", "shadcn/ui"],
] as const;

export function AboutSection() {
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold tracking-tight">Deer</span>
        <Badge variant="secondary">0.1.0</Badge>
        <Badge variant="outline">本地运行</Badge>
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        一个本地运行的电子书阅读器。当前为夜间构建版本，阅读与书架功能正在逐步接入。
      </p>

      <Separator />

      <dl className="space-y-2 text-sm">
        {STACK.map(([label, value]) => (
          <div key={label} className="flex gap-4">
            <dt className="text-muted-foreground w-24 shrink-0 text-xs leading-5">
              {label}
            </dt>
            <dd className="min-w-0 text-xs leading-5">{value}</dd>
          </div>
        ))}
      </dl>

      <Separator />

      <p className="text-muted-foreground text-xs leading-relaxed">
        书籍文件保存在应用数据目录，阅读偏好保存在本机。当前版本不联网，也不会上传任何内容。
      </p>
    </div>
  );
}
