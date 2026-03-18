import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useRemoteAgentStore,
  type GeneratedConfig,
} from "@/stores/remoteAgentStore";
import type { AgentConnection } from "@/api/remoteAgent";
import * as api from "@/api/remoteAgent";
import { RELAY_URL } from "@/api/remoteAgent";
import { save } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search, Trash, Power, X, Edit, Copy, Globe, Download,
  WindowsLogo, AppleLogo, LinuxLogo, Satellite,
  ChevronDown, ChevronRight, RefreshCw, CheckCircle2, XCircle,
} from "@/lib/icons";
import { Spinner } from "@/components/ui/spinner";
import { InlineNoteWidget } from "@/components/notes/widgets/InlineNoteWidget";
import { createAgentContext } from "@/lib/noteContext";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useNotificationStore } from "@/stores/notificationStore";
import { useToolVisible } from "@/hooks/useToolVisible";
import { useDocumentVisibility } from "@/hooks/useDocumentVisibility";
import { queryKeys } from "@/lib/queryKeys";
import { relaySessionIdFromControllerAddress } from "@/lib/relaySessions";
import { RemoteChatPanel } from "@/components/remote-agent/RemoteChatPanel";

// ── Types ────────────────────────────────────────────────────────────

/** Merged view of a created agent — combines GeneratedConfig + live AgentConnection if online. */
interface RegistryAgent {
  config: GeneratedConfig;
  connection: AgentConnection | null;
  managed: boolean;
  status: "online" | "offline" | "expired";
  lastSeenAt: string | null;
}

type StatusFilter = "all" | "online" | "offline" | "expired";
type PlatformFilter = "all" | "windows" | "macos" | "linux";

// ── Helpers ──────────────────────────────────────────────────────────

function osIcon(os: string) {
  const lower = os.toLowerCase();
  if (lower.includes("windows")) return WindowsLogo;
  if (lower.includes("mac") || lower.includes("darwin")) return AppleLogo;
  if (lower.includes("linux")) return LinuxLogo;
  return Satellite;
}

function osFilterMatch(os: string, filter: PlatformFilter): boolean {
  if (filter === "all") return true;
  const lower = os.toLowerCase();
  if (filter === "windows") return lower.includes("windows");
  if (filter === "macos") return lower.includes("mac") || lower.includes("darwin");
  if (filter === "linux") return lower.includes("linux");
  return true;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isConnectionOnline(connection: AgentConnection | null | undefined): boolean {
  if (!connection || connection.status !== "connected") return false;
  const ts = Date.parse(connection.last_heartbeat);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 90_000;
}

function osFileExt(os: string): string {
  if (os.toLowerCase().includes("windows")) return ".exe";
  return "";
}

function syntheticConfigFromConnection(conn: AgentConnection): GeneratedConfig {
  const now = new Date().toISOString();
  return {
    id: `discovered:${conn.id}`,
    agentId: conn.id,
    targetOs: conn.os || "unknown",
    controllerAddress: conn.ip || "unknown",
    authToken: "",
    generatedAt: now,
    createdAt: now,
    rebuiltCount: 0,
    label: conn.name || conn.hostname || null,
    zipPath: "",
    profile: conn.profile || "unknown",
    experience: conn.profile === "minimal" ? "minimal" : "full",
  };
}

function experienceLabel(experience: GeneratedConfig["experience"]): string {
  return experience === "minimal" ? "Minimal" : "Full";
}

type CapabilityGroup = {
  title: string;
  items: Array<{ id: string; label: string }>;
};

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    title: "Network Diagnostics",
    items: [
      { id: "Ping", label: "Ping" },
      { id: "Traceroute", label: "Traceroute" },
      { id: "Mtr", label: "MTR" },
      { id: "PortScan", label: "Port Scan" },
      { id: "StunTest", label: "STUN / NAT Test" },
      { id: "NtpCheck", label: "NTP Check" },
      { id: "NatDetect", label: "NAT / ALG Detect" },
      { id: "PacketCapture", label: "Packet Capture" },
      { id: "DeviceScan", label: "Device Scan" },
      { id: "SystemInfo", label: "System Info" },
      { id: "SnmpPoll", label: "SNMP Poll" },
    ],
  },
  {
    title: "DNS & SIP",
    items: [
      { id: "DnsLookup", label: "DNS Lookup" },
      { id: "DnsSipResolve", label: "DNS SIP Resolve" },
      { id: "DnsReverse", label: "DNS Reverse" },
      { id: "DnsDig", label: "DNS Dig" },
      { id: "DnsGeoIp", label: "DNS GeoIP" },
      { id: "SipRegistrationTest", label: "SIP Registration Test" },
      { id: "SipProbe", label: "SIP Probe" },
      { id: "SipCall", label: "SIP Call" },
      { id: "FaxSend", label: "Fax Send" },
    ],
  },
  {
    title: "Files, Logs & Provisioning",
    items: [
      { id: "SyslogListen", label: "Syslog Listener" },
      { id: "FetchLog", label: "Log Viewer (Fetch)" },
      { id: "TailLog", label: "Log Viewer (Tail)" },
      { id: "FileServe", label: "File / TFTP Server" },
      { id: "ListDir", label: "File Browser" },
      { id: "FirmwareDownload", label: "Firmware Download" },
      { id: "FetchProvision", label: "Provision Fetcher" },
      { id: "Shell", label: "Remote Shell" },
      { id: "DeviceControl", label: "Device Control" },
    ],
  },
  {
    title: "Multicast",
    items: [
      { id: "MulticastJoin", label: "Multicast Join" },
      { id: "MulticastIgmpQuery", label: "IGMP Query" },
      { id: "MulticastSnoopingVerify", label: "Snooping Verify" },
      { id: "MulticastSendTest", label: "Multicast Send Test" },
    ],
  },
];

// ── Main Component ──────────────────────────────────────────────────

