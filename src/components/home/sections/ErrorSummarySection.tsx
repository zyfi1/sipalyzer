import { useMemo } from "react";
import { useErrorStore } from "@/stores/errorStore";
import { AlertTriangle, Trash2, CheckCircle2 } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { navigateTo } from "@/lib/navigation";
import { EmptyState } from "@/components/ui/empty-state";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

interface SourceGroup {
  source: string;
  count: number;
  lastTimestamp: string;
}

export function ErrorSummarySection() {
  const errors = useErrorStore((s) => s.errors);
  const clear = useErrorStore((s) => s.clear);

  const totalCount = useMemo(
    () => errors.reduce((sum, e) => sum + e.count, 0),
    [errors],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; lastTimestamp: string }>();
    for (const e of errors) {
      const existing = map.get(e.source);
      if (existing) {
        existing.count += e.count;
        if (e.timestamp > existing.lastTimestamp) {
          existing.lastTimestamp = e.timestamp;
        }
      } else {
        map.set(e.source, { count: e.count, lastTimestamp: e.timestamp });
      }
    }
    const groups: SourceGroup[] = [];
    for (const [source, { count, lastTimestamp }] of map) {
      groups.push({ source, count, lastTimestamp });
    }
    groups.sort((a, b) => b.count - a.count);
    return groups;
  }, [errors]);

  return (
    <div className="surface p-5 flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground/60" />
          <h2 className="text-sm font-semibold text-foreground/70">Errors</h2>
          {errors.length > 0 && (
            <span className={cn(
              "text-3xs font-semibold px-1.5 py-0.5 rounded-full tabular-nums",
              "bg-destructive/15 text-destructive",
            )}>
              {totalCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {errors.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-2xs text-muted-foreground/50 hover:text-destructive h-6 px-2 gap-1"
              onClick={clear}
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
          )}
          {errors.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-2xs text-muted-foreground/50 hover:text-foreground/70 h-6 px-2"
              onClick={() => navigateTo("admin-center")}
            >
              View All
            </Button>
          )}
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="space-y-1 overflow-y-auto -mx-2 px-2 flex-1 min-h-0">
          {grouped.map((g) => (
            <div
              key={g.source}
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/10 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm text-foreground/70 truncate block">{g.source}</span>
                <span className="text-3xs text-muted-foreground/40 mt-0.5 block">
                  {relativeTime(new Date(g.lastTimestamp).getTime())}
                </span>
              </div>
              <span className={cn(
                "text-3xs font-semibold px-1.5 py-0.5 rounded-full tabular-nums shrink-0",
                "bg-destructive/15 text-destructive",
              )}>
                {g.count}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          variant="inline"
          icon={<CheckCircle2 />}
          title="No errors"
          className="min-h-0"
        />
      )}
    </div>
  );
}
