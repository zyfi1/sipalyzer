/**
 * CaptureSessionViewer — A full-blown, self-contained packet viewer for a single session.
 * Can be spawned multiple times in CapturesView, each operating independently.
 *
 * Features:
 * - Full WarperPacketList with virtualization
 * - Collapsible details sidebar
 * - Auto-refresh polling for running sessions
 * - Filter bar
 * - Stats summary in header
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import { LiveIndicator, liveRingClass } from "@/components/ui/live-indicator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X,
  FileText,
  PanelRightOpen,
  PanelRightClose,
  RefreshCw,
  Bookmark,
  MaximizeScreen,
  MinimizeScreen,
  Square,
  Download,
  Upload,
  Loader2,
  ExternalLink,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import type { CaptureSession, PacketInfo, CaptureStatistics } from "@/types/packetCapture";
import {
  getFilteredPackets,
  getCaptureStatistics,
  getLiveStatistics,
  type LiveStatsSnapshot,
} from "@/api/packetCapture";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { usePacketAnnotationStore, type PacketAnnotation, type PacketColorId } from "@/stores/packetAnnotationStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useNotifications } from "@/hooks/useNotifications";
import { useOpenCaptureStore } from "@/hooks/useOpenCapture";
import { formatDateTime } from "@/lib/dateTime";
import { navigateTo } from "@/lib/navigation";
import { subscribeSharedPoll } from "@/lib/sharedPollCoordinator";

// Sub-components reused from monitor
import { WiresharkFilterBar } from "./monitor/WiresharkFilterBar";
import { WarperPacketList } from "./monitor/WarperPacketList";
import { PacketDetailsView } from "./monitor/PacketDetailsView";
import { LiveStatsPanel } from "./monitor/LiveStatsPanel";
import { ExportDialog } from "./monitor/ExportDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FindingsPanel } from "./monitor/FindingsPanel";
import { CallFlowTab } from "./monitor/CallFlowTab";
import { PacketDetailsPopout } from "./monitor/PacketDetailsPopout";
import {
  buildFindingDisplayFilter,
  getPrimaryPacketIndex,
} from "@/lib/expertFindingUtils";

function didPacketWindowChange(prev: PacketInfo[], next: PacketInfo[]): boolean {
  if (prev === next) return false;
  if (prev.length !== next.length) return true;
  if (next.length === 0) return false;

  const firstPrev = prev[0];
  const firstNext = next[0];
  const lastPrev = prev[prev.length - 1];
  const lastNext = next[next.length - 1];

  if (!firstPrev || !firstNext || !lastPrev || !lastNext) return true;

  const sameFirst =
    firstPrev.originalIndex === firstNext.originalIndex &&
    firstPrev.timestamp === firstNext.timestamp &&
    firstPrev.size === firstNext.size;
  const sameLast =
    lastPrev.originalIndex === lastNext.originalIndex &&
    lastPrev.timestamp === lastNext.timestamp &&
    lastPrev.size === lastNext.size;

  return !(sameFirst && sameLast);
}

function buildCaptureStatisticsFromPackets(packets: PacketInfo[]): CaptureStatistics | null {
  if (packets.length === 0) return null;

  const packetsByProtocol: Record<string, number> = {};
  const bytesByProtocol: Record<string, number> = {};
  const srcCount = new Map<string, number>();
  const dstCount = new Map<string, number>();
  let totalBytes = 0;
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  for (const packet of packets) {
    const protocol = (packet.protocol || "OTHER").toUpperCase();
    const size = packet.frameLength ?? packet.size ?? 0;
    packetsByProtocol[protocol] = (packetsByProtocol[protocol] ?? 0) + 1;
    bytesByProtocol[protocol] = (bytesByProtocol[protocol] ?? 0) + size;
    totalBytes += size;

    if (packet.srcIp) srcCount.set(packet.srcIp, (srcCount.get(packet.srcIp) ?? 0) + 1);
    if (packet.dstIp) dstCount.set(packet.dstIp, (dstCount.get(packet.dstIp) ?? 0) + 1);

    const ts = Date.parse(packet.timestamp);
    if (!Number.isNaN(ts)) {
      firstTime = firstTime == null ? ts : Math.min(firstTime, ts);
      lastTime = lastTime == null ? ts : Math.max(lastTime, ts);
    }
  }

  const toTopPairs = (m: Map<string, number>): [string, number][] =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);

  const durationSeconds = firstTime != null && lastTime != null && lastTime > firstTime
    ? (lastTime - firstTime) / 1000
    : 0;

  return {
    totalPackets: packets.length,
    totalBytes,
    packetsByProtocol,
    bytesByProtocol,
    topSrcIps: toTopPairs(srcCount),
    topDstIps: toTopPairs(dstCount),
    packetsPerSecond: durationSeconds > 0 ? packets.length / durationSeconds : 0,
    bytesPerSecond: durationSeconds > 0 ? totalBytes / durationSeconds : 0,
    startTime: firstTime != null ? new Date(firstTime).toISOString() : undefined,
    lastPacketTime: lastTime != null ? new Date(lastTime).toISOString() : undefined,
  };
}

interface CaptureSessionViewerProps {
  session: CaptureSession;
  /** Called when the user clicks the X / close button */
  onClose: () => void;
  /** Called when the user clicks Import (optional, adds Import button before Export) */
  onImport?: () => void;
  /** Whether import is in progress (show loading state) */
  importing?: boolean;
  /** If true, expand to fill entire CapturesView area */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Initial filter expression (e.g. when opened from analysis) */
  initialFilter?: string;
  /** Initial details tab for packet details panel */
  initialDetailsTab?: "overview" | "protocol" | "raw";
  /** When true, render without standalone outer shell (for embedded layouts). */
  embedded?: boolean;
}

