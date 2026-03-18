import { useQuery } from "@tanstack/react-query";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import type { AgentConnection } from "@/api/remoteAgent";
import { Badge } from "@/components/ui/badge";
import {
  Satellite, Activity, Clock, Globe,
  WindowsLogo, AppleLogo, LinuxLogo,
} from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { QuickDeploy } from "./QuickDeploy";
import { useToolVisible } from "@/hooks/useToolVisible";
import { useDocumentVisibility } from "@/hooks/useDocumentVisibility";
import { queryKeys } from "@/lib/queryKeys";

// ── Helpers ──────────────────────────────────────────────────────────

function osIcon(os: string) {
  const lower = os.toLowerCase();
  if (lower.includes("windows")) return WindowsLogo;
  if (lower.includes("mac") || lower.includes("darwin")) return AppleLogo;
  if (lower.includes("linux")) return LinuxLogo;
  return Satellite;
}

const TYPE_COLORS: Record<string, string> = {
  connected: "text-success",
  disconnected: "text-warning",
  command_sent: "text-info",
  command_result: "text-info",
  command_error: "text-destructive",
  killed: "text-warning",
  self_destructed: "text-destructive",
  listener_started: "text-primary",
  listener_stopped: "text-muted-foreground",
  generated: "text-info",
  auth_failed: "text-destructive",
  auth_success: "text-success",
  heartbeat_timeout: "text-warning",
  permission_error: "text-warning",
  agent_expired: "text-muted-foreground",
  reconnected: "text-info",
  relay_waiting: "text-primary",
  relay_error: "text-warning",
};

// ── Component ────────────────────────────────────────────────────────