export function AgentRegistryTab({ pollingEnabled = true }: { pollingEnabled?: boolean }) {
  const generatedConfigs = useRemoteAgentStore((s) => s.generatedConfigs);
  const connections = useRemoteAgentStore((s) => s.connections);
  const activityLog = useRemoteAgentStore((s) => s.activityLog);
  const refreshConnections = useRemoteAgentStore((s) => s.refreshConnections);
  const clearGeneratedConfigs = useRemoteAgentStore((s) => s.clearGeneratedConfigs);
  const disconnectAgent = useRemoteAgentStore((s) => s.disconnectAgent);
  const killAgent = useRemoteAgentStore((s) => s.killAgent);
  const selfDestructAgent = useRemoteAgentStore((s) => s.selfDestructAgent);
  const renameAgent = useRemoteAgentStore((s) => s.renameAgent);
  const addGeneratedConfig = useRemoteAgentStore((s) => s.addGeneratedConfig);
  const restoreRelaySessions = useRemoteAgentStore((s) => s.restoreRelaySessions);
  const ensureRelayForAgent = useRemoteAgentStore((s) => s.ensureRelayForAgent);
  const addLogEntry = useRemoteAgentStore((s) => s.addLogEntry);
  const activeRelaySessions = useRemoteAgentStore((s) => s.activeRelaySessions);
  const pendingCommands = useRemoteAgentStore((s) => s.pendingCommands);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const isRemoteAgentVisible = useToolVisible("remote-agent");
  const isDocumentVisible = useDocumentVisibility();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);
  const [restoringRelays, setRestoringRelays] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete-selected" | "delete-all" | "delete-expired" | "remove-agent";
    agentId?: string;
  } | null>(null);

  const shouldPollConnections = pollingEnabled && isRemoteAgentVisible && isDocumentVisible;
  useQuery({
    queryKey: queryKeys.remoteAgent.connections,
    queryFn: refreshConnections,
    enabled: shouldPollConnections,
    refetchInterval: shouldPollConnections ? 3000 : false,
  });

  // Build merged registry
  const lastSeenByAgent = useMemo(() => {
    const seen = new Map<string, string>();
    const seenEventTypes = new Set([
      "connected",
      "reconnected",
      "auth_success",
      "disconnected",
      "heartbeat_timeout",
    ]);
    for (const entry of activityLog) {
      if (!entry.agentId || !seenEventTypes.has(entry.type)) continue;
      if (!seen.has(entry.agentId)) {
        seen.set(entry.agentId, entry.timestamp);
      }
    }
    return seen;
  }, [activityLog]);

  const registry: RegistryAgent[] = useMemo(() => {
    const managedByAgentId = new Map<string, GeneratedConfig>();
    for (const cfg of generatedConfigs) managedByAgentId.set(cfg.agentId, cfg);

    const managedRows: RegistryAgent[] = generatedConfigs.map((config) => {
      const connection = connections.find((c) => c.id === config.agentId) ?? null;
      const isOnline = isConnectionOnline(connection);
      const fallbackLastSeen = lastSeenByAgent.get(config.agentId) ?? null;
      return {
        config,
        connection,
        managed: true,
        status: isOnline ? "online" : "offline",
        lastSeenAt: connection?.last_heartbeat ?? fallbackLastSeen,
      } as RegistryAgent;
    });

    const discoveredRows: RegistryAgent[] = connections
      .filter((c) => !managedByAgentId.has(c.id))
      .map((connection) => {
        const isOnline = isConnectionOnline(connection);
        const fallbackLastSeen = lastSeenByAgent.get(connection.id) ?? null;
        return {
          config: syntheticConfigFromConnection(connection),
          connection,
          managed: false,
          status: isOnline ? "online" : "offline",
          lastSeenAt: connection.last_heartbeat ?? fallbackLastSeen,
        } as RegistryAgent;
      });

    return [...managedRows, ...discoveredRows].sort((a, b) => {
      if (a.status !== b.status) return a.status === "online" ? -1 : 1;
      return (a.connection?.name || a.connection?.hostname || a.config.agentId).localeCompare(
        b.connection?.name || b.connection?.hostname || b.config.agentId,
      );
    });
  }, [generatedConfigs, connections, lastSeenByAgent]);

  // Filtered
  const filtered = useMemo(() => {
    return registry.filter((agent) => {
      // Status filter
      if (statusFilter !== "all" && agent.status !== statusFilter) return false;
      // Platform filter
      if (!osFilterMatch(agent.config.targetOs, platformFilter)) return false;
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const name =
          agent.connection?.name || agent.connection?.hostname || agent.config.label || "";
        return (
          name.toLowerCase().includes(q) ||
          agent.config.agentId.toLowerCase().includes(q) ||
          agent.config.targetOs.toLowerCase().includes(q) ||
          agent.config.controllerAddress.toLowerCase().includes(q) ||
          (agent.connection?.ip?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [registry, statusFilter, platformFilter, searchQuery]);

  // Counts
  const onlineCount = registry.filter((a) => a.status === "online").length;
  const offlineCount = registry.filter((a) => a.status === "offline").length;
  const expiredCount = registry.filter((a) => a.status === "expired").length;
  const relayRefreshNeeded = registry.some((a) => {
    if (a.status === "online") return false;
    const sid = relaySessionIdFromControllerAddress(a.config.controllerAddress);
    if (!sid) return false;
    return !activeRelaySessions.has(sid);
  });

  // Selection
  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((a) => a.config.id)));
    }
  }, [allSelected, filtered]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Bulk delete
  const handleDeleteSelected = useCallback(() => {
    const store = useRemoteAgentStore.getState();
    const toRemove = new Set(selectedIds);
    // Remove from generated configs
    const remaining = store.generatedConfigs.filter((c) => !toRemove.has(c.id));
    useRemoteAgentStore.setState({ generatedConfigs: remaining });
    setSelectedIds(new Set());
    setConfirmAction(null);
  }, [selectedIds]);

  const handleDeleteExpired = useCallback(() => {
    const store = useRemoteAgentStore.getState();
    const expiredIds = new Set(
      registry.filter((a) => a.status === "expired").map((a) => a.config.id)
    );
    const remaining = store.generatedConfigs.filter((c) => !expiredIds.has(c.id));
    useRemoteAgentStore.setState({ generatedConfigs: remaining });
    setConfirmAction(null);
  }, [registry]);

  const handleDeleteAll = useCallback(() => {
    clearGeneratedConfigs();
    setSelectedIds(new Set());
    setConfirmAction(null);
  }, [clearGeneratedConfigs]);

  const handleRemoveAgent = useCallback(
    async (agentId: string) => {
      const isOnlineNow = () =>
        useRemoteAgentStore
          .getState()
          .connections.some((c) => c.id === agentId && isConnectionOnline(c));

      // If the agent is offline, auto-start tunnel and give it a short
      // window to reconnect before issuing SelfDestruct.
      if (!isOnlineNow()) {
        await ensureRelayForAgent(agentId).catch(() => {});
        for (let i = 0; i < 6 && !isOnlineNow(); i += 1) {
          await refreshConnections().catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      let removedRemotely = false;
      try {
        await selfDestructAgent(agentId);
        removedRemotely = true;
      } catch {
        // Connection can still fail on unstable links; fall back to forgetting
        // stale registry state so the UI can always be cleaned up.
        await api.forgetAgent(agentId).catch(() => {});
        addNotification({
          type: "warning",
          title: "Agent Unreachable",
          description:
            "Removed from registry, but remote binary could not be confirmed deleted.",
          source: "system",
          priority: "normal",
          navigation: { tool: "remote-agent", view: "registry" },
        });
      }
      const store = useRemoteAgentStore.getState();
      const remaining = store.generatedConfigs.filter((c) => c.agentId !== agentId);
      const remainingConnections = store.connections.filter((c) => c.id !== agentId);
      useRemoteAgentStore.setState({
        generatedConfigs: remaining,
        connections: remainingConnections,
      });
      setSelectedIds(new Set());
      setExpandedId((prev) => {
        if (!prev) return null;
        const removed = store.generatedConfigs.find((c) => c.agentId === agentId && c.id === prev);
        return removed ? null : prev;
      });
      setConfirmAction(null);
      if (!removedRemotely) {
        await refreshConnections().catch(() => {});
      }
    },
    [selfDestructAgent, ensureRelayForAgent, refreshConnections, addNotification]
  );

  const handleDeleteSingle = useCallback(
    async (agent: RegistryAgent) => {
      const store = useRemoteAgentStore.getState();
      if (agent.managed) {
        const remaining = store.generatedConfigs.filter((c) => c.id !== agent.config.id);
        useRemoteAgentStore.setState({ generatedConfigs: remaining });
        return;
      }
      const agentId = agent.connection?.id ?? agent.config.agentId;
      if (!agentId) return;
      await api.forgetAgent(agentId);
      const remainingConnections = store.connections.filter((c) => c.id !== agentId);
      useRemoteAgentStore.setState({ connections: remainingConnections });
      refreshConnections();
    },
    [refreshConnections]
  );

  const handleRebuild = useCallback(
    async (config: GeneratedConfig) => {
      const shortId = config.agentId.slice(0, 8);
      const ext = osFileExt(config.targetOs);

      let savePath: string | null = null;
      try {
        savePath = await save({
          title: `Save Rebuilt Agent (${config.targetOs})`,
          defaultPath: `sipalyzer-agent-${shortId}${ext}`,
        });
      } catch { /* cancelled */ }
      if (!savePath) return;

      setRebuildingId(config.id);
      try {
        const agentSessionId = crypto.randomUUID();
        const controllerAddr = `${RELAY_URL}/session/${agentSessionId}`;

        const res = await api.generateAgentPackage(
          {
            target_os: config.targetOs,
            controller_address: controllerAddr,
            use_tls: true,
            auth_token: config.authToken,
            expires_seconds: null,
            label: config.label,
            profile: config.experience ?? "full",
            experience: config.experience ?? "full",
            daemon_headless: (config.experience ?? "full") === "minimal",
            agent_id: config.agentId,
          },
          savePath,
        );

        await api.connectRelay(agentSessionId, config.authToken);

        const store = useRemoteAgentStore.getState();
        const updated = store.generatedConfigs.map((c) =>
          c.id === config.id
            ? {
                ...c,
                controllerAddress: controllerAddr,
                zipPath: res.binary_path,
                generatedAt: new Date().toISOString(),
                createdAt: c.createdAt || c.generatedAt,
                rebuiltCount: (c.rebuiltCount || 0) + 1,
                experience: c.experience ?? "full",
              }
            : c
        );
        useRemoteAgentStore.setState({ generatedConfigs: updated });
      } catch (err: any) {
        console.error("[Rebuild] Failed:", err);
      } finally {
        setRebuildingId(null);
      }
    },
    [addGeneratedConfig]
  );

  const handleRestoreRelays = useCallback(async () => {
    if (restoringRelays) return;
    setRestoringRelays(true);
    try {
      const started = await restoreRelaySessions();
      addLogEntry({
        agentId: null,
        agentHostname: null,
        type: "relay_waiting",
        message:
          started > 0
            ? `Manual relay restore started for ${started} session${started === 1 ? "" : "s"}`
            : "Manual relay restore found no relay sessions to restore",
      });
      addNotification({
        type: started > 0 ? "success" : "info",
        title: "Relay Restore",
        description:
          started > 0
            ? `Started ${started} relay session${started === 1 ? "" : "s"}`
            : "No relay sessions found to restore",
        source: "system",
        priority: "normal",
        navigation: { tool: "remote-agent", view: "registry" },
      });
    } finally {
      setRestoringRelays(false);
    }
  }, [restoringRelays, restoreRelaySessions, addLogEntry, addNotification]);

  const handleStartTunnel = useCallback(async (agent: RegistryAgent) => {
    const started = await ensureRelayForAgent(agent.config.agentId);
    addNotification({
      type: started ? "success" : "warning",
      title: started ? "Tunnel Started" : "Tunnel Unavailable",
      description: started
        ? `Secure tunnel restore started for ${agent.connection?.name || agent.connection?.hostname || agent.config.agentId.slice(0, 8)}`
        : "No relay tunnel configuration found for this agent",
      source: "system",
      priority: "normal",
      navigation: { tool: "remote-agent", view: "registry" },
    });
  }, [ensureRelayForAgent, addNotification]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Toolbar ── */}
      <div className="ui-surface-card p-3 mb-3 shrink-0">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              className="h-8 text-sm pl-8 ui-control-shell"
            />
          </div>

          {/* Status filter */}
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger size="sm" className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({registry.length})</SelectItem>
              <SelectItem value="online">Online ({onlineCount})</SelectItem>
              <SelectItem value="offline">Offline ({offlineCount})</SelectItem>
              <SelectItem value="expired">Expired ({expiredCount})</SelectItem>
            </SelectContent>
          </Select>

          {/* Platform filter */}
          <Select
            value={platformFilter}
            onValueChange={(v) => setPlatformFilter(v as PlatformFilter)}
          >
            <SelectTrigger size="sm" className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All OS</SelectItem>
              <SelectItem value="windows">Windows</SelectItem>
              <SelectItem value="macos">macOS</SelectItem>
              <SelectItem value="linux">Linux</SelectItem>
            </SelectContent>
          </Select>

          {/* Bulk Actions */}
          {someSelected ? (
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="text-xs px-2 h-7 font-mono tabular-nums">
                {selectedIds.size} selected
              </Badge>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 text-xs gap-1"
                onClick={() => setConfirmAction({ type: "delete-selected" })}
              >
                <Trash className="h-3 w-3" />
                Delete
              </Button>
              <Button
                size="sm"
                variant="neutral"
                className="h-8 text-xs"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {registry.length > 0 && (
                <>
                  <TooltipWrapper
                    title="Restore Relay Sessions"
                    description="Reconnect controller relay sessions for deployed agents. Use this after app restart/crash if agents are running but not reconnecting."
                    side="bottom"
                  >
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        variant="neutral"
                        className={cn(
                          "h-8 text-xs gap-1",
                          relayRefreshNeeded && !restoringRelays && "border-primary/35 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]"
                        )}
                        onClick={handleRestoreRelays}
                        disabled={restoringRelays}
                      >
                        <RefreshCw className={cn("h-3 w-3", restoringRelays && "animate-spin")} />
                        Restore Relays
                        {relayRefreshNeeded && !restoringRelays && (
                          <span className="relative flex h-2 w-2 ml-0.5">
                            <span className="animate-live-breathe motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-primary/80 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                          </span>
                        )}
                      </Button>
                    </span>
                  </TooltipWrapper>
                </>
              )}
              {expiredCount > 0 && (
                <Button
                  size="sm"
                  variant="neutral"
                  className="h-8 text-xs gap-1 text-destructive border-destructive/20 hover:bg-destructive/10"
                  onClick={() => setConfirmAction({ type: "delete-expired" })}
                >
                  <Trash className="h-3 w-3" />
                  Delete Expired
                </Button>
              )}
              {registry.length > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 text-xs gap-1"
                  onClick={() => setConfirmAction({ type: "delete-all" })}
                >
                  <Trash className="h-3 w-3" />
                  Delete All
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="ui-surface-card flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="ui-section-header-sm grid grid-cols-[32px_1fr_100px_140px_120px_100px_40px] gap-2 section-label-sm shrink-0">
          <span className="flex items-center justify-center">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="rounded border-border/40 h-3.5 w-3.5 accent-primary"
            />
          </span>
          <span>Agent</span>
          <span>Platform</span>
          <span>Address</span>
          <span>Created</span>
          <span>Status</span>
          <span />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <EmptyState
              variant="inline"
              compact
              icon={<Satellite />}
              title={
                registry.length === 0
                  ? "No agents deployed yet"
                  : "No matches"
              }
              description={
                registry.length === 0
                  ? "Deploy an agent from the Deploy tab to get started."
                  : "Try a different search or filter."
              }
            />
          ) : (
            <div className="flex flex-col">
              {filtered.map((agent) => (
                <RegistryRow
                  key={agent.config.id}
                  agent={agent}
                  isSelected={selectedIds.has(agent.config.id)}
                  isExpanded={expandedId === agent.config.id}
                  onToggleSelect={() => toggleSelect(agent.config.id)}
                  onToggleExpand={() =>
                    setExpandedId(
                      expandedId === agent.config.id ? null : agent.config.id
                    )
                  }
                  onDelete={() => void handleDeleteSingle(agent).catch(() => {})}
                  onRemoveAgent={() =>
                    setConfirmAction({
                      type: "remove-agent",
                      agentId: agent.config.agentId,
                    })
                  }
                  onDisconnect={() => disconnectAgent(agent.config.agentId)}
                  onKill={() => killAgent(agent.config.agentId)}
                  onRediscoverNetwork={async () => {
                    try {
                      await api.sendCommand(agent.config.agentId, { command: "Heartbeat" });
                      await refreshConnections();
                      setTimeout(() => { refreshConnections(); }, 900);
                      setTimeout(() => { refreshConnections(); }, 2000);
                      addLogEntry({
                        agentId: agent.config.agentId,
                        agentHostname: agent.connection?.name || agent.connection?.hostname || null,
                        type: "command_sent",
                        message: `Requested network rediscovery for ${agent.connection?.name || agent.connection?.hostname || agent.config.agentId.slice(0, 8)}`,
                      });
                      addNotification({
                        type: "success",
                        title: "Rediscover Network",
                        description: `Requested refresh for ${agent.connection?.name || agent.connection?.hostname || agent.config.agentId.slice(0, 8)}`,
                        source: "system",
                        priority: "normal",
                        navigation: { tool: "remote-agent", view: "registry" },
                      });
                    } catch {
                      addNotification({
                        type: "error",
                        title: "Rediscover Network",
                        description: "Failed to request refresh for this agent",
                        source: "system",
                        priority: "normal",
                        navigation: { tool: "remote-agent", view: "registry" },
                      });
                    }
                  }}
                  onRename={(name) => renameAgent(agent.config.agentId, name)}
                  onRebuild={() => handleRebuild(agent.config)}
                  onStartTunnel={() => handleStartTunnel(agent)}
                  isRebuilding={rebuildingId === agent.config.id}
                  activeRelaySessions={activeRelaySessions}
                  pendingCommands={pendingCommands}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer count */}
        <div className="text-3xs text-muted-foreground/60 px-3 py-1.5 border-t border-border/20 shrink-0 tabular-nums">
          {filtered.length} of {registry.length} agents
        </div>
      </div>

      {/* ── Confirm Dialogs ── */}
      <ConfirmDialog
        open={confirmAction?.type === "delete-selected"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Delete Selected Agents?"
        description={`Remove ${selectedIds.size} agent record${selectedIds.size !== 1 ? "s" : ""} from the registry? This does not affect agents already running on remote machines.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDeleteSelected}
      />
      <ConfirmDialog
        open={confirmAction?.type === "delete-expired"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Delete All Expired Agents?"
        description={`Remove ${expiredCount} expired agent record${expiredCount !== 1 ? "s" : ""} from the registry?`}
        confirmText="Delete Expired"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDeleteExpired}
      />
      <ConfirmDialog
        open={confirmAction?.type === "delete-all"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Delete All Agents?"
        description={`Permanently remove all ${registry.length} agent records from the registry? This cannot be undone.`}
        confirmText="Delete All"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDeleteAll}
      />
      <ConfirmDialog
        open={confirmAction?.type === "remove-agent"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="Remove Agent From Remote?"
        description="This will delete the agent binary from the remote machine and terminate the process. This cannot be undone."
        confirmText="Remove"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() =>
          confirmAction?.agentId &&
          void handleRemoveAgent(confirmAction.agentId).catch(() => {
            // selfDestructAgent already surfaces a notification on failure.
          })
        }
      />
    </div>
  );
}

// ── Registry Row ────────────────────────────────────────────────────

function RegistryRow({
  agent,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onDelete,
  onRemoveAgent,
  onDisconnect,
  onKill,
  onRediscoverNetwork,
  onRename,
  onRebuild,
  onStartTunnel,
  isRebuilding,
  activeRelaySessions,
  pendingCommands,
}: {
  agent: RegistryAgent;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onDelete: () => void;
  onRemoveAgent: () => void;
  onDisconnect: () => void;
  onKill: () => void;
  onRediscoverNetwork: () => Promise<void>;
  onRename: (name: string | null) => void;
  onRebuild: () => void;
  onStartTunnel: () => Promise<void>;
  isRebuilding: boolean;
  activeRelaySessions: Set<string>;
  pendingCommands: ReturnType<typeof useRemoteAgentStore.getState>["pendingCommands"];
}) {
  const { config, connection, status, lastSeenAt } = agent;
  const OsIcon = osIcon(config.targetOs);
  const displayName =
    connection?.name || connection?.hostname || config.label || config.agentId.slice(0, 8);

  const running = pendingCommands.filter(
    (c) =>
      c.agentId === config.agentId &&
      (c.status === "running" || c.status === "pending")
  );
  const relaySid = relaySessionIdFromControllerAddress(config.controllerAddress);
  const tunnelState: "active" | "healing" | "idle" =
    status === "online"
      ? "active"
      : relaySid && activeRelaySessions.has(relaySid)
        ? "healing"
        : "idle";

  const [rowRenaming, setRowRenaming] = useState(false);
  const [rowNameVal, setRowNameVal] = useState("");

  const commitRowRename = useCallback(() => {
    onRename(rowNameVal.trim() || null);
    setRowRenaming(false);
  }, [rowNameVal, onRename]);

  return (
    <div
      className={cn(
        "ui-data-row border-b border-border/20 transition-smooth",
        isSelected && "bg-primary/[0.04]",
        isExpanded && "bg-accent/30"
      )}
    >
      {/* Main row */}
      <div
        className="grid grid-cols-[32px_1fr_100px_140px_120px_100px_40px] gap-2 items-center px-3 py-2.5 hover:bg-accent/50 transition-smooth cursor-pointer"
        onClick={onToggleExpand}
      >
        {/* Checkbox */}
        <span className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={isSelected}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onChange={() => onToggleSelect()}
            className="rounded border-border/40 h-3.5 w-3.5 accent-primary"
          />
        </span>

        {/* Name + status dot */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              status === "online" && "bg-success shadow-[0_0_6px_hsl(var(--success)/0.3)]",
              status === "offline" && "bg-muted-foreground/30",
              status === "expired" && "bg-destructive/50"
            )}
          />
          <div className="min-w-0 flex items-center gap-1 group/name">
            {rowRenaming ? (
              <Input
                value={rowNameVal}
                onChange={(e) => setRowNameVal(e.target.value)}
                placeholder={connection?.hostname || config.agentId.slice(0, 8)}
                className="h-5 w-32 text-xs font-medium px-1.5"
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRowRename();
                  if (e.key === "Escape") setRowRenaming(false);
                }}
                onBlur={commitRowRename}
              />
            ) : (
              <>
                <span className="text-xs font-medium truncate block">{displayName}</span>
                {connection && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRowNameVal(connection.name || "");
                      setRowRenaming(true);
                    }}
                    className="h-4 w-4 rounded flex items-center justify-center opacity-0 group-hover/name:opacity-100 hover:bg-foreground/10 transition-smooth shrink-0"
                  >
                    <Edit className="h-2.5 w-2.5 text-muted-foreground/60" />
                  </button>
                )}
              </>
            )}
            {!agent.managed && (
              <Badge variant="outline" className="h-4 px-1 text-3xs text-warning border-warning/35 bg-warning/10">
                discovered
              </Badge>
            )}
            <Badge variant="outline" className="h-4 px-1 text-3xs border-border/35 bg-background/40">
              {experienceLabel(config.experience)}
            </Badge>
            {!rowRenaming && running.length > 0 && (
              <div className="flex items-center gap-1 mt-0.5">
                <Spinner className="h-2.5 w-2.5 text-primary" />
                <span className="text-3xs text-primary truncate">
                  {running.length} command{running.length > 1 ? "s" : ""} running
                </span>
              </div>
            )}
            <div className="mt-0.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-3xs border",
                  tunnelState === "active" && "border-success/30 bg-success/10 text-success",
                  tunnelState === "healing" && "border-warning/30 bg-warning/10 text-warning",
                  tunnelState === "idle" && "border-border/30 bg-muted/20 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "inline-block w-1.5 h-1.5 rounded-full",
                    tunnelState === "active" && "bg-success",
                    tunnelState === "healing" && "bg-warning animate-live-breathe motion-reduce:animate-none",
                    tunnelState === "idle" && "bg-muted-foreground/60",
                  )}
                />
                {tunnelState === "active" && "Tunnel Active"}
                {tunnelState === "healing" && "Tunnel Healing"}
                {tunnelState === "idle" && "Tunnel Idle"}
              </span>
            </div>
          </div>
        </div>

        {/* Platform */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="inline-flex items-center gap-1 rounded-md border border-border/35 bg-background/25 px-1.5 py-0.5">
            <OsIcon className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            <span className="text-2xs text-muted-foreground truncate">
              {config.targetOs}
            </span>
          </span>
        </div>

        {/* Address */}
        <span className="text-xs text-muted-foreground font-mono truncate">
          {config.controllerAddress.includes("/session/") ? "Secure relay" : config.controllerAddress}
        </span>

        {/* Created */}
        <TooltipWrapper content={
          (config.rebuiltCount ?? 0) > 0
            ? `Created ${new Date(config.createdAt || config.generatedAt).toLocaleString()} · Rebuilt ${config.rebuiltCount}×`
            : undefined
        }>
        <span className="text-xs text-muted-foreground tabular-nums">
          {relativeTime(config.createdAt || config.generatedAt)}
          {(config.rebuiltCount ?? 0) > 0 && (
            <span className="text-muted-foreground/60 ml-0.5">·{config.rebuiltCount}×</span>
          )}
        </span>
        </TooltipWrapper>

        {/* Status */}
        <Badge
          variant="secondary"
          className={cn(
            "text-3xs px-1.5 py-0 h-4 font-medium justify-center w-fit",
            status === "online" && "text-success bg-success/10",
            status === "offline" && "text-muted-foreground bg-muted/20",
            status === "expired" && "text-destructive bg-destructive/10 line-through"
          )}
        >
          {status === "online"
            ? `Online${connection?.latency_ms != null ? ` · ${connection.latency_ms.toFixed(0)}ms` : ""}`
            : status === "expired"
              ? "Expired"
              : lastSeenAt
                ? `Last ${relativeTime(lastSeenAt)}`
                : "Never connected"}
        </Badge>

        {/* Expand */}
        <span className="flex items-center justify-center">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
          )}
        </span>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <ExpandedDetail
          agent={agent}
          onDelete={onDelete}
          onRemoveAgent={onRemoveAgent}
          onDisconnect={onDisconnect}
          onKill={onKill}
          onRediscoverNetwork={onRediscoverNetwork}
          onRename={onRename}
          onRebuild={onRebuild}
          onStartTunnel={onStartTunnel}
          isRebuilding={isRebuilding}
          tunnelState={tunnelState}
        />
      )}
    </div>
  );
}

// ── Expanded Detail ─────────────────────────────────────────────────

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function formatMemory(mb: number): string {
  if (mb === 0) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function ExpandedDetail({
  agent,
  onDelete,
  onRemoveAgent,
  onDisconnect,
  onKill,
  onRediscoverNetwork,
  onRename,
  onRebuild,
  onStartTunnel,
  isRebuilding,
  tunnelState,
}: {
  agent: RegistryAgent;
  onDelete: () => void;
  onRemoveAgent: () => void;
  onDisconnect: () => void;
  onKill: () => void;
  onRediscoverNetwork: () => Promise<void>;
  onRename: (name: string | null) => void;
  onRebuild: () => void;
  onStartTunnel: () => Promise<void>;
  isRebuilding: boolean;
  tunnelState: "active" | "healing" | "idle";
}) {
  const { config, connection, status, lastSeenAt } = agent;
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(connection?.name || "");
  const [rediscovering, setRediscovering] = useState(false);
  const [startingTunnel, setStartingTunnel] = useState(false);

  return (
    <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]">
      <div className="rounded-lg bg-muted/10 border border-border/20 p-4">
        {connection ? (
          <>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="rounded-md border border-success/20 bg-success/10 px-2.5 py-1.5">
              <div className="text-2xs text-muted-foreground/70">Status</div>
              <div className="text-xs font-medium text-success">Online</div>
            </div>
            <div className="rounded-md border border-border/30 bg-muted/10 px-2.5 py-1.5">
              <div className="text-2xs text-muted-foreground/70">Latency</div>
              <div className="text-xs font-medium tabular-nums">
                {connection.latency_ms != null ? `${connection.latency_ms.toFixed(0)}ms` : "—"}
              </div>
            </div>
            <div className="rounded-md border border-border/30 bg-muted/10 px-2.5 py-1.5">
              <div className="text-2xs text-muted-foreground/70">Uptime</div>
              <div className="text-xs font-medium tabular-nums">
                {connection.uptime_secs > 0 ? formatUptime(connection.uptime_secs) : "—"}
              </div>
            </div>
            <div className="rounded-md border border-border/30 bg-muted/10 px-2.5 py-1.5">
              <div className="text-2xs text-muted-foreground/70">Local IP</div>
              <div className="text-xs font-medium font-mono truncate">
                {connection.ip || "—"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-x-6 gap-y-2.5">
            {/* Column 1: Identity & Config */}
            <div className="space-y-2">
              <SectionLabel>Identity</SectionLabel>
              <DetailRow label="Name">
                {editingName ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      placeholder={connection.hostname}
                      className="h-5 w-28 text-xs font-medium px-1.5"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRename(nameValue.trim() || null);
                          setEditingName(false);
                        }
                        if (e.key === "Escape") setEditingName(false);
                      }}
                      onBlur={() => {
                        onRename(nameValue.trim() || null);
                        setEditingName(false);
                      }}
                    />
                  </div>
                ) : (
                  <button
                    className="flex items-center gap-1 group/edit hover:text-foreground transition-smooth"
                    onClick={() => {
                      setNameValue(connection.name || "");
                      setEditingName(true);
                    }}
                  >
                    <span className="text-xs">
                      {connection.name || connection.hostname}
                    </span>
                    <Edit className="h-2.5 w-2.5 text-muted-foreground/0 group-hover/edit:text-muted-foreground/60 transition-smooth" />
                  </button>
                )}
              </DetailRow>
              <DetailRow label="Hostname">
                <span className="text-xs font-mono">{connection.hostname}</span>
              </DetailRow>
              <DetailRow label="Agent ID">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono text-muted-foreground/60 truncate max-w-[140px]">
                    {config.agentId}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(config.agentId)}
                    className="h-4 w-4 rounded flex items-center justify-center hover:bg-foreground/10 transition-smooth shrink-0"
                  >
                    <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
                  </button>
                </div>
              </DetailRow>
              <DetailRow label="Platform">
                <span className="text-xs">{config.targetOs}</span>
              </DetailRow>
              <DetailRow label="Experience">
                <span className="text-xs">{experienceLabel(config.experience)}</span>
              </DetailRow>
              <DetailRow label="Controller">
                <span className="text-xs font-mono">
                  {config.controllerAddress.includes("/session/") ? "Secure relay" : config.controllerAddress}
                </span>
              </DetailRow>
              <DetailRow label="Tunnel">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-3xs border",
                    tunnelState === "active" && "border-success/30 bg-success/10 text-success",
                    tunnelState === "healing" && "border-warning/30 bg-warning/10 text-warning",
                    tunnelState === "idle" && "border-border/30 bg-muted/20 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block w-1.5 h-1.5 rounded-full",
                      tunnelState === "active" && "bg-success",
                      tunnelState === "healing" && "bg-warning animate-live-breathe motion-reduce:animate-none",
                      tunnelState === "idle" && "bg-muted-foreground/60",
                    )}
                  />
                  {tunnelState === "active" && "Active"}
                  {tunnelState === "healing" && "Healing"}
                  {tunnelState === "idle" && "Idle"}
                </span>
              </DetailRow>
              <DetailRow label="Created">
                <span className="text-xs">
                  {new Date(config.createdAt || config.generatedAt).toLocaleString()}
                </span>
              </DetailRow>
              {(config.rebuiltCount ?? 0) > 0 && (
                <DetailRow label="Last Built">
                  <span className="text-xs">
                    {new Date(config.generatedAt).toLocaleString()}
                    <span className="text-muted-foreground/60 ml-1">
                      (rebuilt {config.rebuiltCount}×)
                    </span>
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Auth Token">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono text-muted-foreground/60">
                    {config.authToken.slice(0, 12)}...
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(config.authToken)}
                    className="h-4 w-4 rounded flex items-center justify-center hover:bg-foreground/10 transition-smooth shrink-0"
                  >
                    <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
                  </button>
                </div>
              </DetailRow>
            </div>

            {/* Column 2: System */}
            <div className="space-y-2">
              <SectionLabel>System</SectionLabel>
              <DetailRow label="OS">
                <span className="text-xs">
                  {connection.os_version || connection.os}
                </span>
              </DetailRow>
              {connection.kernel && (
                <DetailRow label="Kernel">
                  <span className="text-xs font-mono">{connection.kernel}</span>
                </DetailRow>
              )}
              {connection.arch && (
                <DetailRow label="Arch">
                  <span className="text-xs font-mono">{connection.arch}</span>
                </DetailRow>
              )}
              {connection.cpus > 0 && (
                <DetailRow label="CPUs">
                  <span className="text-xs font-mono tabular-nums">{connection.cpus}</span>
                </DetailRow>
              )}
              {connection.memory_mb > 0 && (
                <DetailRow label="Memory">
                  <span className="text-xs font-mono tabular-nums">
                    {formatMemory(connection.memory_mb)}
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Uptime">
                <span className="text-xs font-mono tabular-nums">
                  {connection.uptime_secs > 0 ? formatUptime(connection.uptime_secs) : "—"}
                </span>
              </DetailRow>
              <DetailRow label="Latency">
                <span className="text-xs font-mono tabular-nums">
                  {connection.latency_ms != null
                    ? `${connection.latency_ms.toFixed(0)}ms`
                    : "—"}
                </span>
              </DetailRow>
              <DetailRow label="Profile">
                <span className="text-xs">{connection.profile || "—"}</span>
              </DetailRow>

            </div>

            {/* Column 3: Network */}
            <div className="space-y-2">
              <SectionLabel>Network</SectionLabel>
              <DetailRow label="Local IP">
                <span className="text-xs font-mono">{connection.ip}</span>
              </DetailRow>
              {connection.public_ip && (
                <DetailRow label="Public IP">
                  <div className="flex items-center gap-1">
                    <Globe className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    <span className="text-xs font-mono">{connection.public_ip}</span>
                  </div>
                </DetailRow>
              )}
              {connection.gateway && (
                <DetailRow label="Gateway">
                  <span className="text-xs font-mono">{connection.gateway}</span>
                </DetailRow>
              )}

              {connection.interfaces.length > 0 && (
                <>
                  <SectionLabel>Interfaces</SectionLabel>
                  <div className="space-y-0.5">
                    {connection.interfaces
                      .filter((iface) => iface.ip)
                      .map((iface, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground/60 w-14 truncate shrink-0">
                            {iface.name}
                          </span>
                          <span className="font-mono text-muted-foreground truncate">
                            {iface.ip}
                          </span>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border/20">
            <ToolAccessPanel capabilities={connection.capabilities} />
          </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
            {/* Offline: Config only */}
            <div className="space-y-2">
              <SectionLabel>Configuration</SectionLabel>
              <DetailRow label="Agent ID">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono text-muted-foreground/60 truncate max-w-[200px]">
                    {config.agentId}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(config.agentId)}
                    className="h-4 w-4 rounded flex items-center justify-center hover:bg-foreground/10 transition-smooth shrink-0"
                  >
                    <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
                  </button>
                </div>
              </DetailRow>
              <DetailRow label="Platform">
                <span className="text-xs">{config.targetOs}</span>
              </DetailRow>
              <DetailRow label="Experience">
                <span className="text-xs">{experienceLabel(config.experience)}</span>
              </DetailRow>
              <DetailRow label="Controller">
                <span className="text-xs font-mono">
                  {config.controllerAddress.includes("/session/") ? "Secure relay" : config.controllerAddress}
                </span>
              </DetailRow>
              <DetailRow label="Tunnel">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-3xs border",
                    tunnelState === "active" && "border-success/30 bg-success/10 text-success",
                    tunnelState === "healing" && "border-warning/30 bg-warning/10 text-warning",
                    tunnelState === "idle" && "border-border/30 bg-muted/20 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block w-1.5 h-1.5 rounded-full",
                      tunnelState === "active" && "bg-success",
                      tunnelState === "healing" && "bg-warning animate-live-breathe motion-reduce:animate-none",
                      tunnelState === "idle" && "bg-muted-foreground/60",
                    )}
                  />
                  {tunnelState === "active" && "Active"}
                  {tunnelState === "healing" && "Healing"}
                  {tunnelState === "idle" && "Idle"}
                </span>
              </DetailRow>
              <DetailRow label="Created">
                <span className="text-xs">
                  {new Date(config.createdAt || config.generatedAt).toLocaleString()}
                </span>
              </DetailRow>
              {(config.rebuiltCount ?? 0) > 0 && (
                <DetailRow label="Last Built">
                  <span className="text-xs">
                    {new Date(config.generatedAt).toLocaleString()}
                    <span className="text-muted-foreground/60 ml-1">
                      (rebuilt {config.rebuiltCount}×)
                    </span>
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Auth Token">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono text-muted-foreground/60">
                    {config.authToken.slice(0, 12)}...
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(config.authToken)}
                    className="h-4 w-4 rounded flex items-center justify-center hover:bg-foreground/10 transition-smooth shrink-0"
                  >
                    <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
                  </button>
                </div>
              </DetailRow>
            </div>
            <div className="space-y-2">
              <SectionLabel>Connection</SectionLabel>
              {lastSeenAt && status !== "expired" && (
                <DetailRow label="Last Seen">
                  <span className="text-xs">
                    {new Date(lastSeenAt).toLocaleString()}{" "}
                    <span className="text-muted-foreground/60">
                      ({relativeTime(lastSeenAt)})
                    </span>
                  </span>
                </DetailRow>
              )}
              <div className="text-xs text-muted-foreground/60 italic">
                {status === "expired"
                  ? "This agent has expired and cannot reconnect."
                  : lastSeenAt
                    ? "This agent is currently offline."
                    : "This agent is offline or has not sent a heartbeat yet."}
              </div>
            </div>
          </div>
        )}

        {/* Agent chat */}
        <div className="mt-3 pt-3 border-t border-border/20">
          <SectionLabel>Chat</SectionLabel>
          <div className="mt-2 h-[320px] min-h-[320px]">
            <RemoteChatPanel
              compact
              active
              agentId={config.agentId}
            />
          </div>
        </div>

        {/* Notes */}
        <div className="mt-3 pt-3 border-t border-border/20">
          <InlineNoteWidget
            context={createAgentContext(config.agentId, connection?.name || connection?.hostname || config.agentId.slice(0, 8))}
            maxVisible={3}
            collapsible
            defaultCollapsed={false}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border/20">
          {connection && status === "online" && (
            <>
              <Button
                size="xs"
                variant="neutral"
                className="text-xs gap-1"
                onClick={onDisconnect}
              >
                <X className="h-3 w-3" /> Disconnect
              </Button>
              <Button
                size="xs"
                variant="neutral"
                className="text-xs gap-1 border-warning/30 text-warning hover:bg-warning/10"
                onClick={onKill}
              >
                <Power className="h-3 w-3" /> Kill Process
              </Button>
              <TooltipWrapper
                title="Rediscover Agent Network"
                description="Request this agent to immediately refresh and report current network interfaces and addresses."
                side="top"
              >
                <span className="inline-flex">
                  <Button
                    size="xs"
                    variant="neutral"
                    className="text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={async () => {
                      if (rediscovering) return;
                      setRediscovering(true);
                      try {
                        await onRediscoverNetwork();
                      } finally {
                        setRediscovering(false);
                      }
                    }}
                    disabled={rediscovering}
                  >
                    <RefreshCw className={cn("h-3 w-3", rediscovering && "animate-spin")} />
                    {rediscovering ? "Refreshing…" : "Rediscover Network"}
                  </Button>
                </span>
              </TooltipWrapper>
              <Button
                size="xs"
                variant="destructive"
                className="text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={onRemoveAgent}
              >
                <Trash className="h-3 w-3" /> Remove from Remote
              </Button>
            </>
          )}
          {status !== "online" && (
            <>
              <Button
                size="xs"
                variant="neutral"
                className="text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                onClick={async () => {
                  if (startingTunnel) return;
                  setStartingTunnel(true);
                  try {
                    await onStartTunnel();
                  } finally {
                    setStartingTunnel(false);
                  }
                }}
                disabled={startingTunnel}
              >
                {startingTunnel ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <Globe className="h-3 w-3" />
                )}
                {startingTunnel ? "Starting Tunnel…" : "Start Tunnel"}
              </Button>
              <Button
                size="xs"
                variant="neutral"
                className="text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                onClick={onRebuild}
                disabled={isRebuilding}
              >
                {isRebuilding ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {isRebuilding ? "Rebuilding…" : "Rebuild Agent"}
              </Button>
              <Button
                size="xs"
                variant="destructive"
                className="text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={onRemoveAgent}
              >
                <Trash className="h-3 w-3" /> Remove from Remote
              </Button>
            </>
          )}
          <div className="flex-1" />
          <Button
            size="xs"
            variant="destructive"
            className="text-xs gap-1 ml-auto"
            onClick={onDelete}
          >
            <Trash className="h-3 w-3" /> Delete Record
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToolAccessPanel({ capabilities }: { capabilities: string[] }) {
  const capSet = useMemo(() => new Set(capabilities), [capabilities]);
  const known = CAPABILITY_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  const unknown = capabilities.filter((c) => !known.includes(c));
  const totalKnown = CAPABILITY_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
  const enabledKnown = CAPABILITY_GROUPS.reduce(
    (sum, g) => sum + g.items.filter((i) => capSet.has(i.id)).length,
    0,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>Tool Access</SectionLabel>
        <Badge variant="secondary" className="text-2xs h-5 px-2 tabular-nums">
          {enabledKnown}/{totalKnown} enabled
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {CAPABILITY_GROUPS.map((group) => (
          <div key={group.title} className="rounded-lg border border-border/30 bg-muted/10 p-2">
            <div className="text-2xs text-muted-foreground/70 mb-1">{group.title}</div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const enabled = capSet.has(item.id);
                return (
                  <div key={item.id} className="flex items-center gap-1.5 text-xs">
                    <span className={cn(
                      "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border shrink-0",
                      enabled
                        ? "border-success/40 bg-success/15 text-success"
                        : "border-border/40 bg-muted/20 text-muted-foreground/60"
                    )}>
                      {enabled ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                    </span>
                    <span className={cn(enabled ? "text-foreground/90" : "text-muted-foreground/60")}>
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {unknown.length > 0 && (
        <div className="rounded-lg border border-border/30 bg-muted/10 p-2">
          <div className="text-2xs text-muted-foreground/70 mb-1">Other capabilities reported by agent</div>
          <div className="flex flex-wrap gap-1">
            {unknown.map((cap) => (
              <span
                key={cap}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono bg-muted/20 text-muted-foreground/75"
              >
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-label-sm">
      {children}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="section-label-sm w-20 shrink-0">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
