import type { ReactNode } from "react";
import type { IconComponent } from "@/lib/icons";
import { cn } from "@/lib/utils";

const TINT_BG: Record<string, string> = {
  "text-info": "bg-info/[0.08]",
  "text-success": "bg-success/[0.08]",
  "text-primary": "bg-primary/[0.08]",
  "text-warning": "bg-warning/[0.08]",
  "text-destructive": "bg-destructive/[0.08]",
  "text-muted-foreground": "bg-muted-foreground/[0.06]",
};

interface ToolViewShellProps {
  icon: IconComponent;
  tint?: string;
  title: string;
  description?: string;
  /**
   * Compact mode — hides the icon + title + description header.
   * Use inside tabbed containers where the tab already identifies the view.
   */
  compact?: boolean;
  /** Controls bar rendered inside a card wrapper */
  controls?: ReactNode;
  /** Main content area */
  children?: ReactNode;
  className?: string;
}

export function ToolViewShell({
  icon: Icon,
  tint = "text-muted-foreground",
  title,
  description,
  compact = false,
  controls,
  children,
  className,
}: ToolViewShellProps) {
  const iconBg = TINT_BG[tint] ?? "bg-muted/20";

  return (
    <div className={cn("app-view-stack pb-4", className)}>
      {/* ── Header (hidden in compact mode) ────────────── */}
      {!compact && (
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
              iconBg,
            )}
          >
            <Icon className={cn("h-4 w-4", tint)} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold leading-tight">{title}</h2>
            {description && (
              <p className="text-2xs text-muted-foreground/60 mt-0.5">
                {description}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Controls Bar ───────────────────────────────── */}
      {controls && (
        <div className="surface-flat app-view-surface-pad">
          {controls}
        </div>
      )}

      {/* ── Content ────────────────────────────────────── */}
      {children}
    </div>
  );
}
