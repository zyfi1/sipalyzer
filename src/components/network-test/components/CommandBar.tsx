import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Play, Square, Zap, Globe } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

interface CategoryPill {
  id: string;
  label: string;
  running?: boolean;
  onRun: () => void;
}

interface CommandBarProps {
  target: string;
  onTargetChange: (value: string) => void;
  onRunAll: () => void;
  /** Stop an in-flight “Test Everything” batch (best-effort; OS probes cancelled where supported). */
  onStopBulk?: () => void;
  bulkRunning: boolean;
  bulkProgress: { completed: number; total: number } | null;
  categories: CategoryPill[];
}

export function CommandBar({
  target,
  onTargetChange,
  onRunAll,
  onStopBulk,
  bulkRunning,
  bulkProgress,
  categories,
}: CommandBarProps) {
  const hasTarget = target.trim().length > 0;
  const progressPct = bulkProgress
    ? (bulkProgress.completed / bulkProgress.total) * 100
    : 0;

  return (
    <div className="sticky top-0 z-20 -mx-4 px-4 pb-1">
      <div className="surface-flat p-4">
        <div className="flex items-center gap-3">
          {/* Target input with icon */}
          <TooltipWrapper entry={tooltips.netTargetHost}>
            <div className="relative flex-1 min-w-0">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
              <Input
                value={target}
                onChange={(e) => onTargetChange(e.target.value)}
                placeholder="Target host or IP  (e.g. 8.8.8.8, sip.provider.com)"
                className="ui-control-shell h-10 pl-10 text-sm"
                onKeyDown={(e) => e.key === "Enter" && hasTarget && onRunAll()}
              />
            </div>
          </TooltipWrapper>

          {/* Run All / Stop */}
          {bulkRunning && onStopBulk && (
            <TooltipWrapper entry={tooltips.netStopTest}>
              <Button type="button" variant="destructive" onClick={onStopBulk} className="h-10 gap-2 px-4 shrink-0 font-medium">
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </TooltipWrapper>
          )}
          <TooltipWrapper entry={tooltips.netTestEverything}>
            <Button
              onClick={onRunAll}
              disabled={!hasTarget || bulkRunning}
              className="h-10 gap-2 px-5 shrink-0 font-medium"
            >
              {bulkRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              {bulkRunning && bulkProgress
                ? `${bulkProgress.completed} / ${bulkProgress.total}`
                : "Test Everything"}
            </Button>
          </TooltipWrapper>
        </div>

        {/* Category quick-run pills */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={cn(
                "h-7 text-xs px-3.5 gap-1.5 rounded-full inline-flex items-center font-medium transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
                cat.running
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/20 text-muted-foreground/70 hover:bg-muted/30 hover:text-foreground",
                (!hasTarget || cat.running) && "opacity-40 pointer-events-none",
              )}
              onClick={cat.onRun}
              disabled={!hasTarget || cat.running}
            >
              {cat.running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {cat.label}
            </button>
          ))}
        </div>

        {/* Progress bar */}
        {bulkRunning && bulkProgress && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-2xs text-muted-foreground/60">
              <span>Running tests…</span>
              <span className="tabular-nums font-medium">{progressPct.toFixed(0)}%</span>
            </div>
            <div className="h-1 bg-muted/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/90 rounded-full transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
