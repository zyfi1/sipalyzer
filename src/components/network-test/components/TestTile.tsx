import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play, ChevronDown, Square } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { IconComponent } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

type TileStatus = "idle" | "running" | "done" | "error";

interface TestTileProps {
  icon: IconComponent;
  tint?: string;               // Semantic token for the icon, e.g. "text-success"
  title: string;
  subtitle?: string;
  status: TileStatus;
  /** Compact metric shown in collapsed state (e.g. "12.3 ms") */
  summary?: ReactNode;
  onRun: () => void;
  onStop?: () => void;
  running?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  /** Full-width span (takes up entire grid row) */
  fullWidth?: boolean;
  children?: ReactNode;        // config + results shown when expanded
}

const STATUS_DOT: Record<TileStatus, string> = {
  idle: "bg-muted-foreground/30",
  running: "bg-primary",
  done: "bg-success",
  error: "bg-destructive",
};

/** Maps a tint text class → subtle icon-container background */
const TINT_BG: Record<string, string> = {
  "text-info": "bg-info/[0.08]",
  "text-success": "bg-success/[0.08]",
  "text-primary": "bg-primary/[0.08]",
  "text-warning": "bg-warning/[0.08]",
  "text-destructive": "bg-destructive/[0.08]",
  "text-muted-foreground": "bg-muted-foreground/[0.06]",
};

export function TestTile({
  icon: Icon,
  tint = "text-muted-foreground",
  title,
  subtitle,
  status,
  summary,
  onRun,
  onStop,
  running,
  expanded,
  onToggle,
  fullWidth,
  children,
}: TestTileProps) {
  const isRunning = running ?? status === "running";
  const iconBg = TINT_BG[tint] ?? "bg-muted/10";

  return (
    <div
      className={cn(
        "group/tile relative transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
        "surface-flat hover-lift",
        "hover:bg-card/65 hover:shadow-card-hover",
        isRunning && "ring-1 ring-primary/15",
        status === "error" && "ring-1 ring-destructive/15",
        fullWidth && "col-span-full",
      )}
    >
      <div className="p-4">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-start gap-3">
          {/* Icon container with status badge */}
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "relative shrink-0 h-9 w-9 rounded-lg flex items-center justify-center",
              "transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
              iconBg,
            )}
          >
            <Icon className={cn("h-4 w-4 transition-smooth", tint)} />
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full",
                "border-2 border-card/80 transition-smooth",
                STATUS_DOT[status],
                status === "running" && "status-online",
              )}
            />
          </button>

          {/* Title + subtitle */}
          <button
            type="button"
            className="flex-1 min-w-0 text-left pt-0.5"
            onClick={onToggle}
          >
            <span className="text-sm font-semibold leading-tight block truncate">
              {title}
            </span>
            {subtitle && (
              <span className="text-2xs text-muted-foreground/60 leading-snug block truncate mt-0.5">
                {subtitle}
              </span>
            )}
          </button>

          {/* Summary pill — visible only when collapsed */}
          {!expanded && summary && (
            <span className="text-2xs font-mono tabular-nums text-muted-foreground/80 bg-muted/20 rounded-lg px-2 py-0.5 shrink-0 mt-1">
              {summary}
            </span>
          )}

          {/* Controls */}
          <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
            {onToggle && (
              <TooltipWrapper entry={expanded ? tooltips.netCollapseDetails : tooltips.netExpandDetails}>
                <button
                  type="button"
                  onClick={onToggle}
                  className="text-muted-foreground/60 hover:text-foreground transition-smooth p-1 rounded-lg hover:bg-muted/20"
                >
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
              </TooltipWrapper>
            )}
            <TooltipWrapper entry={isRunning ? tooltips.netStopTest : tooltips.netRunTest}>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 w-8 p-0 shrink-0",
                  isRunning && onStop
                    ? "text-destructive hover:text-destructive hover:bg-destructive/10"
                    : "hover:bg-muted/20",
                )}
                onClick={isRunning && onStop ? onStop : onRun}
                disabled={isRunning && !onStop}
              >
                {isRunning ? (
                  onStop ? (
                    <Square className="h-3.5 w-3.5" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipWrapper>
          </div>
        </div>

        {/* ── Expanded content ────────────────────────────── */}
        {expanded && children && (
          <div className="mt-4 pt-4 border-t border-border/20 space-y-4 animate-panel-enter">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
