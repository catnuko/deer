import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SettingRowProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

/** 设置项通用行：左标题+说明，右控件。 */
export function SettingRow({
  title,
  description,
  children,
  className,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
