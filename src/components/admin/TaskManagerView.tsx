import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  Activity,
  RefreshCw,
  Trash,
  X,
} from "@/lib/icons";
import {
  clearAllProcesses,
  clearEvents,
  clearFinishedProcesses,
  clearProcess,
  getSystemHealth,
  killAllProcesses,
  killProcess,
  listProcesses,
  type ManagedProcess,
  type SystemHealth,
} from "@/api/admin";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ADMIN_PANEL, ADMIN_VIEW_CONTAINER } from "./viewStyles";

const KIND_COLORS: Record<string, string> = {
  capture: "border-l-emerald-500/40",
  fax: "border-l-amber-500/40",
  registration: "border-l-sky-500/40",
  call: "border-l-blue-500/40",
  agent: "border-l-rose-500/40",
  scan: "border-l-teal-500/40",
  monitor: "border-l-red-500/40",
  test: "border-l-violet-500/40",
};

const KIND_LABELS: Record<string, string> = {
  capture: "Capture",
  fax: "Fax",
  registration: "Register",
  call: "Call",
  agent: "Agent",
  scan: "Scan",
  monitor: "Monitor",
  test: "Test",
};

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  paused: "Paused",
  completed: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

const STATUS_STYLES: Record<string, string> = {
  running: "bg-emerald-500/12 text-emerald-400",
  paused: "bg-amber-500/12 text-amber-400",
  completed: "bg-muted text-muted-foreground",
  failed: "bg-destructive/12 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type GlobalAction = "killAll" | "clearAll" | "resetEvents";

export function TaskManagerView() {
  const [killTarget, setKillTarget] = useState<string | null>(null);
  const [globalAction, setGlobalAction] = useState<GlobalAction | null>(null);
  const queryClient = useQueryClient();
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const {
    data: processes = [],
    isFetching,
    refetch,
  } = useQuery<ManagedProcess[]>({
    queryKey: ["admin", "processes"],
    queryFn: listProcesses,
    refetchInterval: 3000,
  });

  const { data: health } = useQuery<SystemHealth>({
    queryKey: ["admin", "system-health"],
    queryFn: getSystemHealth,
    refetchInterval: 5000,
  });

  const killMutation = useMutation({
    mutationFn: killProcess,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "processes"] });
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearProcess,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "processes"] });
    },
  });

  const clearFinishedMutation = useMutation({
    mutationFn: clearFinishedProcesses,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "processes"] });
    },
  });

  const killAllMutation = useMutation({
    mutationFn: killAllProcesses,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "processes"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "system-health"] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: clearAllProcesses,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "processes"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "system-health"] });
    },
  });

  const clearEventsMutation = useMutation({
    mutationFn: clearEvents,
  });

  const handleKill = async (id: string) => {
    try { await killMutation.mutateAsync(id); } catch {}
    setKillTarget(null);
  };

  const handleClear = async (id: string) => {
    try { await clearMutation.mutateAsync(id); } catch {}
  };

  const handleClearFinished = async () => {
    try { await clearFinishedMutation.mutateAsync(); } catch {}
  };

  const handleKillAllRunning = async () => {
    try { await killAllMutation.mutateAsync(); } catch {}
  };

  const handleClearAllEntries = async () => {
    try { await clearAllMutation.mutateAsync(); } catch {}
  };

  const handleResetEvents = async () => {
    try { await clearEventsMutation.mutateAsync(); } catch {}
  };

  const handleConfirmGlobalAction = async () => {
    try {
      if (globalAction === "killAll") {
        await handleKillAllRunning();
      } else if (globalAction === "clearAll") {
        await handleClearAllEntries();
      } else if (globalAction === "resetEvents") {
        await handleResetEvents();
      }
    } finally {
      setGlobalAction(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "processes"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "system-health"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit", "entries"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit", "meta"] });
    }
  };

  const handleRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    void queryClient.invalidateQueries({ queryKey: ["admin", "system-health"] });
    setManualRefreshing(false);
  };

  const running = processes.filter((p) => p.status === "running");
  const paused = processes.filter((p) => p.status === "paused");
  const finished = processes.filter((p) => p.status !== "running" && p.status !== "paused");
  const failed = processes.filter((p) => p.status === "failed");
  const stopped = processes.filter((p) => p.status === "cancelled");
  const completed = processes.filter((p) => p.status === "completed");
  const activeWorkload = running.length + paused.length;
  const oldestRunning = running
    .map((p) => p.started_at)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  const hasAnyTasks = processes.length > 0;
  const canKillAll = running.length > 0;
  const canResetEvents = true;
  const memoryPercent =
    health && health.memory_total_mb > 0
      ? (health.memory_used_mb / health.memory_total_mb) * 100
      : 0;
  const processCounts = Object.entries(health?.process_counts ?? {}).sort((a, b) => b[1] - a[1]);
  const appMemoryLabel = health
    ? `${health.memory_used_mb} / ${health.memory_total_mb} MB`
    : "—";

  return (
    <div className={cn(ADMIN_VIEW_CONTAINER, "min-h-0 overflow-hidden")}>
      {/* Top card: manager overview + operations */}
      <div className={ADMIN_PANEL}>
        <div className="ui-section-header-md px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Task Manager</p>
              <p className="text-2xs text-muted-foreground mt-0.5">
                Background jobs, worker state, and execution activity.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {processes.length} {processes.length === 1 ? "task" : "tasks"}
              </span>
              {running.length > 0 && (
                <span className="rounded-full px-2 py-0.5 text-2xs font-semibold bg-emerald-500/12 text-emerald-400">
                  {running.length} running
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="border-b border-border/40 p-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-md border border-border/40 bg-muted/15 p-3">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Host System</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">CPU Load</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">
                    {health ? `${health.cpu_usage_percent.toFixed(1)}%` : "—"}
                  </p>
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Memory In Use</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">{appMemoryLabel}</p>
                  {health && (
                    <p className="text-3xs text-muted-foreground tabular-nums">
                      {memoryPercent.toFixed(1)}%
                    </p>
                  )}
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Host Uptime</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">
                    {health ? formatUptime(health.uptime_seconds) : "—"}
                  </p>
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">DB Footprint</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">
                    {health ? formatBytes(health.db_size_bytes) : "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border/40 bg-muted/15 p-3">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">App Workload Now</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Tracked Tasks</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">
                    {processes.length}
                  </p>
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Active Workload</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">{activeWorkload}</p>
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Running / Paused</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">
                    {running.length} / {paused.length}
                  </p>
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Longest Running</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">
                    {oldestRunning ? formatDuration(oldestRunning) : "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border/40 bg-muted/15 p-3">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">Internal Resources</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Running</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">{running.length}</p>
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Paused</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">{paused.length}</p>
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Completed</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">{completed.length}</p>
                </div>
                <div className="rounded border border-border/30 bg-card/40 px-2.5 py-2">
                  <p className="text-3xs uppercase tracking-wide text-muted-foreground">Failed / Stopped</p>
                  <p className="text-xs font-semibold tabular-nums mt-0.5">
                    {failed.length + stopped.length}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {processCounts.length === 0 ? (
                  <EmptyState
                    compact
                    variant="inline"
                    title="No internal resource channels active."
                    className="w-auto flex-none items-start justify-start p-0 text-left"
                  />
                ) : (
                  processCounts.map(([kind, count]) => (
                    <span
                      key={kind}
                      className="rounded-full px-2 py-0.5 text-2xs font-semibold bg-secondary text-muted-foreground capitalize"
                    >
                      {KIND_LABELS[kind] ?? kind}: {count}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              disabled={!canKillAll}
              onClick={() => setGlobalAction("killAll")}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Kill all running
            </Button>
            <Button
              variant="neutral"
              size="sm"
              className="h-8 text-xs"
              disabled={!hasAnyTasks}
              onClick={() => setGlobalAction("clearAll")}
            >
              <Trash className="h-3.5 w-3.5 mr-1" />
              Clear all entries
            </Button>
            <TooltipWrapper content="Clear admin event history">
              <Button
                variant="neutral"
                size="sm"
                className="h-8 text-xs"
                disabled={!canResetEvents || clearEventsMutation.isPending}
                onClick={() => setGlobalAction("resetEvents")}
              >
                Reset admin events
              </Button>
            </TooltipWrapper>
            {finished.length > 0 && (
              <Button
                variant="neutral"
                size="sm"
                onClick={handleClearFinished}
                className="h-8 text-xs"
              >
                <Trash className="h-3.5 w-3.5 mr-1" />
                Clear finished
              </Button>
            )}
            <div className="ml-auto">
              <Button
                variant="neutral"
                size="sm"
                onClick={handleRefresh}
                disabled={manualRefreshing}
                className="h-8 text-xs"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5 mr-1", (manualRefreshing || isFetching) && "animate-spin")}
                />
                Refresh
              </Button>
            </div>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground">
            Reset admin events clears the operational event stream and starts a fresh audit chain.
          </p>
        </div>
      </div>

      {/* Bottom card: task list */}
      <div className={cn("flex-1 min-h-0 relative flex flex-col overflow-hidden", ADMIN_PANEL)}>
        <div className="px-4 py-2.5 ui-sticky-header flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground/90 uppercase tracking-wide">Task List</span>
          <span className="text-2xs text-muted-foreground tabular-nums">
            {processes.length} total
          </span>
          {finished.length > 0 && (
            <span className="rounded-full px-2 py-0.5 text-2xs font-semibold bg-muted text-muted-foreground">
              {finished.length} finished
            </span>
          )}
        </div>

        {processes.length === 0 ? (
          <div className="flex-1 min-h-0 p-4">
            <div className="h-full w-full rounded-md border border-dashed border-border/45 bg-muted/15 flex items-center justify-center">
              <EmptyState
                icon={<Activity className="h-7 w-7" />}
                title="No active tasks"
                description="When captures, calls, scans, or other jobs run, they will appear here with live status."
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="ui-sticky-header grid grid-cols-[90px_minmax(0,1fr)_80px_90px_40px] gap-3 px-4 py-2 text-2xs uppercase tracking-wide text-muted-foreground">
              <span>Type</span>
              <span>Task</span>
              <span className="text-right">Runtime</span>
              <span className="text-center">Status</span>
              <span />
            </div>
            <div className="divide-y divide-border/30">
            {processes.map((proc) => {
              const colorClass =
                KIND_COLORS[proc.kind] ?? "border-l-muted-foreground/40";
              const statusClass =
                STATUS_STYLES[proc.status] ?? "bg-muted text-muted-foreground";
              const isRunning = proc.status === "running";

              return (
                <div
                  key={proc.id}
                  className={cn(
                    "border-l-2 flex items-center gap-3 px-4 py-3 transition-smooth hover:bg-muted/20",
                    colorClass,
                  )}
                >
                  <span className="rounded-full px-2 py-0.5 text-2xs font-semibold bg-secondary w-[70px] text-center">
                    {KIND_LABELS[proc.kind] ?? proc.kind}
                  </span>
                  <span className="text-sm text-foreground/90 flex-1 truncate">{proc.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums font-mono w-[70px] text-right">
                    {isRunning ? formatDuration(proc.started_at) : "—"}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-2xs font-semibold w-[86px] text-center",
                      statusClass,
                    )}
                  >
                    {STATUS_LABELS[proc.status] ?? proc.status}
                  </span>
                  {isRunning ? (
                    <TooltipWrapper content="Stop task">
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => setKillTarget(proc.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    </TooltipWrapper>
                  ) : (
                    <TooltipWrapper content="Remove from list">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => handleClear(proc.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    </TooltipWrapper>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!killTarget}
        onOpenChange={(open) => !open && setKillTarget(null)}
        title="Stop Task"
        description="Are you sure you want to stop this task? Any work in progress will be lost."
        confirmText="Stop"
        variant="destructive"
        onConfirm={() => killTarget && handleKill(killTarget)}
      />
      <ConfirmDialog
        open={globalAction !== null}
        onOpenChange={(open) => !open && setGlobalAction(null)}
        title={
          globalAction === "killAll"
            ? "Kill All Running Tasks"
            : globalAction === "clearAll"
              ? "Clear All Task Entries"
              : "Reset Admin Events"
        }
        description={
          globalAction === "killAll"
            ? "Are you sure you want to stop all running tasks? Any work in progress will be lost."
            : globalAction === "clearAll"
              ? "Are you sure you want to remove all task entries from the list?"
              : "Are you sure you want to reset all admin events? Existing event history will be replaced with a new baseline."
        }
        confirmText={
          globalAction === "killAll"
            ? "Kill all"
            : globalAction === "clearAll"
              ? "Clear all"
              : "Reset events"
        }
        variant="destructive"
        onConfirm={handleConfirmGlobalAction}
      />
    </div>
  );
}
