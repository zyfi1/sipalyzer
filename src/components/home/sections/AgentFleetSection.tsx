import { useState, useEffect } from "react";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { Server, RefreshCw, Globe, Wifi } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

export function AgentFleetSection() {
  const connections = useRemoteAgentStore((s) => s.connections);
  const refreshConnections = useRemoteAgentStore((s) => s.refreshConnections);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    refreshConnections();
    const id = setInterval(() => refreshConnections(), 30_000);
    return () => clearInterval(id);
  }, [refreshConnections]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshConnections(); } finally { setRefreshing(false); }
  };

  const connected = connections.filter((c) => c.status === "connected");
  const disconnected = connections.filter((c) => c.status === "disconnected");
  const authenticating = connections.filter((c) => c.status === "authenticating");

  return (
    <div className="surface p-4 flex flex-col gap-2.5 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Server className="h-3.5 w-3.5 text-muted-foreground/60" />
          <h2 className="text-xs font-semibold text-foreground/70">Remote Agents</h2>
          {connections.length > 0 && (
            <span className={cn(
              "text-3xs font-semibold px-1.5 py-0.5 rounded-full tabular-nums",
              connected.length > 0 ? "bg-success/15 text-success" : "bg-muted/15 text-muted-foreground/60",
            )}>
              {connected.length} online
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground/60 hover:text-foreground/70"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
        </Button>
      </div>

      {connections.length > 0 ? (
        <div className="space-y-0.5 overflow-y-auto -mx-2 px-2 flex-1 min-h-0">
          {[...connected, ...authenticating, ...disconnected].map((agent) => (
            <div
              key={agent.id}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-muted/10 transition-smooth"
            >
              <div className={cn(
                "w-2 h-2 rounded-full shrink-0",
                agent.status === "connected" ? "bg-success status-online" :
                agent.status === "authenticating" ? "bg-warning status-warning" :
                "bg-muted-foreground/30",
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground/75 truncate">
                    {agent.name || agent.hostname}
                  </span>
                  {agent.status === "authenticating" && (
                    <span className="text-3xs px-1 py-0.5 rounded bg-warning/10 text-warning/70 font-medium shrink-0">
                      AUTH
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-3xs text-muted-foreground/50 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Globe className="h-2.5 w-2.5" />
                    {agent.ip}
                  </span>
                  <span>{agent.os}</span>
                  {agent.status === "connected" && agent.latency_ms != null && (
                    <span className="flex items-center gap-1">
                      <Wifi className="h-2.5 w-2.5" />
                      {agent.latency_ms}ms
                    </span>
                  )}
                </div>
              </div>
              {agent.status === "connected" && (
                <span className="text-3xs text-muted-foreground/40 tabular-nums shrink-0">
                  {formatUptime(agent.uptime_secs)}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          variant="inline"
          icon={<Server />}
          title="No agents connected"
          className="min-h-0"
        />
      )}
    </div>
  );
}
