import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { Calendar } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

export function ScheduledTasksSection() {
  const pendingCommands = useRemoteAgentStore((s) => s.pendingCommands);

  const pending = pendingCommands.filter(
    (c) => c.status === "pending" || c.status === "running",
  );

  return (
    <div className="surface p-5 flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <Calendar className="h-4 w-4 text-muted-foreground/60" />
        <h2 className="text-sm font-semibold text-foreground/70">Scheduled Tasks</h2>
        {pending.length > 0 && (
          <span className={cn(
            "text-3xs font-semibold px-1.5 py-0.5 rounded-full tabular-nums",
            "bg-primary/15 text-primary",
          )}>
            {pending.length}
          </span>
        )}
      </div>

      {pending.length > 0 ? (
        <div className="space-y-0.5 overflow-y-auto -mx-2 px-2 flex-1 min-h-0">
          {pending.map((cmd) => (
            <div
              key={cmd.id}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-muted/10 transition-colors"
            >
              <div className={cn(
                "w-2 h-2 rounded-full shrink-0",
                cmd.status === "running" ? "bg-success status-online" : "bg-warning",
              )} />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-foreground/70 truncate block">{cmd.type}</span>
                <span className="text-3xs text-muted-foreground/40 truncate block mt-0.5">
                  Agent: {cmd.agentId}
                </span>
              </div>
              <span className={cn(
                "text-3xs px-1.5 py-0.5 rounded font-medium shrink-0",
                cmd.status === "running" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
              )}>
                {cmd.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          variant="inline"
          icon={<Calendar />}
          title="No scheduled tasks"
          className="min-h-0"
        />
      )}
    </div>
  );
}
