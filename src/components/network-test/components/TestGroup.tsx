import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { IconComponent } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface TestGroupProps {
  title: string;
  icon: IconComponent;
  onRunAll?: () => void;
  running?: boolean;
  children: ReactNode;
  className?: string;
  /** Override grid cols: "2" for 2-col, "3" for default 3-col */
  gridCols?: "2" | "3";
}

export function TestGroup({
  title,
  icon: Icon,
  onRunAll,
  running,
  children,
  className,
  gridCols = "3",
}: TestGroupProps) {
  return (
    <section
      className={cn(
        "ui-hero-surface p-5",
        className,
      )}
    >
      {/* Group header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-7 w-7 rounded-lg bg-muted/20 flex items-center justify-center shrink-0">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <h2 className="section-label flex-1 truncate">
          {title}
        </h2>
        {onRunAll && (
          <TooltipWrapper entry={tooltips.netRunAll}>
            <Button
              variant="neutral"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={onRunAll}
              disabled={running}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run All
            </Button>
          </TooltipWrapper>
        )}
      </div>

      {/* Inner grid of test tiles */}
      <div
        className={cn(
          "grid gap-3",
          gridCols === "2"
            ? "grid-cols-1 sm:grid-cols-2"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {children}
      </div>
    </section>
  );
}
