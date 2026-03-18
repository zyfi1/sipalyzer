import { useState, useEffect } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { Eye } from "@/lib/icons";
import { navigateTo } from "@/lib/navigation";
import { EmptyState } from "@/components/ui/empty-state";

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function ActiveCapturesSection() {
  const sessions = usePacketCaptureStore((s) => s.sessions);
  const runningSessionIds = usePacketCaptureStore((s) => s.runningSessionIds);

  const running = sessions.filter(
    (s) => runningSessionIds.includes(s.id) || s.status === "Running",
  );

  const [, setTick] = useState(0);
  useEffect(() => {
    if (running.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running.length]);

  return (
    <div className="surface p-5 flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground/60" />
          <h2 className="text-sm font-semibold text-foreground/70">Active Captures</h2>
        </div>
        {running.length > 0 && (
          <span className="text-3xs font-semibold px-1.5 py-0.5 rounded-full tabular-nums bg-success/15 text-success">
            {running.length} running
          </span>
        )}
      </div>

      {running.length > 0 ? (
        <div className="space-y-1.5 overflow-y-auto flex-1 min-h-0 -mx-2 px-2">
          {running.map((session) => {
            const elapsed = Date.now() - new Date(session.startTime).getTime();
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => navigateTo("packet-capture", "analysis")}
                className="flex items-center gap-3 rounded-md px-3 py-2 w-full text-left hover:bg-muted/10 transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground/75 truncate">
                    {session.name || "Unnamed"}
                  </p>
                  <div className="flex items-center gap-3 text-3xs text-muted-foreground/50 mt-0.5">
                    <span className="tabular-nums">{session.packetCount ?? 0} pkts</span>
                    <span className="tabular-nums">{formatDuration(elapsed)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          compact
          variant="inline"
          icon={<Eye />}
          title="No active captures"
          className="py-6"
        />
      )}
    </div>
  );
}
