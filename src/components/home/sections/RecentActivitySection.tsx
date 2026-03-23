import { useEffect, useMemo, useState } from "react";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useErrorStore } from "@/stores/errorStore";
import { useSipDiscoveryStore } from "@/stores/sipDiscoveryStore";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useActivityMonitorStore } from "@/stores/activityMonitorStore";
import { useHomeStore } from "@/stores/homeStore";
import { useLayoutStore } from "@/stores/layoutStore";
import type { NotificationNavigation, NotificationSource } from "@/stores/notificationStore";
import type { ForensicsTimelineEntry } from "@/types/forensics";
import {
  Activity,
  Check,
  ChevronDown,
  Shield,
  PhoneCall,
  Printer,
  Server,
  Search,
  Zap,
  XCircle,
  AlertTriangle,
  Bell,
  Eye,
  Scan,
  Network,
  Trash2,
  Globe,
} from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { navigateTo } from "@/lib/navigation";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────

type ActivityCategory =
  | "registration" | "call" | "call_quality" | "fax" | "network"
  | "agent" | "capture" | "notification" | "discovery" | "error";

interface UnifiedActivityItem {
  id: string;
  ts: number;
  category: ActivityCategory;
  icon: typeof Activity;
  iconColor: string;
  label: string;
  detail?: string;
  success?: boolean;
  badge?: { text: string; color: string };
  source?: NotificationSource;
  notificationNavigation?: NotificationNavigation;
  packetCaptureSessionId?: string;
  isOngoing?: boolean;
}

const QUALITY_COLORS: Record<string, string> = {
  good: "bg-success/15 text-success",
  fair: "bg-warning/15 text-warning",
  poor: "bg-destructive/15 text-destructive",
  unknown: "bg-muted/15 text-muted-foreground/60",
};

// ── Helpers ──────────────────────────────────────────────────────

function formatMemoryMegabytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return "n/a";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

// ── Hook ─────────────────────────────────────────────────────────

