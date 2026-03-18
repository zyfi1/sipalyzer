import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Display variant: "card" (rounded container with bg) or "inline" (transparent, embedded) */
  variant?: "card" | "inline";
  /** Compact mode for small panels, sidebars, and widgets — smaller icon, tighter spacing */
  compact?: boolean;
  /** Optional icon element */
  icon?: React.ReactNode;
  /** Optional title (e.g. "No faxes yet") */
  title?: string;
  /** Optional description */
  description?: string;
  /** Optional action button or element */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Unified empty state component. Use for ALL empty lists, panels, landing pages.
 *
 * Tiers:
 *  - Default: large icon (size-10), text-base title, text-sm description, generous padding
 *  - Compact: small icon (size-7), text-sm title, text-xs description, tight padding
 *
 * Variants:
 *  - "card": rounded container with muted background
 *  - "inline": transparent, blends into parent
 */
export function EmptyState({
  variant = "card",
  compact = false,
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col items-center justify-center text-center text-balance",
        // Flat, consistent shells without glossy overlays or artifact lines.
        variant === "card" && "min-h-[180px] rounded-lg border border-border/45 bg-card/35",
        // Inline stays clean; full panes fill, compact blocks stay naturally sized.
        variant === "inline" && (compact ? "bg-transparent" : "h-full min-h-[220px] flex-1 bg-transparent"),
        // Size tier
        compact ? "gap-2 p-4" : "gap-3 p-6 md:p-7",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-md border border-border/45 bg-muted/20 text-muted-foreground/85",
            compact
              ? "h-10 w-10 [&>svg]:size-5"
              : "h-12 w-12 [&>svg]:size-6",
          )}
        >
          {icon}
        </div>
      )}
      {(title || description) && (
        <div className={cn("max-w-sm space-y-1.5", compact && "max-w-[240px]")}>
          {title && (
            <p
              className={cn(
                "font-medium leading-tight text-foreground/92",
                compact ? "text-xs" : "text-sm md:text-[15px]",
              )}
            >
              {title}
            </p>
          )}
          {description && (
            <p
              className={cn(
                "leading-relaxed text-muted-foreground/78",
                compact ? "text-2xs" : "text-xs md:text-sm",
              )}
            >
              {description}
            </p>
          )}
        </div>
      )}
      {action && <div className={cn("flex items-center gap-2", !compact && "pt-1")}>{action}</div>}
    </div>
  );
}
