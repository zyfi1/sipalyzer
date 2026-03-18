import { useMemo } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useComposerStore } from "@/stores/composerStore";
import { History, Eye, Send } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { ComposerHistoryEntry } from "@/types/composer";
import type { IconComponent } from "@/lib/icons";
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

interface UnifiedSession {
  id: string;
  ts: number;
  icon: IconComponent;
  label: string;
  status: string;
  toolId: string;
}

export function RecentSessionsSection() {
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const history = useComposerStore((s) => s.history);

  const items = useMemo(() => {
    const unified: UnifiedSession[] = [];

    for (const s of sessions) {
      unified.push({
        id: `cap-${s.id}`,
        ts: new Date(s.startTime).getTime(),
        icon: Eye,
        label: s.name || "Unnamed Capture",
        status: s.status,
        toolId: "packet-capture",
      });
    }

    for (const h of history as ComposerHistoryEntry[]) {
      unified.push({
        id: `comp-${h.id}`,
        ts: new Date(h.timestamp).getTime(),
        icon: Send,
        label: h.method ? `${h.method} ${h.target ?? ""}`.trim() : h.protocol,
        status: h.statusCode != null ? String(h.statusCode) : h.protocol,
        toolId: "composer",
      });
    }

    unified.sort((a, b) => b.ts - a.ts);
    return unified.slice(0, 5);
  }, [sessions, history]);

  return (
    <div className="surface p-5 flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <History className="h-4 w-4 text-muted-foreground/60" />
        <h2 className="text-sm font-semibold text-foreground/70">Recent Sessions</h2>
        {items.length > 0 && (
          <span className="text-3xs text-muted-foreground/40 tabular-nums">{items.length}</span>
        )}
      </div>

      {items.length > 0 ? (
        <div className="space-y-0.5 overflow-y-auto -mx-2 px-2 flex-1 min-h-0">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.toolId)}
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-muted/10 transition-colors text-left"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-foreground/70 truncate block">{item.label}</span>
                </div>
                <span className={cn(
                  "text-3xs px-1.5 py-0.5 rounded font-medium shrink-0",
                  item.status === "running" ? "bg-success/15 text-success" :
                  item.status === "error" ? "bg-destructive/15 text-destructive" :
                  "bg-muted/15 text-muted-foreground/60",
                )}>
                  {item.status}
                </span>
                <span className="text-3xs text-muted-foreground/40 tabular-nums shrink-0">
                  {relativeTime(item.ts)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          compact
          variant="inline"
          icon={<History />}
          title="No recent sessions"
          className="min-h-0"
        />
      )}
    </div>
  );
}