function useUnifiedActivity(limit: number): UnifiedActivityItem[] {
  const timeline = useTroubleshootingStore((s) => s.timeline);
  const agentLog = useRemoteAgentStore((s) => s.activityLog);
  const notifications = useNotificationStore((s) => s.notifications);
  const captureSessions = usePacketCaptureStore((s) => s.sessions);
  const errors = useErrorStore((s) => s.errors);
  const sipHistory = useSipDiscoveryStore((s) => s.history);
  const netDevHistory = useNetworkDevicesStore((s) => s.history);

  return useMemo(() => {
    const items: UnifiedActivityItem[] = [];

    for (const e of timeline) {
      const iconMap: Record<ForensicsTimelineEntry["kind"], typeof Activity> = {
        registration: Server,
        call: PhoneCall,
        call_quality: Activity,
        fax_sent: Printer,
        fax_received: Printer,
        network_test: Network,
      };
      const colorMap: Record<ForensicsTimelineEntry["kind"], string> = {
        registration: "text-primary/70",
        call: "text-success/70",
        call_quality: "text-warning/70",
        fax_sent: "text-primary/70",
        fax_received: "text-primary/70",
        network_test: "text-sky-500/80",
      };
      const cat: ActivityCategory =
        e.kind === "fax_sent" || e.kind === "fax_received"
          ? "fax"
          : e.kind === "network_test"
            ? "network"
            : e.kind;
      items.push({
        id: `tl-${e.id}`,
        ts: new Date(e.timestamp).getTime(),
        category: cat,
        icon: iconMap[e.kind],
        iconColor: colorMap[e.kind],
        label: e.label,
        detail: e.detail,
        success: e.success,
        badge: e.qualityTier ? { text: e.qualityTier, color: QUALITY_COLORS[e.qualityTier] ?? "bg-muted/15 text-muted-foreground/60" } : undefined,
      });
    }

    const agentIconMap: Record<string, typeof Activity> = {
      connected: Server, disconnected: Server, reconnected: Server,
      command_sent: Zap, command_result: Zap, command_error: XCircle,
      auth_success: Shield, auth_failed: Shield,
      generated: Server, killed: XCircle, self_destructed: XCircle,
      heartbeat_timeout: AlertTriangle, permission_error: AlertTriangle,
      agent_expired: AlertTriangle, relay_waiting: Globe, relay_error: XCircle,
    };
    const agentColorMap: Record<string, string> = {
      connected: "text-success/70", disconnected: "text-muted-foreground/50",
      reconnected: "text-success/70",
      command_sent: "text-primary/70", command_result: "text-success/70",
      command_error: "text-destructive/70",
      auth_success: "text-success/70", auth_failed: "text-destructive/70",
      generated: "text-primary/70", killed: "text-destructive/70",
      self_destructed: "text-destructive/70",
      heartbeat_timeout: "text-warning/70", permission_error: "text-warning/70",
      agent_expired: "text-warning/70", relay_waiting: "text-warning/70",
      relay_error: "text-destructive/70",
    };
    for (const e of agentLog.slice(0, 50)) {
      items.push({
        id: `ag-${e.id}`,
        ts: new Date(e.timestamp).getTime(),
        category: "agent",
        icon: agentIconMap[e.type] ?? Server,
        iconColor: agentColorMap[e.type] ?? "text-muted-foreground/60",
        label: `Agent ${e.type.replace(/_/g, " ")}`,
        detail: e.agentHostname ? `${e.agentHostname} — ${e.message}` : e.message,
        success: ["connected", "reconnected", "auth_success", "command_result"].includes(e.type) ? true :
          ["disconnected", "command_error", "auth_failed", "killed", "self_destructed", "relay_error"].includes(e.type) ? false : undefined,
      });
    }

    for (const n of notifications.slice(0, 30)) {
      // Packet-capture imports are already represented by capture session activity items.
      const isCaptureImportSuccess =
        n.source === "packet-capture" &&
        n.type === "success" &&
        (/import/i.test(n.title) || /imported/i.test(n.description ?? ""));
      if (isCaptureImportSuccess) continue;

      items.push({
        id: `nt-${n.id}`,
        ts: n.timestamp,
        category: "notification",
        icon: Bell,
        iconColor: n.type === "error" ? "text-destructive/70" :
          n.type === "warning" ? "text-warning/70" :
          n.type === "success" ? "text-success/70" : "text-primary/70",
        label: n.title,
        detail: n.description,
        badge: n.source ? { text: n.source.replace(/-/g, " "), color: "bg-muted/15 text-muted-foreground/60" } : undefined,
        source: n.source,
        notificationNavigation: n.navigation,
      });
    }

    for (const s of captureSessions.slice(0, 20)) {
      const normalizedStatus = s.status.toLowerCase();
      const isRunning = normalizedStatus === "running";
      const isError = normalizedStatus === "error";
      const isImported = normalizedStatus === "imported" || s.interface === "imported";
      const baseName = s.name || "Unnamed";
      const displayName = isImported
        ? baseName.replace(/^imported:\s*/i, "") || baseName
        : baseName;
      items.push({
        id: `pc-${s.id}`,
        ts: new Date(s.startTime).getTime(),
        category: "capture",
        icon: Eye,
        iconColor: isRunning ? "text-success/70" :
          isError ? "text-destructive/70" : "text-primary/70",
        label: `Capture: ${displayName}`,
        detail: isRunning
          ? "In progress"
          : isImported
            ? `Imported — ${s.packetCount ?? 0} packets`
            : `${s.status} — ${s.packetCount ?? 0} packets`,
        success: normalizedStatus === "completed" ? true : isError ? false : undefined,
        packetCaptureSessionId: s.id,
      });
    }

    for (const s of sipHistory.slice(0, 10)) {
      items.push({
        id: `sip-${s.id}`,
        ts: new Date(s.timestamp).getTime(),
        category: "discovery",
        icon: Scan,
        iconColor: "text-primary/70",
        label: `SIP scan: ${s.targets}`,
        detail: `${s.devicesFound} device${s.devicesFound === 1 ? "" : "s"} found`,
      });
    }

    for (const s of netDevHistory.slice(0, 10)) {
      items.push({
        id: `nd-${s.id}`,
        ts: new Date(s.timestamp).getTime(),
        category: "discovery",
        icon: Network,
        iconColor: "text-primary/70",
        label: `Network scan: ${s.targets}`,
        detail: `${s.devicesFound} device${s.devicesFound === 1 ? "" : "s"} found`,
      });
    }

    for (const e of errors.slice(0, 15)) {
      items.push({
        id: `er-${e.id}`,
        ts: new Date(e.timestamp).getTime(),
        category: "error",
        icon: AlertTriangle,
        iconColor: "text-destructive/70",
        label: e.message.length > 60 ? e.message.slice(0, 57) + "..." : e.message,
        detail: e.source + (e.count > 1 ? ` (×${e.count})` : ""),
        success: false,
      });
    }

    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, limit);
  }, [timeline, agentLog, notifications, captureSessions, errors, sipHistory, netDevHistory, limit]);
}

