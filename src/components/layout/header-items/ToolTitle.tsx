import { useToolStore } from "@/stores/toolStore";
import { TOOL_COLORS } from "@/lib/toolColors";
import { cn } from "@/lib/utils";

export type ToolTitleProps = {
  /** Fits the unified header command strip */
  variant?: "default" | "compact";
  className?: string;
};

/**
 * Renders the active tool's icon + name in the header.
 * Always shown — breadcrumb dropdowns follow for tools with subviews.
 */
export function ToolTitle({ variant = "default", className }: ToolTitleProps) {
  const activeTool = useToolStore((s) => s.getActiveTool());

  if (!activeTool) return null;

  const toolColor = TOOL_COLORS[activeTool.id];
  const compact = variant === "compact";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-shrink-0 items-center app-chrome-content-swap",
        compact ? "gap-1.5 pl-0.5" : "gap-1.5",
        className,
      )}
    >
      {activeTool.icon && (
        <activeTool.icon
          className={cn(
            "shrink-0",
            compact ? "h-3.5 w-3.5" : "h-4 w-4",
            toolColor?.icon ?? "text-muted-foreground",
          )}
        />
      )}
      <span
        className={cn(
          "truncate whitespace-nowrap text-foreground",
          compact ? "text-2xs font-semibold tracking-wide" : "text-xs font-medium",
        )}
      >
        {activeTool.name}
      </span>
    </div>
  );
}
