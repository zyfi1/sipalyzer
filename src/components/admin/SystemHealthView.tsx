import { useQuery } from "@tanstack/react-query";
import { getSystemHealth, type SystemHealth } from "@/api/admin";

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

interface MetricCardProps {
  label: string;
  value: string;
  secondary?: string;
}

function MetricCard({ label, value, secondary }: MetricCardProps) {
  return (
    <div className="ui-panel-shell rounded-lg p-4">
      <p className="text-caption mb-1">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {secondary && <p className="text-caption mt-0.5">{secondary}</p>}
    </div>
  );
}

export function SystemHealthView() {
  const { data: health } = useQuery<SystemHealth>({
    queryKey: ["admin", "system-health"],
    queryFn: getSystemHealth,
    refetchInterval: 5000,
  });

  if (!health) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-caption">Loading...</p>
      </div>
    );
  }

  const memPercent =
    health.memory_total_mb > 0
      ? ((health.memory_used_mb / health.memory_total_mb) * 100).toFixed(1)
      : "0";

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <MetricCard
          label="App Uptime"
          value={formatUptime(health.uptime_seconds)}
          secondary="Time since app launched"
        />
        <MetricCard
          label="Memory"
          value={`${health.memory_used_mb} MB`}
          secondary={`${memPercent}% of ${health.memory_total_mb} MB total`}
        />
        <MetricCard
          label="CPU"
          value={`${health.cpu_usage_percent.toFixed(1)}%`}
          secondary="System-wide usage"
        />
        <MetricCard
          label="Database"
          value={formatBytes(health.db_size_bytes)}
          secondary="Local SQLite storage"
        />
        <MetricCard
          label="Active Tasks"
          value={String(health.active_processes)}
          secondary="Captures, calls, scans, etc."
        />
      </div>

      {/* Process breakdown */}
      {Object.keys(health.process_counts).length > 0 && (
        <div className="ui-panel-shell rounded-lg p-4">
          <p className="section-title mb-3">Tasks by Type</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(health.process_counts).map(([kind, count]) => (
              <span
                key={kind}
                className="chip rounded-lg bg-secondary px-2.5 py-1 text-xs capitalize"
              >
                {kind}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Refresh indicator */}
      <div className="flex items-center gap-2 px-1">
        <span className="bg-emerald-500 status-online rounded-full h-2 w-2" />
        <span className="text-caption">Auto-refreshing every 5s</span>
      </div>
    </div>
  );
}
