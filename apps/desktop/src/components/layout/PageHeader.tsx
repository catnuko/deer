import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function PageHeader({
  title,
  description,
  actions,
  onBack,
}: {
  title: string;
  description?: string;
  /** 页头右侧动作区（M5a：书架的设置齿轮放这里）。 */
  actions?: ReactNode;
  /** 提供时在标题左侧渲染「← 返回书架」图标按钮（布局重排：返回归位左上）。 */
  onBack?: () => void;
}) {
  return (
    <header className="border-border flex items-center justify-between gap-4 border-b px-8 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {onBack ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="返回书架"
                    onClick={onBack}
                    className="shrink-0"
                  />
                }
              >
                <ArrowLeft className="size-4" />
              </TooltipTrigger>
              <TooltipContent>返回书架</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