export const CaptureSessionViewer = memo(function CaptureSessionViewer({
  session,
  onClose,
  onImport,
  importing = false,
  expanded = false,
  onToggleExpand,
  initialFilter,
  initialDetailsTab,
  embedded = false,
}: CaptureSessionViewerProps) {
  const { notify } = useNotifications();
  const showDiagnostics = true;
  const pmSettings = useSettingsStore((s) => s.packetMonitor);
  const stopCapture = usePacketCaptureStore((s) => s.stopCapture);
  const expertFindings = usePacketCaptureStore((s) => s.expertFindings);
  const expertFindingsLoading = usePacketCaptureStore((s) => s.expertFindingsLoading);
  const expertLivePollingActive = usePacketCaptureStore((s) => s.expertLivePollingActive);
  const fetchExpertFindings = usePacketCaptureStore((s) => s.fetchExpertFindings);

  // Packet state
  const [packets, setPackets] = useState<PacketInfo[]>([]);
  const [totalPacketCount, setTotalPacketCount] = useState(0);
  const [selectedPacketIndex, setSelectedPacketIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Filter (single state — WiresharkFilterBar updates on every keystroke)
  const [wiresharkFilter, setWiresharkFilter] = useState(initialFilter ?? "");

  // Stats
  const [liveStats, setLiveStats] = useState<LiveStatsSnapshot | null>(null);
  const [statistics, setStatistics] = useState<CaptureStatistics | null>(null);

  // UI
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(420);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [detailsPopoutOpen, setDetailsPopoutOpen] = useState(false);
  const contentSplitRef = useRef<HTMLDivElement | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"details" | "stats" | "expert">("details");
  const [popoutTab, setPopoutTab] = useState<"details" | "stats" | "expert">("details");
  const [showExport, setShowExport] = useState(false);
  const [autoScroll, setAutoScroll] = useState(session.status === "Running");
  const [contentView, setContentView] = useState<"packets" | "calls" | "rtp">("packets");
  const [showMarkedOnly, setShowMarkedOnly] = useState(false);
  const annotationStore = usePacketAnnotationStore();

  const isRunning = session.status === "Running";
  const panelClass = "packet-graphite-panel overflow-hidden rounded-lg";

  const expertCriticalCount = useMemo(() => expertFindings.filter((f) => f.severity === "critical").length, [expertFindings]);
  const expertWarningCount = useMemo(() => expertFindings.filter((f) => f.severity === "warning").length, [expertFindings]);

  // Selected packet
  const selectedPacket = useMemo(() => {
    if (selectedPacketIndex === null || selectedPacketIndex >= packets.length) return null;
    return packets[selectedPacketIndex] ?? null;
  }, [packets, selectedPacketIndex]);
  const rtpStreamSummaries = useMemo(() => {
    if (contentView !== "rtp") return [];
    type StreamAcc = {
      key: string;
      ssrc: number;
      srcIp: string;
      srcPort: number;
      dstIp: string;
      dstPort: number;
      payloadType: number;
      encrypted: boolean;
      packets: number;
      estimatedLost: number;
      lastSeq?: number;
      lastArrival?: number;
      lastInterArrival?: number;
      jitterTotal: number;
      jitterSamples: number;
    };
    const streams = new Map<string, StreamAcc>();
    const rtcpCounts = new Map<number, number>();

    for (const packet of packets) {
      const app = packet.decoded?.application;
      if (!app) continue;
      if (app.type === "Rtcp") {
        const rtcp = app.data as any;
        if (rtcp?.packets && Array.isArray(rtcp.packets)) {
          for (const part of rtcp.packets) {
            const ssrc = typeof part?.ssrc === "number" ? part.ssrc : null;
            if (ssrc == null) continue;
            rtcpCounts.set(ssrc, (rtcpCounts.get(ssrc) ?? 0) + 1);
          }
        }
        continue;
      }
      if (app.type !== "Rtp" && app.type !== "Srtp") continue;
      const rtp = app.data;
      const key = `${rtp.ssrc}:${packet.srcIp}:${packet.srcPort}->${packet.dstIp}:${packet.dstPort}`;
      let acc = streams.get(key);
      if (!acc) {
        acc = {
          key,
          ssrc: rtp.ssrc,
          srcIp: packet.srcIp,
          srcPort: packet.srcPort,
          dstIp: packet.dstIp,
          dstPort: packet.dstPort,
          payloadType: rtp.payloadType,
          encrypted: app.type === "Srtp" || !!rtp.encrypted,
          packets: 0,
          estimatedLost: 0,
          jitterTotal: 0,
          jitterSamples: 0,
        };
        streams.set(key, acc);
      }

      acc.packets += 1;
      const seq = rtp.sequenceNumber;
      if (typeof acc.lastSeq === "number") {
        const diff = (seq - acc.lastSeq + 65536) % 65536;
        if (diff > 1) {
          acc.estimatedLost += diff - 1;
        }
      }
      acc.lastSeq = seq;

      const arrival = Date.parse(packet.timestamp);
      if (!Number.isNaN(arrival) && typeof acc.lastArrival === "number") {
        const interArrival = arrival - acc.lastArrival;
        if (typeof acc.lastInterArrival === "number") {
          acc.jitterTotal += Math.abs(interArrival - acc.lastInterArrival);
          acc.jitterSamples += 1;
        }
        acc.lastInterArrival = interArrival;
      }
      if (!Number.isNaN(arrival)) {
        acc.lastArrival = arrival;
      }
    }

    return Array.from(streams.values())
      .map((stream) => {
        const expected = stream.packets + stream.estimatedLost;
        const lossPercent = expected > 0 ? (stream.estimatedLost / expected) * 100 : 0;
        const jitterMs = stream.jitterSamples > 0 ? stream.jitterTotal / stream.jitterSamples : 0;
        return {
          ...stream,
          lossPercent,
          jitterMs,
          rtcpPackets: rtcpCounts.get(stream.ssrc) ?? 0,
        };
      })
      .sort((a, b) => b.packets - a.packets);
  }, [packets, contentView]);
  const panelStatistics = useMemo(() => {
    if (statistics) return statistics;
    const statsVisible = sidebarTab === "stats" || (detailsPopoutOpen && popoutTab === "stats");
    if (!statsVisible) return null;
    return buildCaptureStatisticsFromPackets(packets);
  }, [statistics, packets, sidebarTab, detailsPopoutOpen, popoutTab]);
  const annotationSessionId = session.id;
  const annotationsMap = useMemo<Record<number, PacketAnnotation>>(() => {
    const map: Record<number, PacketAnnotation> = {};
    const prefix = `${annotationSessionId}::`;
    for (const [key, annotation] of Object.entries(annotationStore.annotations)) {
      if (!key.startsWith(prefix)) continue;
      const idx = parseInt(key.slice(prefix.length), 10);
      if (Number.isNaN(idx)) continue;
      map[idx] = annotation;
    }
    return map;
  }, [annotationStore.annotations, annotationSessionId]);
  const handleToggleMark = useCallback((index: number) => {
    annotationStore.toggleMark(annotationSessionId, index);
  }, [annotationStore, annotationSessionId]);
  const handleSetColor = useCallback((index: number, colorId: PacketColorId | undefined) => {
    annotationStore.setColor(annotationSessionId, index, colorId);
  }, [annotationStore, annotationSessionId]);
  const handleClearAnnotation = useCallback((index: number) => {
    annotationStore.clearAnnotation(annotationSessionId, index);
  }, [annotationStore, annotationSessionId]);
  const annotatedCount = useMemo(() => annotationStore.getAnnotatedCount(annotationSessionId), [annotationStore, annotationSessionId]);
  const displayPacketRows = useMemo(() => {
    const rows = packets.map((packet, sourceIndex) => ({ packet, sourceIndex }));
    if (!showMarkedOnly) return rows;
    return rows.filter((row) => annotationsMap[row.sourceIndex]?.marked);
  }, [packets, showMarkedOnly, annotationsMap]);
  const displayPackets = useMemo(() => displayPacketRows.map((r) => r.packet), [displayPacketRows]);
  const selectedDisplayIndex = useMemo(() => {
    if (selectedPacketIndex == null) return null;
    if (!showMarkedOnly) return selectedPacketIndex;
    const idx = displayPacketRows.findIndex((row) => row.sourceIndex === selectedPacketIndex);
    return idx >= 0 ? idx : null;
  }, [selectedPacketIndex, showMarkedOnly, displayPacketRows]);
  const displayAnnotations = useMemo<Record<number, PacketAnnotation>>(() => {
    if (!showMarkedOnly) return annotationsMap;
    const map: Record<number, PacketAnnotation> = {};
    displayPacketRows.forEach((row, displayIndex) => {
      const annotation = annotationsMap[row.sourceIndex];
      if (annotation) map[displayIndex] = annotation;
    });
    return map;
  }, [showMarkedOnly, annotationsMap, displayPacketRows]);
  const toSourceIndex = useCallback((displayIndex: number): number | null => {
    if (!showMarkedOnly) return displayIndex;
    const row = displayPacketRows[displayIndex];
    return row ? row.sourceIndex : null;
  }, [showMarkedOnly, displayPacketRows]);

  // Fetch packets
  const fetchPackets = useCallback(async (filter?: string) => {
    try {
      const result = await getFilteredPackets(session.id, {
        filterExpression: filter?.trim() || undefined,
        offset: 0,
        limit: pmSettings.pageSize,
      });
      setPackets((prev) => (didPacketWindowChange(prev, result.packets) ? result.packets : prev));
      setTotalPacketCount((prev) => (prev === result.totalCount ? prev : result.totalCount));
    } catch (e: any) {
      console.error(`[CaptureSessionViewer ${session.id}] Failed to fetch packets:`, e);
    }
  }, [session.id, pmSettings.pageSize]);

  useEffect(() => {
    const next = initialFilter ?? "";
    setWiresharkFilter(next);
    setSelectedPacketIndex(null);
    setSidebarTab(showDiagnostics ? "expert" : "details");
    fetchPackets(next);
  }, [initialFilter, fetchPackets, showDiagnostics]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const [stats, lStats] = await Promise.all([
        getCaptureStatistics(session.id).catch(() => null),
        isRunning ? getLiveStatistics(session.id).catch(() => null) : Promise.resolve(null),
      ]);
      setStatistics(stats);
      setLiveStats(lStats);
    } catch {
      // ignore
    }
  }, [session.id, isRunning]);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    fetchStats().finally(() => setIsLoading(false));
    if (showDiagnostics) fetchExpertFindings(session.id);
  }, [session.id, showDiagnostics]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showDiagnostics && sidebarTab === "expert") {
      setSidebarTab("details");
    }
  }, [showDiagnostics, sidebarTab]);
  useEffect(() => {
    if (detailsPopoutOpen) setPopoutTab(sidebarTab);
  }, [detailsPopoutOpen, sidebarTab]);

  useEffect(() => {
    if (!sidebarResizing) return;

    const handlePointerMove = (e: PointerEvent) => {
      const container = contentSplitRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const nextWidth = rect.right - e.clientX;
      const maxWidth = Math.min(760, rect.width - 320);
      const clamped = Math.max(340, Math.min(maxWidth, nextWidth));
      setSidebarWidthPx(clamped);
    };
    const handlePointerUp = () => setSidebarResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [sidebarResizing]);

  // Auto-poll packets for running sessions (deduped across open viewers)
  useEffect(() => {
    if (!isRunning) return;
    const filterExpression = wiresharkFilter.trim() || "";
    return subscribeSharedPoll({
      key: `capture:${session.id}:packets:${pmSettings.pageSize}:${filterExpression}`,
      intervalMs: pmSettings.packetPollIntervalMs,
      fetcher: () => getFilteredPackets(session.id, {
        filterExpression: filterExpression || undefined,
        offset: 0,
        limit: pmSettings.pageSize,
      }),
      onData: (result) => {
        setPackets((prev) => (didPacketWindowChange(prev, result.packets) ? result.packets : prev));
        setTotalPacketCount((prev) => (prev === result.totalCount ? prev : result.totalCount));
      },
      onError: (error) => {
        console.error(`[CaptureSessionViewer ${session.id}] Failed to poll packets:`, error);
      },
    });
  }, [isRunning, session.id, wiresharkFilter, pmSettings.pageSize, pmSettings.packetPollIntervalMs]);

  // Auto-poll stats for running sessions (deduped across open viewers)
  useEffect(() => {
    if (!isRunning) return;
    return subscribeSharedPoll({
      key: `capture:${session.id}:stats`,
      intervalMs: pmSettings.statsPollIntervalMs,
      fetcher: async () => {
        const [stats, lStats] = await Promise.all([
          getCaptureStatistics(session.id).catch(() => null),
          getLiveStatistics(session.id).catch(() => null),
        ]);
        return { stats, lStats };
      },
      onData: ({ stats, lStats }) => {
        setStatistics(stats);
        setLiveStats(lStats);
      },
    });
  }, [isRunning, session.id, pmSettings.statsPollIntervalMs]);

  // Handle filter change — debounce backend calls for large packet sets
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFilterChange = useCallback((filter: string) => {
    setWiresharkFilter(filter);
    // Always update state immediately (keeps input responsive)
    // Debounce the expensive backend fetch
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    if (!isRunning) {
      filterDebounceRef.current = setTimeout(() => {
        fetchPackets(filter);
      }, 250);
    }
  }, [isRunning, fetchPackets]);
  // Handle packet selection
  const handleSelectPacket = useCallback((index: number) => {
    const sourceIndex = toSourceIndex(index);
    if (sourceIndex == null || sourceIndex < 0) return;
    setSelectedPacketIndex(sourceIndex);
    if (!sidebarOpen) {
      setSidebarOpen(true);
      setSidebarTab("details");
    }
  }, [sidebarOpen, toSourceIndex]);

  // Stop running capture
  const handleStop = useCallback(async () => {
    try {
      await stopCapture(session.id);
      // Final fetch after stopping
      await fetchPackets(wiresharkFilter);
      await fetchStats();
    } catch (e: any) {
      console.error("Failed to stop capture:", e);
    }
  }, [session.id, stopCapture, wiresharkFilter, fetchPackets, fetchStats]);

  // Refresh packets
  const handleRefresh = useCallback(() => {
    fetchPackets(wiresharkFilter);
    fetchStats();
  }, [wiresharkFilter, fetchPackets, fetchStats]);

  const loadExactEvidencePacket = useCallback((packetIndex: number) => {
    if (packetIndex < 0) return;
    const packetFilter = `frame.number == ${packetIndex + 1}`;
    useOpenCaptureStore.getState().openViewer(session.id, undefined, { filter: packetFilter });
    navigateTo("packet-capture", "viewer");
    notify({
      source: "packet-capture",
      type: "info",
      title: "Opened Packet Viewer",
      description: `Opening related evidence for packet #${packetIndex + 1}.`,
    });
  }, [session.id, notify]);

  return (
    <div
      className={cn(
        embedded
          ? "flex h-full min-h-0 flex-col overflow-hidden"
          : "packet-graphite-stage flex h-full min-h-0 flex-col overflow-hidden rounded-lg",
        expanded ? "flex-1" : "h-[500px]",
      )}
    >
      <div className="flex-1 min-h-0 p-1.5">
        <div className={cn(panelClass, "h-full min-h-0 flex flex-col", isRunning && liveRingClass)}>
          {/* ── Primary row: session context + filter ── */}
          <div className="ui-section-header-md flex shrink-0 items-center gap-2 px-3 pt-2 pb-1.5">
            <div className="ui-control-shell inline-flex h-7 min-w-0 max-w-[360px] items-center gap-1.5 px-2 text-xs text-foreground/90">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{session.name}</span>
            </div>
            {isRunning ? (
              <LiveIndicator variant="badge" label="LIVE" size="xs" />
            ) : (
              <span className="text-2xs text-muted-foreground shrink-0">{session.status}</span>
            )}
            <TooltipWrapper entry={tooltips.statInterface}>
              <span className="px-1 text-2xs text-muted-foreground tabular-nums cursor-help shrink-0">
                {session.interface}
              </span>
            </TooltipWrapper>
            <div className="flex-1 min-w-0">
              <WiresharkFilterBar
                filter={wiresharkFilter}
                onFilterChange={handleFilterChange}
                filteredCount={totalPacketCount}
              />
            </div>
          </div>

          {/* ── Secondary row: actions ── */}
          <div className="ui-section-header-sm flex shrink-0 items-center gap-2 px-3 py-1.5">
            <div className="inline-flex items-center gap-1">
              <TooltipWrapper entry={tooltips.captureRefresh}>
                <Button size="sm" variant="neutral" className="gap-1.5 px-2 text-xs" onClick={handleRefresh}>
                  <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                  Refresh
                </Button>
              </TooltipWrapper>
              <Button
                size="sm"
                variant={showMarkedOnly ? "default" : "neutral"}
                className={cn(
                  "gap-1.5 px-2 text-xs",
                  showMarkedOnly
                    ? "bg-warning/15 hover:bg-warning/25 text-warning border border-warning/25"
                    : "",
                )}
                onClick={() => setShowMarkedOnly((v) => !v)}
                disabled={annotatedCount.marked === 0 && !showMarkedOnly}
              >
                <Bookmark className={cn("h-3.5 w-3.5", showMarkedOnly && "fill-current")} />
                Marked
                {annotatedCount.marked > 0 && (
                  <span className={cn(
                    "h-4 min-w-4 px-1 rounded-full text-2xs font-semibold flex items-center justify-center tabular-nums",
                    showMarkedOnly ? "bg-warning/25 text-warning" : "bg-muted/40 border border-border/35 text-muted-foreground",
                  )}>
                    {annotatedCount.marked}
                  </span>
                )}
              </Button>

              {isRunning && (
                <TooltipWrapper entry={tooltips.captureStop}>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    onClick={handleStop}
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                </TooltipWrapper>
              )}

              {onImport && (
                <TooltipWrapper entry={tooltips.captureImportPcap}>
                  <Button
                    size="sm"
                    variant="neutral"
                    className="gap-1.5 px-2 text-xs"
                    onClick={onImport}
                    disabled={importing}
                  >
                    {importing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {importing ? "Importing…" : "Import"}
                  </Button>
                </TooltipWrapper>
              )}

            </div>

            {isRunning && (
              <div className="inline-flex h-7 items-center gap-2 rounded-[var(--radius-md)] border border-border/35 bg-muted/18 px-2 text-xs">
                <LiveIndicator variant="badge" label="LIVE" size="xs" />
                <span className="font-mono tabular-nums text-muted-foreground">
                  {totalPacketCount.toLocaleString()} pkts
                </span>
              </div>
            )}

            {!isRunning && (
              <TooltipWrapper entry={tooltips.statTotalPackets}>
                <span className="text-2xs text-muted-foreground tabular-nums cursor-help">
                  {totalPacketCount.toLocaleString()} pkts
                </span>
              </TooltipWrapper>
            )}

            <div className="ml-auto inline-flex items-center gap-1">
              <TooltipWrapper entry={tooltips.captureExport}>
                <Button
                  size="sm"
                  variant="neutral"
                  className="gap-1.5 px-2 text-xs"
                  onClick={() => setShowExport(true)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </TooltipWrapper>

              <div className="h-4 w-px bg-border/55 mx-0.5" />

              <TooltipWrapper entry={tooltips.captureSidebarToggle(sidebarOpen)}>
                <Button
                  variant="neutral"
                  size="icon-sm"
                  className={cn(sidebarOpen && "text-primary")}
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  {sidebarOpen ? (
                    <PanelRightClose className="h-3.5 w-3.5" />
                  ) : (
                    <PanelRightOpen className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipWrapper>

              <TooltipWrapper content="Open selected packet details in popout">
                <Button
                  size="icon-sm"
                  variant="neutral"
                  className="h-7 w-7"
                  aria-label="Open selected packet details in popout"
                  onClick={() => {
                    setPopoutTab(sidebarTab);
                    setDetailsPopoutOpen(true);
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </TooltipWrapper>

              {onToggleExpand && (
                <Button
                  size="sm"
                  variant="neutral"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  onClick={onToggleExpand}
                >
                  {expanded ? (
                    <>
                      <MinimizeScreen className="h-3.5 w-3.5" />
                      Collapse
                    </>
                  ) : (
                    <>
                      <MaximizeScreen className="h-3.5 w-3.5" />
                      Expand
                    </>
                  )}
                </Button>
              )}

              {!expanded && (
                <TooltipWrapper entry={tooltips.captureClosePreview}>
                  <Button
                    size="sm"
                    variant="neutral"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    onClick={onClose}
                  >
                    <X className="h-3.5 w-3.5" />
                    Close
                  </Button>
                </TooltipWrapper>
              )}
            </div>
          </div>
          {/* ── Main Content ── */}
          <div
            ref={contentSplitRef}
            className={cn("flex-1 flex min-h-0 border-t border-border/35", sidebarResizing && "cursor-col-resize select-none")}
          >
        {contentView === "packets" && (
          <>
            {/* Packet List */}
            <div className={cn(
              "flex min-w-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,hsl(var(--card)/0.54),hsl(var(--card)/0.40))]",
            )}>
              {isLoading && packets.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading packets...
                </div>
              ) : (
                <WarperPacketList
                  packets={displayPackets}
                  selectedIndex={selectedDisplayIndex}
                  onSelect={handleSelectPacket}
                  autoScroll={autoScroll && isRunning}
                  onAutoScrollToggle={() => setAutoScroll((prev) => !prev)}
                  totalCount={showMarkedOnly ? displayPackets.length : totalPacketCount}
                  annotations={displayAnnotations}
                  onToggleMark={(displayIndex) => {
                    const sourceIndex = toSourceIndex(displayIndex);
                    if (sourceIndex == null) return;
                    handleToggleMark(sourceIndex);
                  }}
                  onSetColor={(displayIndex, colorId) => {
                    const sourceIndex = toSourceIndex(displayIndex);
                    if (sourceIndex == null) return;
                    handleSetColor(sourceIndex, colorId);
                  }}
                  onClearAnnotation={(displayIndex) => {
                    const sourceIndex = toSourceIndex(displayIndex);
                    if (sourceIndex == null) return;
                    handleClearAnnotation(sourceIndex);
                  }}
                  onApplyDisplayFilter={(filter) => {
                    setWiresharkFilter(filter);
                    fetchPackets(filter);
                    setContentView("packets");
                  }}
                  onFollowRtpStream={(packet) => {
                    const app = packet.decoded?.application;
                    if (!app || (app.type !== "Rtp" && app.type !== "Srtp")) return;
                    const filter = `rtp.ssrc == ${app.data.ssrc}`;
                    setWiresharkFilter(filter);
                    fetchPackets(filter);
                    setContentView("packets");
                  }}
                  onFollowSipCall={(packet) => {
                    const app = packet.decoded?.application;
                    if (app?.type === "Sip" && app.data.callId) {
                      const filter = `sip.Call-ID == "${app.data.callId}"`;
                      setWiresharkFilter(filter);
                      fetchPackets(filter);
                    } else {
                      setWiresharkFilter("sip");
                      fetchPackets("sip");
                    }
                    setContentView("packets");
                  }}
                  onFollowConversation={(packet) => {
                    const proto = packet.decoded?.tcp || packet.protocol.toUpperCase() === "TCP" ? "tcp" : "udp";
                    const filter =
                      `${proto} && ((ip.src == ${packet.srcIp} && ip.dst == ${packet.dstIp} && ${proto}.srcport == ${packet.srcPort} && ${proto}.dstport == ${packet.dstPort}) || (ip.src == ${packet.dstIp} && ip.dst == ${packet.srcIp} && ${proto}.srcport == ${packet.dstPort} && ${proto}.dstport == ${packet.srcPort}))`;
                    setWiresharkFilter(filter);
                    fetchPackets(filter);
                    setContentView("packets");
                  }}
                  className="flex-1"
                />
              )}
            </div>

            {/* Details Sidebar */}
            {sidebarOpen && (
              <>
                <button
                  type="button"
                  aria-label="Resize packet list and details panel"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setSidebarResizing(true);
                  }}
                  onDoubleClick={() => setSidebarWidthPx(420)}
                  className="group relative w-2 shrink-0 border-x border-border/35 bg-card/30 cursor-col-resize hover:bg-accent/35"
                >
                  <span className="pointer-events-none absolute inset-y-1/2 left-1/2 h-12 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70 group-hover:bg-foreground/70" />
                </button>
                <div
                  className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-transparent"
                  style={{ width: `${sidebarWidthPx}px` }}
                >
                <Tabs
                  value={sidebarTab}
                  onValueChange={(v) => setSidebarTab(v as typeof sidebarTab)}
                  className="flex-1 flex flex-col min-h-0"
                >
                  <div className="ui-section-header-sm flex-none h-10 box-border px-2.5 py-0">
                    <div className="flex h-full items-center gap-2">
                    <TabsList className="monitor-side-tabs !h-7 !min-h-7 flex-1">
                      <TabsTrigger value="details" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                        Details
                      </TabsTrigger>
                      <TabsTrigger value="stats" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                        Stats
                      </TabsTrigger>
                      {showDiagnostics && (
                        <TabsTrigger value="expert" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                          Diagnostics
                          {expertCriticalCount > 0 && (
                            <Badge variant="destructive" className="text-3xs px-1 py-0 h-3.5 min-w-[14px]">
                              {expertCriticalCount}
                            </Badge>
                          )}
                          {expertCriticalCount === 0 && expertWarningCount > 0 && (
                            <Badge variant="secondary" className="text-3xs px-1 py-0 h-3.5 min-w-[14px]">
                              {expertWarningCount}
                            </Badge>
                          )}
                        </TabsTrigger>
                      )}
                    </TabsList>
                    <TooltipWrapper content="Open selected packet details in popout">
                      <Button
                        variant="neutral"
                        size="icon-sm"
                        className="h-7 w-7"
                        aria-label="Open selected packet details in popout"
                        onClick={() => {
                          setPopoutTab(sidebarTab);
                          setDetailsPopoutOpen(true);
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipWrapper>
                    </div>
                  </div>

                  <TabsContent value="details" className="flex-1 m-0 overflow-auto">
                    {selectedPacket ? (
                      <PacketDetailsView
                        packet={selectedPacket}
                        sessionId={session.id}
                        packetIndex={selectedPacket.originalIndex ?? selectedPacketIndex}
                        initialTab={initialDetailsTab}
                      />
                    ) : (
                      <EmptyState compact variant="inline" title="Select a packet to view details" />
                    )}
                  </TabsContent>

                  <TabsContent value="stats" className="flex-1 m-0 overflow-auto">
                    <LiveStatsPanel
                      stats={liveStats}
                      pipelineStats={null}
                      isCapturing={isRunning}
                      historicalStats={panelStatistics}
                    />
                    {/* Basic statistics */}
                    {panelStatistics && (
                      <div className="ui-section-header-sm space-y-2 border-t border-border/45 p-3">
                        <div className="section-label">Session Info</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">Start Time</div>
                            <div className="font-mono tabular-nums">{formatDateTime(session.startTime, { timeStyle: "medium" })}</div>
                          </div>
                          {session.endTime && (
                            <div>
                              <div className="text-muted-foreground">End Time</div>
                              <div className="font-mono tabular-nums">{formatDateTime(session.endTime, { timeStyle: "medium" })}</div>
                            </div>
                          )}
                          <div>
                            <TooltipWrapper entry={tooltips.statTotalBytes}>
                              <div className="text-muted-foreground cursor-help">Total Bytes</div>
                            </TooltipWrapper>
                            <div className="font-medium tabular-nums">
                              {panelStatistics.totalBytes ? panelStatistics.totalBytes.toLocaleString() : "N/A"}
                            </div>
                          </div>
                          <div>
                            <TooltipWrapper entry={tooltips.statPacketsPerSec}>
                              <div className="text-muted-foreground cursor-help">Pkts/sec</div>
                            </TooltipWrapper>
                            <div className="font-medium tabular-nums">
                              {panelStatistics.packetsPerSecond ? panelStatistics.packetsPerSecond.toFixed(1) : "N/A"}
                            </div>
                          </div>
                        </div>
                        {panelStatistics.packetsByProtocol && (
                          <div>
                            <div className="text-muted-foreground text-xs mb-1">Protocols</div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(panelStatistics.packetsByProtocol)
                                .sort(([, a]: any, [, b]: any) => b - a)
                                .slice(0, 8)
                                .map(([proto, count]: any) => (
                                  <Badge key={proto} variant="outline" className="text-2xs">
                                    {proto}: {count}
                                  </Badge>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {showDiagnostics && (
                    <TabsContent value="expert" className="flex-1 m-0 overflow-auto">
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex-1 min-h-0 overflow-auto">
                          <FindingsPanel
                            findings={expertFindings}
                            loading={expertFindingsLoading}
                            livePollingActive={expertLivePollingActive}
                            onRefresh={() => fetchExpertFindings(session.id)}
                            onSelectPacket={(idx) => {
                              setSelectedPacketIndex(idx);
                              void loadExactEvidencePacket(idx);
                            }}
                            onInvestigateFinding={(finding) => {
                              setSidebarOpen(true);
                              setSidebarTab("expert");
                              const nextFilter = buildFindingDisplayFilter(finding);
                              useOpenCaptureStore.getState().openViewer(session.id, undefined, { filter: nextFilter });
                              navigateTo("packet-capture", "viewer");
                              notify({
                                source: "packet-capture",
                                type: "info",
                                title: "Opened Packet Viewer",
                                description: "Showing related packets in Packet Viewer.",
                              });
                              const packetIndex = getPrimaryPacketIndex(finding);
                              if (packetIndex !== null) {
                                setSelectedPacketIndex(packetIndex);
                              }
                            }}
                          />
                        </div>
                      </div>
                    </TabsContent>
                  )}
                </Tabs>
                </div>
              </>
            )}
          </>
        )}

        {contentView === "calls" && (
          <div className={cn("flex-1 min-w-0 overflow-hidden rounded-t-none border-t-0", panelClass)}>
            <CallFlowTab
              packets={packets}
              findings={expertFindings}
              onOpenTabbedPopout={() => {
                setSidebarTab("details");
                setPopoutTab("details");
                setDetailsPopoutOpen(true);
              }}
              onSelectPacket={(packet) => {
                const idx = packets.findIndex((p) =>
                  (typeof p.originalIndex === "number" && typeof packet.originalIndex === "number")
                    ? p.originalIndex === packet.originalIndex
                    : p === packet
                );
                if (idx >= 0) {
                  setSelectedPacketIndex(idx);
                  setSidebarOpen(true);
                  setSidebarTab("details");
                  setContentView("packets");
                }
              }}
            />
          </div>
        )}

        {contentView === "rtp" && (
          <div className="surface-flat flex min-h-0 w-[380px] flex-col overflow-hidden xl:w-[460px]">
            <div className="flex-1 min-h-0 overflow-auto px-2.5 py-2">
              {rtpStreamSummaries.length === 0 ? (
                <EmptyState
                  compact
                  variant="inline"
                  title="No RTP streams in current view"
                  description="Clear filters or switch to Packets to inspect signaling."
                />
              ) : (
                <div className="space-y-2">
                  {rtpStreamSummaries.map((stream) => {
                    const quality = stream.lossPercent > 3 || stream.jitterMs > 25
                      ? "degraded"
                      : stream.lossPercent > 1 || stream.jitterMs > 12
                        ? "fair"
                        : "good";
                    return (
                      <div key={stream.key} className="ui-surface-card p-2.5">
                        <div className="flex items-center gap-2 text-xs">
                          <Badge
                            variant={quality === "degraded" ? "destructive" : quality === "fair" ? "secondary" : "default"}
                            className="h-5"
                          >
                            {quality}
                          </Badge>
                          <span className="font-mono text-foreground">SSRC 0x{stream.ssrc.toString(16).toUpperCase().padStart(8, "0")}</span>
                          <span className="text-muted-foreground">PT {stream.payloadType}</span>
                          {stream.encrypted && <Badge variant="outline" className="h-5">SRTP</Badge>}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto h-6 px-2 text-2xs"
                            onClick={() => {
                              setWiresharkFilter(`rtp.ssrc == ${stream.ssrc}`);
                              fetchPackets(`rtp.ssrc == ${stream.ssrc}`);
                              setContentView("packets");
                            }}
                          >
                            Focus
                          </Button>
                        </div>
                        <div className="mt-1.5 text-2xs text-muted-foreground">
                          {stream.srcIp}:{stream.srcPort} → {stream.dstIp}:{stream.dstPort}
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-2 text-2xs">
                          <div className="surface-subtle rounded-md px-2 py-1">
                            <div className="text-muted-foreground">Packets</div>
                            <div className="font-mono">{stream.packets.toLocaleString()}</div>
                          </div>
                          <div className="surface-subtle rounded-md px-2 py-1">
                            <div className="text-muted-foreground">Est. loss</div>
                            <div className="font-mono">{stream.lossPercent.toFixed(2)}%</div>
                          </div>
                          <div className="surface-subtle rounded-md px-2 py-1">
                            <div className="text-muted-foreground">Arrival jitter</div>
                            <div className="font-mono">{stream.jitterMs.toFixed(1)} ms</div>
                          </div>
                          <div className="surface-subtle rounded-md px-2 py-1">
                            <div className="text-muted-foreground">RTCP pkts</div>
                            <div className="font-mono">{stream.rtcpPackets}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
          </div>
        </div>
      </div>

      <PacketDetailsPopout
        open={detailsPopoutOpen}
        onOpenChange={setDetailsPopoutOpen}
        packet={selectedPacket}
        sessionId={session.id}
        packetIndex={selectedPacket?.originalIndex ?? selectedPacketIndex}
        initialTab={initialDetailsTab}
      >
        <Tabs value={popoutTab} onValueChange={(v) => setPopoutTab(v as typeof popoutTab)} className="flex h-full min-h-0 flex-col">
          <div className="ui-section-header-sm flex-none h-10 box-border px-2.5 py-0">
            <div className="flex h-full items-center gap-2">
              <TabsList className="monitor-side-tabs !h-7 !min-h-7 flex-1">
                <TabsTrigger value="details" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                  Details
                </TabsTrigger>
                <TabsTrigger value="stats" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                  Stats
                </TabsTrigger>
                {showDiagnostics && (
                  <TabsTrigger value="expert" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                    Diagnostics
                    {expertCriticalCount > 0 && (
                      <Badge variant="destructive" className="text-3xs px-1 py-0 h-3.5 min-w-[14px]">
                        {expertCriticalCount}
                      </Badge>
                    )}
                    {expertCriticalCount === 0 && expertWarningCount > 0 && (
                      <Badge variant="secondary" className="text-3xs px-1 py-0 h-3.5 min-w-[14px]">
                        {expertWarningCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
            </div>
          </div>

          <TabsContent value="details" className="flex-1 m-0 overflow-auto">
            {selectedPacket ? (
              <PacketDetailsView
                packet={selectedPacket}
                sessionId={session.id}
                packetIndex={selectedPacket.originalIndex ?? selectedPacketIndex}
                initialTab={initialDetailsTab}
              />
            ) : (
              <EmptyState compact variant="inline" title="Select a packet to view details" />
            )}
          </TabsContent>

          <TabsContent value="stats" className="flex-1 m-0 overflow-auto">
            <LiveStatsPanel
              stats={liveStats}
              pipelineStats={null}
              isCapturing={isRunning}
              historicalStats={panelStatistics}
            />
            {panelStatistics && (
              <div className="ui-section-header-sm space-y-2 border-t border-border/45 p-3">
                <div className="section-label">Session Info</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Start Time</div>
                    <div className="font-mono tabular-nums">{formatDateTime(session.startTime, { timeStyle: "medium" })}</div>
                  </div>
                  {session.endTime && (
                    <div>
                      <div className="text-muted-foreground">End Time</div>
                      <div className="font-mono tabular-nums">{formatDateTime(session.endTime, { timeStyle: "medium" })}</div>
                    </div>
                  )}
                  <div>
                    <TooltipWrapper entry={tooltips.statTotalBytes}>
                      <div className="text-muted-foreground cursor-help">Total Bytes</div>
                    </TooltipWrapper>
                    <div className="font-medium tabular-nums">
                      {panelStatistics.totalBytes ? panelStatistics.totalBytes.toLocaleString() : "N/A"}
                    </div>
                  </div>
                  <div>
                    <TooltipWrapper entry={tooltips.statPacketsPerSec}>
                      <div className="text-muted-foreground cursor-help">Pkts/sec</div>
                    </TooltipWrapper>
                    <div className="font-medium tabular-nums">
                      {panelStatistics.packetsPerSecond ? panelStatistics.packetsPerSecond.toFixed(1) : "N/A"}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {showDiagnostics && (
            <TabsContent value="expert" className="flex-1 m-0 overflow-auto">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex-1 min-h-0 overflow-auto">
                  <FindingsPanel
                    findings={expertFindings}
                    loading={expertFindingsLoading}
                    livePollingActive={expertLivePollingActive}
                    onRefresh={() => fetchExpertFindings(session.id)}
                    onSelectPacket={(idx) => {
                      setSelectedPacketIndex(idx);
                      void loadExactEvidencePacket(idx);
                    }}
                    onInvestigateFinding={(finding) => {
                      setSidebarOpen(true);
                      setSidebarTab("expert");
                      setPopoutTab("expert");
                      const nextFilter = buildFindingDisplayFilter(finding);
                      useOpenCaptureStore.getState().openViewer(session.id, undefined, { filter: nextFilter });
                      navigateTo("packet-capture", "viewer");
                      notify({
                        source: "packet-capture",
                        type: "info",
                        title: "Opened Packet Viewer",
                        description: "Showing related packets in Packet Viewer.",
                      });
                      const packetIndex = getPrimaryPacketIndex(finding);
                      if (packetIndex !== null) {
                        setSelectedPacketIndex(packetIndex);
                      }
                    }}
                  />
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </PacketDetailsPopout>

      {/* Export Dialog */}
      {showExport && (
        <ExportDialog
          open={showExport}
          onOpenChange={setShowExport}
          packets={packets}
          sessionId={session.id}
        />
      )}
    </div>
  );
});

export default CaptureSessionViewer;