// ── Category labels ──────────────────────────────────────────────

const CATEGORY_LABELS: { key: ActivityCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "call", label: "Calls" },
  { key: "registration", label: "Registration" },
  { key: "agent", label: "Agents" },
  { key: "capture", label: "Captures" },
  { key: "notification", label: "Alerts" },
  { key: "discovery", label: "Discovery" },
  { key: "fax", label: "Fax" },
  { key: "error", label: "Errors" },
];

// ── Component ────────────────────────────────────────────────────

export function ActivityMonitorSection({ embedded = false }: { embedded?: boolean }) {
  const [activeTab, setActiveTab] = useState<"monitor" | "events">("events");
  const [filter, setFilter] = useState<ActivityCategory | "all">("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<UnifiedActivityItem | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<number[]>([]);
  const [taskHistory, setTaskHistory] = useState<number[]>([]);
  const storePublishedRows = useActivityMonitorStore((s) => s.items);
  const clearedAt = useHomeStore((s) => s.activityMonitorClearedAt);
  const setClearedAt = useHomeStore((s) => s.setActivityMonitorClearedAt);
  const dismissedActivityMonitorIds = useHomeStore((s) => s.dismissedActivityMonitorIds);
  const dismissActivityMonitorItem = useHomeStore((s) => s.dismissActivityMonitorItem);
  const clearDismissedActivityMonitorItems = useHomeStore((s) => s.clearDismissedActivityMonitorItems);
  const setNotesCenterOpen = useLayoutStore((s) => s.setNotesCenterOpen);
  const allItemsRaw = useUnifiedActivity(100);

  const stopCapture = usePacketCaptureStore((s) => s.stopCapture);
  const endCall = useSoftphoneStore((s) => s.endCall);
  const stopMonitor = useNetworkTestStore((s) => s.stopMonitor);

  const [memoryBytes, setMemoryBytes] = useState<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    let disposed = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const sampleMemory = async () => {
      if (typeof window === "undefined") return;
      const perf = window.performance as Performance & {
        memory?: { usedJSHeapSize?: number };
        measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
      };

      if (typeof perf.memory?.usedJSHeapSize === "number") {
        if (!disposed) setMemoryBytes(perf.memory.usedJSHeapSize);
        return;
      }

      if (typeof perf.measureUserAgentSpecificMemory === "function") {
        try {
          const result = await perf.measureUserAgentSpecificMemory();
          if (!disposed) setMemoryBytes(result.bytes);
        } catch {
          if (!disposed) setMemoryBytes(null);
        }
      } else if (!disposed) {
        setMemoryBytes(null);
      }
    };

    sampleMemory();
    intervalId = setInterval(() => {
      void sampleMemory();
    }, 5000);

    return () => {
      disposed = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);
  const allItems = (clearedAt > 0 ? allItemsRaw.filter((i) => i.ts > clearedAt) : allItemsRaw)
    .filter((i) => !dismissedActivityMonitorIds.includes(i.id));

  const clearTimeline = useTroubleshootingStore((s) => s.clearTimeline);
  const clearAgentLog = useRemoteAgentStore((s) => s.clearActivityLog);
  const clearNotifications = useNotificationStore((s) => s.clearHistory);
  const clearErrors = useErrorStore((s) => s.clear);
  const clearSipHistory = useSipDiscoveryStore((s) => s.clearHistory);
  const clearNetDevHistory = useNetworkDevicesStore((s) => s.clearHistory);

  const handleClearAll = () => {
    clearTimeline();
    clearAgentLog();
    clearNotifications();
    clearErrors();
    clearSipHistory();
    clearNetDevHistory();
    clearDismissedActivityMonitorItems();
    setClearedAt(Date.now());
  };

  const normalizedSearch = filterSearch.trim().toLowerCase();
  const matchesSearch = (item: UnifiedActivityItem) =>
    normalizedSearch.length === 0 ||
    item.label.toLowerCase().includes(normalizedSearch) ||
    (item.detail?.toLowerCase().includes(normalizedSearch) ?? false) ||
    item.category.toLowerCase().includes(normalizedSearch);
  const matchesFilter = (item: UnifiedActivityItem) => filter === "all" || item.category === filter;

  const displayedRecent = allItems
    .filter((item) => matchesFilter(item) && matchesSearch(item))
    .slice(0, 25);
  const liveProcessRows = useMemo(() => storePublishedRows.slice(0, 40), [storePublishedRows]);
  const monitorCaptureCount = liveProcessRows.filter((row) => row.kind === "capture").length;
  const monitorCallCount = liveProcessRows.filter((row) => row.kind === "call").length;
  const monitorFaxCount = liveProcessRows.filter((row) => row.kind === "fax").length;
  const monitorNetworkCount = liveProcessRows.filter((row) => row.kind === "network").length;
  const totalActiveTasks = liveProcessRows.length;
  const estimatedRowMemoryMb = liveProcessRows.reduce((sum, row) => sum + row.memMb, 0);
  const displayMemoryBytes =
    memoryBytes != null && !Number.isNaN(memoryBytes)
      ? memoryBytes
      : estimatedRowMemoryMb > 0
        ? estimatedRowMemoryMb * 1024 * 1024
        : null;
  const displayMemoryText =
    memoryBytes != null && !Number.isNaN(memoryBytes)
      ? formatMemoryMegabytes(memoryBytes)
      : estimatedRowMemoryMb > 0
        ? `~${Math.round(estimatedRowMemoryMb)} MB`
        : "0 MB";
  const displayMemoryLoadPct = useMemo(() => {
    if (displayMemoryBytes == null || Number.isNaN(displayMemoryBytes)) return 0;
    const baseline = 1.5 * 1024 * 1024 * 1024;
    return Math.max(0, Math.min(100, Math.round((displayMemoryBytes / baseline) * 100)));
  }, [displayMemoryBytes]);
  const displayCpuLoadPct = useMemo(() => {
    if (liveProcessRows.length === 0) return 0;
    const avg = liveProcessRows.reduce((sum, row) => sum + row.cpuPct, 0) / liveProcessRows.length;
    return Math.max(0, Math.min(100, Math.round(avg)));
  }, [liveProcessRows]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setCpuHistory((prev) => [...prev.slice(-29), displayCpuLoadPct]);
      setMemoryHistory((prev) => [...prev.slice(-29), displayMemoryLoadPct]);
      setTaskHistory((prev) => [...prev.slice(-29), Math.min(100, totalActiveTasks * 10)]);
    }, 2000);
    return () => window.clearInterval(id);
  }, [displayCpuLoadPct, displayMemoryLoadPct, totalActiveTasks]);
  const hasEventRows = displayedRecent.length > 0;
  const hasSearchQuery = filterSearch.trim().length > 0;
  const hasCategoryFilter = filter !== "all";
  const activeFilterLabel = CATEGORY_LABELS.find((c) => c.key === filter)?.label.toLowerCase();
  const emptyTitle = hasCategoryFilter ? `No ${activeFilterLabel} activity` : "No activity events";
  const emptyDescription = hasSearchQuery
    ? "No activity matches that search yet. Try a shorter term or clear search."
    : hasCategoryFilter
      ? `No ${activeFilterLabel} events yet. New events in this category will appear here.`
      : "Events from tools, scans, alerts, and agents appear here as they happen.";
  const cpuSeries = cpuHistory.length > 0 ? cpuHistory : [displayCpuLoadPct];
  const memorySeries = memoryHistory.length > 0 ? memoryHistory : [displayMemoryLoadPct];
  const taskSeries = taskHistory.length > 0 ? taskHistory : [Math.min(100, totalActiveTasks * 10)];

  const handleOpenProcessRow = (row: (typeof liveProcessRows)[number]) => {
    if (row.kind === "capture") {
      if (row.captureSessionId) {
        navigateTo("packet-capture", "monitor", { packetCaptureSessionId: row.captureSessionId });
        return;
      }
      navigateTo("packet-capture", "monitor");
      return;
    }

    if (row.kind === "call") {
      navigateTo("soft-phone", "phone");
      return;
    }

    if (row.kind === "fax") {
      navigateTo("fax-center", "faxes");
      return;
    }
    if (row.kind === "agent") {
      navigateTo("remote-agent", "activity");
      return;
    }
    if (row.kind === "registration") {
      navigateTo("registration");
      return;
    }

    const key = row.key.toLowerCase();
    if (
      key.includes("dns")
      || key.includes("geoip")
      || key.includes("asn")
      || key.includes("sip-dns")
    ) {
      navigateTo("network", "dns-access");
      return;
    }
    if (
      key.includes("multicast")
      || key.includes("igmp")
      || key.includes("snooping")
    ) {
      navigateTo("network", "multicast");
      return;
    }
    if (
      key.includes("discovery")
      || key.includes("device-scan")
      || key.includes("sip-discovery")
    ) {
      navigateTo("network", "discovery");
      return;
    }

    navigateTo("network", "path-performance");
  };

  return (
    <div
      className={cn(
        "relative h-full overflow-hidden text-foreground",
        embedded
          ? "bg-transparent"
          : "ui-panel-shell rounded-sm border border-border/50 bg-[linear-gradient(180deg,hsl(var(--card)/0.93)_0%,hsl(var(--card)/0.84)_100%)]",
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border/45 bg-black/[0.2] px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-sm border border-border/45 bg-black/25">
              <Activity className="h-3.5 w-3.5 text-primary/75" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-foreground/90">
                Activity Monitor
              </h2>
              <p className="truncate text-[10px] leading-tight text-muted-foreground/65">
                Live tasks + recent events
              </p>
            </div>
            {(liveProcessRows.length > 0 || allItems.length > 0) && (
              <span className="rounded-sm border border-border/55 bg-black/25 px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums text-foreground/70">
                {activeTab === "monitor" ? liveProcessRows.length : allItems.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="ui-control-shell inline-flex h-7 items-center gap-0.5 rounded-sm px-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("events")}
                className={cn(
                  "inline-flex h-5.5 items-center rounded-sm px-2 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors",
                  activeTab === "events"
                    ? "bg-accent/60 text-foreground"
                    : "text-muted-foreground/80 hover:bg-accent/35 hover:text-foreground",
                )}
              >
                Events
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("monitor")}
                className={cn(
                  "inline-flex h-5.5 items-center rounded-sm px-2 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors",
                  activeTab === "monitor"
                    ? "bg-accent/60 text-foreground"
                    : "text-muted-foreground/80 hover:bg-accent/35 hover:text-foreground",
                )}
              >
                Monitor
              </button>
            </div>
            {activeTab === "events" && (
              <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="ui-control-shell inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[10px] font-medium uppercase tracking-[0.11em] text-foreground/85"
                  >
                    {CATEGORY_LABELS.find((c) => c.key === filter)?.label ?? "All"}
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={6} className="ui-panel-shell w-[220px] p-2 rounded-sm">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/45" />
                    <Input
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      placeholder="Search activity..."
                      className="h-8 pl-8 bg-background/60 border-border/50 text-foreground/90 placeholder:text-muted-foreground/45"
                    />
                  </div>
                  <div className="mt-2 max-h-[190px] overflow-y-auto space-y-0.5">
                    {CATEGORY_LABELS.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => {
                          setFilter(c.key as ActivityCategory | "all");
                          setFilterOpen(false);
                        }}
                        className={cn(
                          "w-full h-7 px-2 rounded-sm text-left text-[11px] uppercase tracking-[0.1em] inline-flex items-center justify-between transition-colors",
                          filter === c.key
                            ? "bg-accent/55 text-foreground"
                            : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
                        )}
                      >
                        <span>{c.label}</span>
                        {filter === c.key && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {activeTab === "events" && allItems.length > 0 && (
              <>
                <button
                  type="button"
                  className="ui-control-shell inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground/82 hover:border-destructive/45 hover:bg-destructive/10 hover:text-destructive/90"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 className="h-3 w-3" />
                  Clear
                </button>
                <ConfirmDialog
                  open={confirmOpen}
                  onOpenChange={setConfirmOpen}
                  title="Clear activity feed?"
                  description="This will clear all activity monitor events across the app. This action cannot be undone."
                  confirmText="Clear All"
                  variant="destructive"
                  onConfirm={handleClearAll}
                />
              </>
            )}
          </div>
        </div>

        {activeTab === "monitor" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
            <div className="mb-2 grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.56)_0%,hsl(var(--background)/0.38)_100%)] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <p className="text-[9px] uppercase tracking-[0.11em] text-muted-foreground/72">Captures</p>
                <p className={cn("text-[11px] font-medium tabular-nums", monitorCaptureCount > 0 ? "text-success" : "text-foreground/80")}>
                  {monitorCaptureCount}
                </p>
              </div>
              <div className="rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.56)_0%,hsl(var(--background)/0.38)_100%)] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <p className="text-[9px] uppercase tracking-[0.11em] text-muted-foreground/72">Calls</p>
                <p className={cn("text-[11px] font-medium tabular-nums", monitorCallCount > 0 ? "text-success" : "text-foreground/80")}>
                  {monitorCallCount}
                </p>
              </div>
              <div className="rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.56)_0%,hsl(var(--background)/0.38)_100%)] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <p className="text-[9px] uppercase tracking-[0.11em] text-muted-foreground/72">Fax</p>
                <p className={cn("text-[11px] font-medium tabular-nums", monitorFaxCount > 0 ? "text-warning" : "text-foreground/80")}>
                  {monitorFaxCount}
                </p>
              </div>
              <div className="rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.56)_0%,hsl(var(--background)/0.38)_100%)] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <p className="text-[9px] uppercase tracking-[0.11em] text-muted-foreground/72">Network</p>
                <p className={cn("text-[11px] font-medium tabular-nums", monitorNetworkCount > 0 ? "text-primary" : "text-foreground/80")}>
                  {monitorNetworkCount}
                </p>
              </div>
              <div className="rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.56)_0%,hsl(var(--background)/0.38)_100%)] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <p className="text-[9px] uppercase tracking-[0.11em] text-muted-foreground/72">Memory</p>
                <p className="text-[11px] font-medium tabular-nums text-foreground/80">{displayMemoryText}</p>
                <div className="mt-1 h-1.5 rounded-full bg-background/40">
                  <div
                    className="h-full rounded-full bg-primary/70 transition-[width] shadow-[0_0_8px_rgba(100,166,255,0.45)]"
                    style={{ width: `${displayMemoryLoadPct}%` }}
                  />
                </div>
              </div>
              <div className="rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.56)_0%,hsl(var(--background)/0.38)_100%)] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <p className="text-[9px] uppercase tracking-[0.11em] text-muted-foreground/72">Active Tasks</p>
                <p className={cn("text-[11px] font-medium tabular-nums", totalActiveTasks > 0 ? "text-success" : "text-foreground/80")}>
                  {totalActiveTasks}
                </p>
                <div className="mt-1 h-1.5 rounded-full bg-background/40">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] shadow-[0_0_8px_rgba(96,219,164,0.35)]",
                      displayCpuLoadPct > 75 ? "bg-warning/80" : "bg-success/75",
                    )}
                    style={{ width: `${displayCpuLoadPct}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-1 gap-1.5 xl:grid-cols-3">
              <div className="rounded-md border border-border/45 bg-background/20 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground/72">CPU Usage</p>
                  <span className="text-[10px] font-mono tabular-nums text-foreground/85">{displayCpuLoadPct}%</span>
                </div>
                <div className="h-10 rounded-sm bg-black/20 px-1 py-1">
                  <div className="flex h-full items-end gap-[2px]">
                    {cpuSeries.map((v, idx) => (
                      <span
                        key={`cpu-${idx}`}
                        className="w-full rounded-[1px] bg-success/70"
                        style={{ height: `${Math.max(8, v)}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-border/45 bg-background/20 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground/72">Memory Usage</p>
                  <span className="text-[10px] font-mono tabular-nums text-foreground/85">{displayMemoryLoadPct}%</span>
                </div>
                <div className="h-10 rounded-sm bg-black/20 px-1 py-1">
                  <div className="flex h-full items-end gap-[2px]">
                    {memorySeries.map((v, idx) => (
                      <span
                        key={`mem-${idx}`}
                        className="w-full rounded-[1px] bg-primary/70"
                        style={{ height: `${Math.max(8, v)}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-border/45 bg-background/20 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground/72">Task Load</p>
                  <span className="text-[10px] font-mono tabular-nums text-foreground/85">{totalActiveTasks}</span>
                </div>
                <div className="h-10 rounded-sm bg-black/20 px-1 py-1">
                  <div className="flex h-full items-end gap-[2px]">
                    {taskSeries.map((v, idx) => (
                      <span
                        key={`task-${idx}`}
                        className="w-full rounded-[1px] bg-warning/75"
                        style={{ height: `${Math.max(8, v)}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {liveProcessRows.length > 0 ? (
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(220px,1.6fr)_72px_72px_90px_88px_86px] items-center gap-x-2 rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.78)_0%,hsl(var(--background)/0.70)_100%)] px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground/70 backdrop-blur">
                <span>Process</span>
                <span className="text-right">State</span>
                <span className="text-right">CPU</span>
                <span className="text-right">Memory</span>
                <span className="text-right">Uptime</span>
                <span className="text-right">Control</span>
              </div>
            ) : null}
            <div className={cn("space-y-1", liveProcessRows.length > 0 && "mt-1")}>
              {liveProcessRows.length === 0 ? (
                <div className="rounded-md border border-border/35 bg-background/20 px-2 py-2 text-center text-[10px] text-muted-foreground/72">
                  No active tasks are running right now.
                </div>
              ) : null}
              {liveProcessRows.map((row) => {
                const ItemIcon = row.kind === "capture"
                  ? Eye
                  : row.kind === "call"
                    ? PhoneCall
                    : row.kind === "fax"
                      ? Printer
                      : row.kind === "agent"
                        ? Server
                        : row.kind === "registration"
                          ? Shield
                          : Activity;
                return (
                  <div
                    key={row.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenProcessRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleOpenProcessRow(row);
                      }
                    }}
                    className={cn(
                      "group grid cursor-pointer grid-cols-[minmax(220px,1.6fr)_72px_72px_90px_88px_86px] items-center gap-x-2 rounded-md border px-2 py-1.5 transition-colors focus-visible:outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
                      "border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.36)_0%,hsl(var(--background)/0.24)_100%)] hover:border-border/65",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border",
                          row.state === "running"
                            ? "border-success/45 bg-success/12"
                            : "border-warning/45 bg-warning/12",
                        )}
                      >
                        <ItemIcon className={cn("h-3.5 w-3.5", row.state === "running" ? "text-success/85" : "text-warning/85")} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[11px] leading-tight text-foreground/92">
                          {row.name}
                        </p>
                        {row.detail ? (
                          <p className="truncate text-[10px] text-muted-foreground/75">{row.detail}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <span
                        className={cn(
                          "inline-flex rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]",
                          row.state === "running"
                            ? "border-success/35 bg-success/15 text-success"
                            : "border-warning/35 bg-warning/15 text-warning",
                        )}
                      >
                        {row.state}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[11px] tabular-nums text-foreground/86">{row.cpuPct}%</p>
                      <div className="mt-0.5 ml-auto h-1 w-12 rounded-full bg-background/40">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            row.state === "running" ? "bg-success/75" : "bg-warning/75",
                          )}
                          style={{ width: `${Math.max(6, row.cpuPct)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[11px] tabular-nums text-foreground/86">{row.memMb} MB</p>
                      <div className="mt-0.5 ml-auto h-1 w-14 rounded-full bg-background/40">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.max(8, Math.min(100, Math.round((row.memMb / 320) * 100)))}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right font-mono text-[10px] tabular-nums text-muted-foreground/82">
                      {formatDurationShort(nowTick - row.startedAt)}
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      {row.canStop && row.kind === "capture" && row.captureSessionId ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void stopCapture(row.captureSessionId!);
                          }}
                          className="ui-control-shell inline-flex h-6 items-center rounded-sm border border-warning/45 px-2 text-2xs text-warning hover:bg-warning/15"
                        >
                          Stop
                        </button>
                      ) : null}
                      {row.canStop && row.kind === "call" && row.callId ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void endCall(row.callId!);
                          }}
                          className="ui-control-shell inline-flex h-6 items-center rounded-sm border border-warning/45 px-2 text-2xs text-warning hover:bg-warning/15"
                        >
                          End
                        </button>
                      ) : null}
                      {row.canStop && row.kind === "network" ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void stopMonitor();
                          }}
                          className="ui-control-shell inline-flex h-6 items-center rounded-sm border border-warning/45 px-2 text-2xs text-warning hover:bg-warning/15"
                        >
                          Stop
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenProcessRow(row);
                        }}
                        className="ui-control-shell inline-flex h-6 items-center rounded-sm border border-border/45 px-2 text-2xs text-muted-foreground hover:text-foreground"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            {hasEventRows ? (
              <div className="flex h-full min-h-0 flex-col rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.44)_0%,hsl(var(--background)/0.34)_100%)] p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                    Recent Events
                  </p>
                  <span className="rounded-sm border border-border/40 bg-background/20 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground/72">
                    {displayedRecent.length}
                  </span>
                </div>
                <div className="relative min-h-0 flex-1">
                  <div className="min-h-0 h-full overflow-y-auto pr-1">
                    <div className="space-y-1.5">
                    {displayedRecent.map((item) => {
                    const EventIcon = item.icon;
                    const mosMatch = item.detail?.match(/MOS\s*([0-9]+(?:\.[0-9]+)?)/i);
                    const mosValue = mosMatch?.[1] ?? null;
                    const mosNumeric = mosValue != null ? Number(mosValue) : null;
                    const mosTone =
                      mosNumeric == null || Number.isNaN(mosNumeric)
                        ? null
                        : mosNumeric <= 2
                          ? "destructive"
                          : mosNumeric < 3.6
                            ? "warning"
                            : "success";
                    const eventTone = mosTone === "success" || item.success === true
                      ? {
                        glow: "from-success/12 via-success/6 to-transparent",
                        chip: "border-success/30 bg-success/12 text-success",
                      }
                      : mosTone === "destructive" || item.success === false
                        ? {
                          glow: "from-destructive/12 via-destructive/6 to-transparent",
                          chip: "border-destructive/35 bg-destructive/12 text-destructive",
                        }
                        : mosTone === "warning" || item.badge?.color?.includes("warning")
                          ? {
                            glow: "from-warning/12 via-warning/6 to-transparent",
                            chip: "border-warning/30 bg-warning/12 text-warning",
                          }
                          : {
                            glow: "from-primary/10 via-primary/4 to-transparent",
                            chip: "border-border/40 bg-background/20 text-muted-foreground/78",
                          };
                      return (
                        <div
                          key={`recent-${item.id}`}
                          className="group relative overflow-hidden rounded-md border border-border/35 bg-[linear-gradient(180deg,hsl(var(--card)/0.30)_0%,hsl(var(--background)/0.22)_100%)] px-2 py-1.5 transition-[border-color,background-color] hover:border-border/55 hover:bg-[linear-gradient(180deg,hsl(var(--card)/0.40)_0%,hsl(var(--background)/0.30)_100%)]"
                        >
                          <div className={cn("pointer-events-none absolute inset-y-0 left-0 w-[22%] bg-gradient-to-r", eventTone.glow)} />
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
                              <EventIcon className={cn("h-3.5 w-3.5", item.iconColor)} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[10px] font-medium text-foreground/90">{item.label}</span>
                                <span className={cn("shrink-0 rounded-sm border px-1 py-0.5 text-[8px] uppercase tracking-[0.08em]", eventTone.chip)}>
                                  {item.category.replace(/_/g, " ")}
                                </span>
                                {item.badge && (
                                  <span className={cn("shrink-0 rounded-sm border px-1 py-0.5 text-[8px] uppercase tracking-[0.08em]", item.badge.color)}>
                                    {item.badge.text}
                                  </span>
                                )}
                                {mosValue && (
                                  <span className="shrink-0 rounded-sm border border-primary/30 bg-primary/12 px-1 py-0.5 text-[8px] uppercase tracking-[0.08em] text-primary/90">
                                    MOS {mosValue}
                                  </span>
                                )}
                              </div>
                              {item.detail ? (
                                <p className="mt-0.5 truncate text-[9px] text-muted-foreground/74">
                                  {item.detail}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="shrink-0 rounded-sm border border-border/40 bg-black/20 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground/72">
                                {formatDurationShort(nowTick - item.ts)}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteItem(item)}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-transparent text-muted-foreground/40 opacity-75 transition-colors group-hover:opacity-100 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Delete activity item ${item.label}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-[hsl(var(--card)/0.78)] via-[hsl(var(--card)/0.35)] to-transparent" />
                </div>
              </div>
            ) : (
              <EmptyState
                compact
                variant="inline"
                icon={<Activity />}
                title={emptyTitle}
                description={emptyDescription}
                className="rounded-md border border-border/45 bg-background/20 px-3 text-center"
                action={(
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {(hasSearchQuery || hasCategoryFilter) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-2xs text-muted-foreground/70 hover:text-foreground"
                        onClick={() => {
                          setFilter("all");
                          setFilterSearch("");
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                    <Button
                      variant="neutral"
                      size="sm"
                      className="h-7 text-2xs"
                      onClick={() => navigateTo("packet-capture", "monitor")}
                    >
                      Open packet capture
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-2xs"
                      onClick={() => navigateTo("network", "path-performance")}
                    >
                      Open network tests
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-2xs"
                      onClick={() => setNotesCenterOpen(true)}
                    >
                      Open notes
                    </Button>
                  </div>
                )}
              />
            )}
          </div>
        )}
        <ConfirmDialog
          open={Boolean(pendingDeleteItem)}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteItem(null);
          }}
          title="Delete activity item?"
          description={
            pendingDeleteItem
              ? `Remove "${pendingDeleteItem.label}" from Activity Monitor?`
              : "Remove this item from Activity Monitor?"
          }
          confirmText="Delete"
          variant="destructive"
          onConfirm={() => {
            if (pendingDeleteItem) {
              dismissActivityMonitorItem(pendingDeleteItem.id);
            }
            setPendingDeleteItem(null);
          }}
        />
      </div>
    </div>
  );
}
