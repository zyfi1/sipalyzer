import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Deprecated: retained for API compatibility. Visual style is unified app-wide. */
  variant?: "card" | "inline";
  /** Deprecated: retained for API compatibility. Visual style is unified app-wide. */
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
  /**
   * Grow to fill the parent’s main axis (typical: parent is `flex flex-col flex-1 min-h-0` and this sits in the scroll/body area).
   * Keeps icon + copy vertically centered in the available height.
   * Default true so empty states center in tool/panel bodies; set `false` for inline rows or non-flex parents where growth is unwanted.
   */
  fillContainer?: boolean;
}

/**
 * Unified empty state component. Single visual contract app-wide.
 * Constrained with max-w-full / max-h-full + min-h-0 so content stays within the parent region (flex/grid safe).
 */
export function EmptyState({
  variant: _variant = "card",
  compact: _compact = false,
  icon,
  title,
  description,
  action,
  className,
  fillContainer = true,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex max-h-full min-h-0 w-full max-w-full min-w-0 flex-col items-center justify-center gap-3 overflow-y-auto rounded-[var(--radius-md)] border border-border/45 bg-card/40 p-6 text-center text-balance md:p-7",
        fillContainer && "min-h-0 flex-1 basis-0 self-stretch",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-[var(--radius-sm)] border border-border/45 bg-muted/20 text-muted-foreground/85",
            "h-12 w-12 [&>svg]:size-6",
          )}
        >
          {icon}
        </div>
      )}
      {(title || description) && (
        <div className="w-full max-w-full space-y-1.5 sm:max-w-sm">
          {title && (
            <p
              className={cn(
                "font-medium leading-tight text-foreground/92",
                "text-sm md:text-[15px]",
              )}
            >
              {title}
            </p>
          )}
          {description && (
            <p
              className={cn(
                "leading-relaxed text-muted-foreground/78",
                "text-xs md:text-sm",
              )}
            >
              {description}
            </p>
          )}
        </div>
      )}
      {action && (
        <div className="flex max-w-full min-w-0 flex-wrap items-center justify-center gap-2 pt-1">{action}</div>
      )}
    </div>
  );
}

// Unified primitive slots - same visual contract as EmptyState.
export function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex max-h-full min-h-0 w-full max-w-full min-w-0 flex-col items-center justify-center gap-3 overflow-y-auto rounded-[var(--radius-md)] border border-border/45 bg-card/40 p-6 text-center text-balance md:p-7",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex w-full max-w-full flex-col items-center gap-1.5 text-center sm:max-w-sm", className)}
      {...props}
    />
  );
}

export function EmptyMedia({
  className,
  variant: _variant,
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "icon" }) {
  return (
    <div
      data-slot="empty-icon"
      className={cn(
        "mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border/45 bg-muted/20 text-muted-foreground/85 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("text-sm font-medium leading-tight text-foreground/92 md:text-[15px]", className)}
      {...props}
    />
  );
}

export function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-xs leading-relaxed text-muted-foreground/78 [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-foreground md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn("flex w-full max-w-full min-w-0 flex-col items-center gap-2 pt-1 text-sm text-balance sm:max-w-sm", className)}
      {...props}
    />
  );
}