export function OverviewTab({ pollingEnabled = true }: { pollingEnabled?: boolean }) {
  const connections = useRemoteAgentStore((s) => s.connections);
  const pendingCommands = useRemoteAgentStore((s) => s.pendingCommands);
  const generatedConfigs = useRemoteAgentStore((s) => s.generatedConfigs);
  const activityLog = useRemoteAgentStore((s) => s.activityLog);
  const activeRelaySessions = useRemoteAgentStore((s) => s.activeRelaySessions);
  const refreshConnections = useRemoteAgentStore((s) => s.refreshConnections);
  const isRemoteAgentVisible = useToolVisible("remote-agent");
  const isDocumentVisible = useDocumentVisibility();

  const shouldPollConnections = pollingEnabled && isRemoteAgentVisible && isDocumentVisible;
  useQuery({
    queryKey: queryKeys.remoteAgent.connections,
    queryFn: refreshConnections,
    enabled: shouldPollConnections,
    refetchInterval: shouldPollConnections ? 3000 : false,
  });

  const relayCount = activeRelaySessions.size;
  const onlineCount = connections.filter((c) => c.status === "connected").length;
  const totalCreated = generatedConfigs.length;
  const minimalCreated = generatedConfigs.filter((c) => c.experience === "minimal").length;
  const fullCreated = totalCreated - minimalCreated;
  const activeCommands = pendingCommands.filter(
    (c) => c.status === "running" || c.status === "pending"
  ).length;

  const avgLatency =
    connections.filter((c) => c.latency_ms != null).length > 0
      ? connections.reduce((sum, c) => sum + (c.latency_ms ?? 0), 0) /
        connections.filter((c) => c.latency_ms != null).length
      : null;

  const onlineAgents = connections.filter((c) => c.status === "connected");
  const recentActivity = activityLog.slice(0, 20);

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* ── Row 1: Status Strip ── */}
      <div className="ui-surface-card shrink-0">
        <div className="flex items-center divide-x divide-border/20">
          <StatusChip
            icon={<Globe className="h-3.5 w-3.5" />}
            value={relayCount > 0 ? "Active" : "Idle"}
            label="Relay"
            active={relayCount > 0}
            pulse={relayCount > 0}
          />
          <StatusChip
            icon={<Satellite className="h-3.5 w-3.5" />}
            value={String(onlineCount)}
            label={totalCreated > 0 ? `of ${totalCreated} online` : "online"}
            active={onlineCount > 0}
          />
          <StatusChip
            icon={<Activity className="h-3.5 w-3.5" />}
            value={String(activeCommands)}
            label="active"
            active={activeCommands > 0}
          />
          <StatusChip
            icon={<Satellite className="h-3.5 w-3.5" />}
            value={`${fullCreated}/${minimalCreated}`}
            label="full/minimal"
            active={totalCreated > 0}
          />
          <StatusChip
            icon={<Clock className="h-3.5 w-3.5" />}
            value={avgLatency != null ? avgLatency.toFixed(0) : "--"}
            label="ms avg"
            active={avgLatency != null && avgLatency < 100}
            warn={avgLatency != null && avgLatency >= 300}
          />
        </div>
      </div>

      {/* ── Row 2: Deploy (left) + Online Agents (right) ── */}
      <div className="grid grid-cols-2 gap-3 shrink-0">
        <QuickDeploy />

        {/* Online Agents */}
        <div className="ui-surface-card flex flex-col min-h-0">
          <div className="ui-section-header-md flex items-center justify-between shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Online Agents
            </span>
            <Badge variant="secondary" className="text-2xs px-1.5 py-0 h-4 font-mono tabular-nums">
              {onlineCount}
            </Badge>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
            {onlineAgents.length === 0 ? (
              <EmptyState variant="inline" title="No agents online" description="Deploy an agent to get started." />
            ) : (
              <div className="space-y-0.5">
                {onlineAgents.map((agent) => (
                  <OnlineAgentRow key={agent.id} agent={agent} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 3: Recent Activity (full width) ── */}
        <div className="ui-surface-card flex flex-col flex-1 min-h-0">
        <div className="ui-section-header-md flex items-center justify-between shrink-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Recent Activity
          </span>
          <Badge variant="secondary" className="text-2xs px-1.5 py-0 h-4 font-mono tabular-nums">
            {activityLog.length}
          </Badge>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
          {recentActivity.length === 0 ? (
            <EmptyState
              variant="inline"
              compact
              title="No activity yet"
              description="Activity will appear here"
              className="min-h-[100px]"
            />
          ) : (
            <div className="space-y-0.5">
              {recentActivity.map((entry) => {
                const time = new Date(entry.timestamp);
                const timeStr = time.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <div key={entry.id} className="ui-data-row flex items-center gap-2 px-2 py-1.5 rounded transition-smooth">
                    <span className="text-2xs text-muted-foreground/60 font-mono tabular-nums shrink-0 w-12">
                      {timeStr}
                    </span>
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        TYPE_COLORS[entry.type]
                          ? (TYPE_COLORS[entry.type] ?? "text-muted-foreground/60").replace("text-", "bg-")
                          : "bg-muted-foreground/30"
                      )}
                    />
                    <span className="text-xs text-foreground/70 truncate flex-1">
                      {entry.message}
                    </span>
                  </div>
                );
              })}
              {activityLog.length > 20 && (
                <div className="text-2xs text-muted-foreground/60 text-center py-1">
                  +{activityLog.length - 20} more — see Activity tab
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function StatusChip({
  icon,
  value,
  label,
  active,
  pulse,
  warn,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  active?: boolean;
  pulse?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 flex-1 min-w-0">
      {pulse && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-live-ripple motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-success status-online" />
        </span>
      )}
      <span className={cn(
        "shrink-0 transition-smooth",
        active ? "text-foreground" : "text-muted-foreground/60"
      )}>
        {icon}
      </span>
      <span className={cn(
        "text-sm font-bold tabular-nums transition-smooth",
        warn ? "text-warning" : active ? "text-foreground" : "text-muted-foreground"
      )}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground/60 truncate">{label}</span>
    </div>
  );
}

function OnlineAgentRow({ agent }: { agent: AgentConnection }) {
  const OsIcon = osIcon(agent.os);
  return (
    <div className="ui-data-row flex items-center gap-2.5 px-2 py-2 rounded transition-smooth">
      <span className="w-2 h-2 rounded-full bg-success status-online shrink-0 shadow-[0_0_6px_hsl(var(--success)/0.3)]" />
      <span className="text-sm font-medium truncate flex-1">
        {agent.name || agent.hostname}
      </span>
      <OsIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
      <span className="text-xs text-muted-foreground/60 font-mono tabular-nums shrink-0">
        {agent.latency_ms != null ? `${agent.latency_ms.toFixed(0)}ms` : "\u2014"}
      </span>
    </div>
  );
}
