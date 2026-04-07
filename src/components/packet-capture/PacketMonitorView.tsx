/**
 * PacketMonitorView — Per-tab live packet monitor.
 *
 * Rendered once per monitor tab by MonitorTabsWrapper. Each instance manages
 * its own capture session, packets, stats, and polling independently.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePacketAnnotationStore, type PacketAnnotation, type PacketColorId } from "@/stores/packetAnnotationStore";
import { useMonitorTabStore } from "@/stores/monitorTabStore";
import { useNotifications } from "@/hooks/useNotifications";
import { useToolVisible } from "@/hooks/useToolVisible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Trash2,
  RefreshCw,
  Bookmark,
  ExternalLink,
  Save,
  ArrowUpFromLine,
  PanelRightOpen,
  PanelRightClose,
  Scan,
  Activity,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AppDivider, PanelResizeHandle } from "@/components/ui/panel-chrome";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { LiveIndicator } from "@/components/ui/live-indicator";
import type { PacketInfo, FilterConfig, ExpertFinding } from "@/types/packetCapture";
import type { ExecutionContext } from "@/stores/executionContextStore";
import {
  getFilteredPackets,
  startCapture as apiStartCapture,
  startCapturePipeline,
  getLiveStatistics,
  getPipelineStats,
  type LiveStatsSnapshot,
  type PipelineStats,
} from "@/api/packetCapture";

import { UnifiedControlBar } from "./monitor/UnifiedControlBar";
import { WarperPacketList } from "./monitor/WarperPacketList";
import { PacketDetailsView } from "./monitor/PacketDetailsView";
import { LiveStatsPanel } from "./monitor/LiveStatsPanel";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PacketDetailsPopout } from "./monitor/PacketDetailsPopout";
import { useOpenCaptureStore } from "@/hooks/useOpenCapture";
import { navigateTo } from "@/lib/navigation";
import { LiveRtpQualityPanel } from "./monitor/LiveRtpQualityPanel";
import { FindingsPanel } from "./monitor/FindingsPanel";
import { ExpertSummaryBar } from "./monitor/ExpertSummaryBar";
import { subscribeSharedPoll } from "@/lib/sharedPollCoordinator";
import {
  buildFindingDisplayFilter,
  getPrimaryPacketIndex,
} from "@/lib/expertFindingUtils";
import { FilterDialog } from "./FilterDialog";
import { ExportDialog } from "./monitor/ExportDialog";
import { tooltips } from "@/lib/tooltips";

type DiagnosticsSectionId = "findings" | "stats" | "flow" | "rtp";
type SidebarPane = "details" | "diagnostics";

const DIAGNOSTICS_SECTIONS: { id: DiagnosticsSectionId; label: string }[] = [
  { id: "findings", label: "Findings" },
  { id: "stats", label: "Stats" },
  { id: "flow", label: "Flows" },
  { id: "rtp", label: "RTP" },
];

/* ═══════════════════════════════════════════════════════════════════════════ */

interface PacketMonitorViewProps {
  tabId: string;
  executionContext: ExecutionContext;
  isActiveTab: boolean;
  onCloseTab?: () => void;
}

const DEFAULT_CAPTURE_FILTER_CONFIG: FilterConfig = {
  protocols: [],
  srcIpRanges: [],
  dstIpRanges: [],
  srcPorts: [],
  dstPorts: [],
  portRanges: [],
};

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

function getAdaptivePacketPollIntervalMs(baseMs: number, idlePollCount: number): number {
  if (idlePollCount >= 8) return Math.min(baseMs * 4, 5000);
  if (idlePollCount >= 4) return Math.min(baseMs * 2, 3000);
  return baseMs;
}

export function PacketMonitorView({ tabId, executionContext, isActiveTab }: PacketMonitorViewProps) {
  const showDiagnostics = true;
  const pmSettings = useSettingsStore((s) => s.packetMonitor);
  const updateTab = useMonitorTabStore((s) => s.updateTab);
  const setFooterState = useMonitorTabStore((s) => s.setFooterState);

  const localInterfaces = usePacketCaptureStore((s) => s.interfaces);
  const fetchInterfaces = usePacketCaptureStore((s) => s.fetchInterfaces);

  // When targeting a remote agent, show the agent's interfaces (from heartbeat)
  // instead of the local machine's.
  const agentId = executionContext.type === "remote" ? executionContext.agentId : null;
  const agentConn = useRemoteAgentStore((s) =>
    agentId ? s.connections.find((c) => c.id === agentId) : undefined
  );
  const interfaces = useMemo(() => {
    if (executionContext.type !== "remote" || !agentConn?.interfaces) return localInterfaces;
    return agentConn.interfaces.map((ai) => ({
      name: ai.name,
      description: ai.name,
      addresses: ai.ip ? [ai.ip] : [],
      mac: ai.mac ?? undefined,
      is_up: ai.is_up,
    }));
  }, [executionContext.type, agentConn?.interfaces, localInterfaces]);
  const setActiveSession = usePacketCaptureStore((s) => s.setActiveSession);
  const storeStartCapture = usePacketCaptureStore((s) => s.startCapture);
  const storeStopCapture = usePacketCaptureStore((s) => s.stopCapture);
  const wiresharkFilter = usePacketCaptureStore((s) => s.wiresharkFilter);
  const setWiresharkFilter = usePacketCaptureStore((s) => s.setWiresharkFilter);

  const expertFindings = usePacketCaptureStore((s) => s.expertFindings);
  const expertFindingsLoading = usePacketCaptureStore((s) => s.expertFindingsLoading);
  const expertLivePollingActive = usePacketCaptureStore((s) => s.expertLivePollingActive);
  const fetchExpertFindings = usePacketCaptureStore((s) => s.fetchExpertFindings);
  const startExpertLivePolling = usePacketCaptureStore((s) => s.startExpertLivePolling);
  const stopExpertLivePolling = usePacketCaptureStore((s) => s.stopExpertLivePolling);

  const { notify } = useNotifications();
  const isVisible = useToolVisible("packet-capture");

  const [isCapturing, setIsCapturing] = useState(false);
  const [isPipelineMode, setIsPipelineMode] = useState(pmSettings.pipelineMode);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captureFilterConfig, setCaptureFilterConfig] = useState<FilterConfig>(DEFAULT_CAPTURE_FILTER_CONFIG);
  const [showCaptureFilterDialog, setShowCaptureFilterDialog] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const setPacketMonitorActive = usePacketCaptureStore((s) => s.setPacketMonitorActive);
  useEffect(() => {
    if (isActiveTab) setPacketMonitorActive(isCapturing);
    return () => { if (isActiveTab) setPacketMonitorActive(false); };
  }, [isCapturing, isActiveTab, setPacketMonitorActive]);

  const settingsPipelineMode = pmSettings.pipelineMode;
  useEffect(() => { setIsPipelineMode(settingsPipelineMode); }, [settingsPipelineMode]);

  const [packets, setPackets] = useState<PacketInfo[]>([]);
  const [totalPacketCount, setTotalPacketCount] = useState(0);
  const [selectedPacketIndex, setSelectedPacketIndex] = useState<number | null>(null);
  const [_isLoading, setIsLoading] = useState(false);

  const [liveStats, setLiveStats] = useState<LiveStatsSnapshot | null>(null);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);

  const [fps, setFps] = useState(60);
  const fpsFrameCount = useRef(0);
  const fpsLastTime = useRef(performance.now());

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(420);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [detailsPopoutOpen, setDetailsPopoutOpen] = useState(false);
  const contentSplitRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(pmSettings.autoScroll);
  const [showMarkedOnly, setShowMarkedOnly] = useState(false);
  const [sidebarPane, setSidebarPane] = useState<SidebarPane>("details");
  const [diagnosticsSection, setDiagnosticsSection] = useState<DiagnosticsSectionId>("findings");

  const settingsAutoScroll = pmSettings.autoScroll;
  useEffect(() => { setAutoScroll(settingsAutoScroll); }, [settingsAutoScroll]);
  const handleAutoScrollToggle = useCallback(() => {
    setAutoScroll((prev) => { const next = !prev; useSettingsStore.getState().setPacketMonitor({ autoScroll: next }); return next; });
  }, []);

  useEffect(() => {
    if (isActiveTab) setFooterState({ isCapturing, totalPacketCount, selectedPacketIndex, autoScroll, fps });
  }, [isActiveTab, isCapturing, totalPacketCount, selectedPacketIndex, autoScroll, fps, setFooterState]);

  const fetchAbortRef = useRef<AbortController | null>(null);

  const selectedPacket = useMemo(() => {
    if (selectedPacketIndex === null || selectedPacketIndex >= packets.length) return null;
    return packets[selectedPacketIndex] ?? null;
  }, [packets, selectedPacketIndex]);

  const activeCaptureFilterCount = useMemo(() => {
    return (
      captureFilterConfig.protocols.length +
      captureFilterConfig.srcIpRanges.length +
      captureFilterConfig.dstIpRanges.length +
      captureFilterConfig.srcPorts.length +
      captureFilterConfig.dstPorts.length +
      captureFilterConfig.portRanges.length +
      (captureFilterConfig.rtpPortRange ? 1 : 0)
    );
  }, [captureFilterConfig]);

  const captureFilterSummary = useMemo(() => {
    if (activeCaptureFilterCount === 0) return "No capture rules set. Captures all traffic on the selected interface.";
    const parts: string[] = [];
    if (captureFilterConfig.protocols.length > 0) parts.push(`${captureFilterConfig.protocols.length} protocol${captureFilterConfig.protocols.length === 1 ? "" : "s"}`);
    if (captureFilterConfig.srcIpRanges.length > 0 || captureFilterConfig.dstIpRanges.length > 0) {
      parts.push(`${captureFilterConfig.srcIpRanges.length + captureFilterConfig.dstIpRanges.length} IP rule${captureFilterConfig.srcIpRanges.length + captureFilterConfig.dstIpRanges.length === 1 ? "" : "s"}`);
    }
    if (captureFilterConfig.srcPorts.length > 0 || captureFilterConfig.dstPorts.length > 0 || captureFilterConfig.portRanges.length > 0) {
      parts.push(`${captureFilterConfig.srcPorts.length + captureFilterConfig.dstPorts.length + captureFilterConfig.portRanges.length} port rule${captureFilterConfig.srcPorts.length + captureFilterConfig.dstPorts.length + captureFilterConfig.portRanges.length === 1 ? "" : "s"}`);
    }
    if (captureFilterConfig.rtpPortRange) parts.push("custom RTP range");
    return `Rules active: ${parts.join(", ")}. Applied at capture start.`;
  }, [activeCaptureFilterCount, captureFilterConfig]);
  const previousTotalPacketCountRef = useRef(0);
  const idlePacketPollCountRef = useRef(0);
  const [adaptivePacketPollIntervalMs, setAdaptivePacketPollIntervalMs] = useState(pmSettings.packetPollIntervalMs);
  const activeStatsPollIntervalMs = useMemo(() => {
    const baseMs = pmSettings.statsPollIntervalMs;
    if (!isVisible || !isActiveTab) return baseMs;
    if (!isCapturing) return Math.min(baseMs * 2, 5000);
    const statsVisible =
      sidebarOpen && sidebarPane === "diagnostics" && diagnosticsSection === "stats";
    return statsVisible ? baseMs : Math.min(baseMs * 2, 5000);
  }, [
    pmSettings.statsPollIntervalMs,
    isVisible,
    isActiveTab,
    isCapturing,
    sidebarOpen,
    sidebarPane,
    diagnosticsSection,
  ]);

  useEffect(() => {
    previousTotalPacketCountRef.current = 0;
    idlePacketPollCountRef.current = 0;
    setAdaptivePacketPollIntervalMs(pmSettings.packetPollIntervalMs);
  }, [pmSettings.packetPollIntervalMs, sessionId]);

  useEffect(() => { fetchInterfaces(); }, [fetchInterfaces]);

  useEffect(() => {
    if (!isVisible || !isActiveTab) return;
    let animationId: number;
    const measure = () => {
      fpsFrameCount.current++;
      const now = performance.now();
      const elapsed = now - fpsLastTime.current;
      if (elapsed >= 1000) { setFps(Math.round((fpsFrameCount.current * 1000) / elapsed)); fpsFrameCount.current = 0; fpsLastTime.current = now; }
      animationId = requestAnimationFrame(measure);
    };
    animationId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(animationId);
  }, [isVisible, isActiveTab]);

  const fetchPackets = useCallback(async (sid: string, filter?: string) => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = new AbortController();
    try {
      const result = await getFilteredPackets(sid, { filterExpression: filter?.trim() || undefined, offset: 0, limit: pmSettings.pageSize });
      setPackets((prev) => (didPacketWindowChange(prev, result.packets) ? result.packets : prev));
      setTotalPacketCount((prev) => (prev === result.totalCount ? prev : result.totalCount));
      if (previousTotalPacketCountRef.current !== result.totalCount) {
        updateTab(tabId, { packetCount: result.totalCount });
      }
      previousTotalPacketCountRef.current = result.totalCount;
    } catch (e: any) { if (e.name !== "AbortError") console.error("Failed to fetch packets:", e); }
  }, [pmSettings.pageSize, tabId, updateTab]);

  // Poll whenever this tab has a live session — do not gate on isActiveTab (other monitor tabs
  // would stop ingress for a background capture) or isVisible (tool panel stays mounted with
  // display:none when switching apps; we still want packets when you return).
  useEffect(() => {
    if (!isCapturing || !sessionId) return;
    const filterExpression = wiresharkFilter.trim() || "";
    return subscribeSharedPoll({
      key: `capture:${sessionId}:packets:${pmSettings.pageSize}:${filterExpression}`,
      intervalMs: adaptivePacketPollIntervalMs,
      fetcher: () => getFilteredPackets(sessionId, {
        filterExpression: filterExpression || undefined,
        offset: 0,
        limit: pmSettings.pageSize,
      }),
      onData: (result) => {
        const previousCount = previousTotalPacketCountRef.current;
        const currentCount = result.totalCount;
        const isGrowing = currentCount > previousCount;
        previousTotalPacketCountRef.current = currentCount;
        if (isGrowing) {
          idlePacketPollCountRef.current = 0;
          if (adaptivePacketPollIntervalMs !== pmSettings.packetPollIntervalMs) {
            setAdaptivePacketPollIntervalMs(pmSettings.packetPollIntervalMs);
          }
        } else {
          idlePacketPollCountRef.current += 1;
          const nextIntervalMs = getAdaptivePacketPollIntervalMs(
            pmSettings.packetPollIntervalMs,
            idlePacketPollCountRef.current,
          );
          if (nextIntervalMs !== adaptivePacketPollIntervalMs) {
            setAdaptivePacketPollIntervalMs(nextIntervalMs);
          }
        }
        setPackets((prev) => (didPacketWindowChange(prev, result.packets) ? result.packets : prev));
        setTotalPacketCount((prev) => (prev === result.totalCount ? prev : result.totalCount));
        if (currentCount !== previousCount) {
          updateTab(tabId, { packetCount: result.totalCount });
        }
      },
      onError: (error) => {
        console.error("Failed to poll packets:", error);
      },
    });
  }, [
    isCapturing,
    sessionId,
    wiresharkFilter,
    pmSettings.pageSize,
    adaptivePacketPollIntervalMs,
    pmSettings.packetPollIntervalMs,
    tabId,
    updateTab,
  ]);

  useEffect(() => {
    if (!isCapturing || !sessionId) return;
    return subscribeSharedPoll({
      key: `capture:${sessionId}:live-stats:${isPipelineMode ? "pipeline" : "classic"}`,
      intervalMs: activeStatsPollIntervalMs,
      fetcher: async () => {
        const [stats, pStats] = await Promise.all([
          getLiveStatistics(sessionId),
          isPipelineMode ? getPipelineStats(sessionId) : Promise.resolve(null),
        ]);
        return { stats, pStats };
      },
      onData: ({ stats, pStats }) => {
        setLiveStats(stats);
        setPipelineStats(pStats);
      },
    });
  }, [isCapturing, sessionId, isPipelineMode, activeStatsPollIntervalMs]);

  /* ── Handlers ── */

  const handleStart = useCallback(async (interfaceName: string) => {
    if (!interfaceName && executionContext.type !== "remote") {
      notify({ source: "packet-capture", type: "error", title: "No Interface Selected", description: "Please select a network interface first." }); return;
    }
    try {
      setIsLoading(true); setPackets([]); setTotalPacketCount(0); setSelectedPacketIndex(null); setLiveStats(null); setPipelineStats(null);
      const name = `Capture ${new Date().toLocaleTimeString()}`;
      let sid: string;
      if (executionContext.type === "remote") {
        sid = await storeStartCapture(name, null, interfaceName, captureFilterConfig, executionContext);
      } else if (isPipelineMode) {
        sid = await startCapturePipeline(name, null, interfaceName, captureFilterConfig);
      } else {
        sid = await apiStartCapture(name, null, interfaceName, captureFilterConfig);
      }
      setSessionId(sid); setActiveSession(sid); setIsCapturing(true);
      if (showDiagnostics) startExpertLivePolling(sid);
      updateTab(tabId, { sessionId: sid, isCapturing: true, label: name });
      const wf = usePacketCaptureStore.getState().wiresharkFilter;
      void fetchPackets(sid, wf);
      notify({ source: "packet-capture", type: "success", title: "Capture Started", description: `Capturing on ${interfaceName || "auto"}` });
    } catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Capture Failed", description: e.message || "Unknown error" }); }
    finally { setIsLoading(false); }
  }, [isPipelineMode, captureFilterConfig, setActiveSession, storeStartCapture, notify, executionContext, tabId, updateTab, showDiagnostics, startExpertLivePolling, fetchPackets]);

  const handleStop = useCallback(async () => {
    if (!sessionId) return;
    try { await storeStopCapture(sessionId); } catch (e: any) { console.warn("[PacketMonitor] stopCapture error:", e); }
    setIsCapturing(false);
    stopExpertLivePolling();
    updateTab(tabId, { isCapturing: false });
    // Preserve the current packet list in Monitor view after stopping.
    // Users should only lose in-memory packets on explicit Clear or when starting a new capture.
    if (showDiagnostics) fetchExpertFindings(sessionId);
    notify({
      source: "packet-capture",
      type: "success",
      title: "Capture Stopped",
      description: `Showing ${packets.length.toLocaleString()} packets in monitor`,
    });
  }, [sessionId, packets.length, storeStopCapture, notify, tabId, updateTab, stopExpertLivePolling, fetchExpertFindings, showDiagnostics]);

  const handleOpenInCaptures = useCallback(async () => {
    if (!sessionId) return;
    if (isCapturing) {
      try { await storeStopCapture(sessionId); setIsCapturing(false); updateTab(tabId, { isCapturing: false }); }
      catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Stop Failed", description: e.message || "Unknown error" }); return; }
    }
    useOpenCaptureStore.getState().openViewer(sessionId);
    navigateTo("packet-capture", "viewer");
    notify({ source: "packet-capture", type: "success", title: "Opened in Captures", description: `Session with ${totalPacketCount.toLocaleString()} packets` });
  }, [sessionId, isCapturing, totalPacketCount, notify, tabId, updateTab, storeStopCapture]);

  const ensureStoppedForExport = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    if (!isCapturing) return true;
    try {
      await storeStopCapture(sessionId);
      setIsCapturing(false);
      updateTab(tabId, { isCapturing: false });
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      notify({ source: "packet-capture", type: "error", title: "Stop Failed", description: msg });
      return false;
    }
  }, [sessionId, isCapturing, notify, tabId, updateTab, storeStopCapture]);

  const annotationStore = usePacketAnnotationStore();
  const annotationSessionId = sessionId ?? `__tab_${tabId}__`;
  const annotationsMap = useMemo<Record<number, PacketAnnotation>>(() => {
    const map: Record<number, PacketAnnotation> = {};
    const prefix = annotationSessionId + "::";
    for (const [key, val] of Object.entries(annotationStore.annotations)) {
      if (key.startsWith(prefix)) { const idx = parseInt(key.slice(prefix.length), 10); if (!isNaN(idx)) map[idx] = val; }
    }
    return map;
  }, [annotationStore.annotations, annotationSessionId]);

  const handleToggleMark = useCallback((index: number) => { annotationStore.toggleMark(annotationSessionId, index); }, [annotationStore, annotationSessionId]);
  const handleSetColor = useCallback((index: number, colorId: PacketColorId | undefined) => { annotationStore.setColor(annotationSessionId, index, colorId); }, [annotationStore, annotationSessionId]);
  const handleClearAnnotation = useCallback((index: number) => { annotationStore.clearAnnotation(annotationSessionId, index); }, [annotationStore, annotationSessionId]);
  const annotatedCount = useMemo(() => annotationStore.getAnnotatedCount(annotationSessionId), [annotationStore, annotationSessionId]);

  const displayPackets = useMemo(() => {
    if (!showMarkedOnly) return packets;
    return packets.filter((_, idx) => annotationsMap[idx]?.marked);
  }, [packets, showMarkedOnly, annotationsMap]);

  const [confirmClearPackets, setConfirmClearPackets] = useState(false);
  const handleClear = useCallback(() => {
    setPackets([]); setTotalPacketCount(0); setSelectedPacketIndex(null); setLiveStats(null); setPipelineStats(null);
    annotationStore.clearAllForSession(annotationSessionId); setShowMarkedOnly(false); setConfirmClearPackets(false);
    updateTab(tabId, { packetCount: 0 });
    notify({ source: "packet-capture", type: "success", title: "Cleared", description: "Packets cleared from view" });
  }, [notify, annotationStore, annotationSessionId, tabId, updateTab]);

  const handleRefresh = useCallback(() => { if (sessionId) fetchPackets(sessionId, wiresharkFilter); }, [sessionId, wiresharkFilter, fetchPackets]);
  const handleSelectPacket = useCallback((index: number) => {
    setSelectedPacketIndex(index);
    if (!sidebarOpen) setSidebarOpen(true);
  }, [sidebarOpen]);
  const loadExactEvidencePacket = useCallback((packetIndex: number) => {
    if (!sessionId || packetIndex < 0) return;
    const packetFilter = `frame.number == ${packetIndex + 1}`;
    useOpenCaptureStore.getState().openViewer(sessionId, undefined, { filter: packetFilter });
    navigateTo("packet-capture", "viewer");
    notify({
      source: "packet-capture",
      type: "info",
      title: "Opened Packet Viewer",
      description: `Opening related evidence for packet #${packetIndex + 1}.`,
    });
  }, [sessionId, notify]);

  const handleInvestigateFinding = useCallback((finding: ExpertFinding) => {
    const packetIndex = getPrimaryPacketIndex(finding);
    const suggestedFilter = buildFindingDisplayFilter(finding);

    setSidebarPane("details");
    setSidebarOpen(true);
    setWiresharkFilter(suggestedFilter);
    if (sessionId) {
      useOpenCaptureStore.getState().openViewer(sessionId, undefined, { filter: suggestedFilter });
      navigateTo("packet-capture", "viewer");
      notify({
        source: "packet-capture",
        type: "info",
        title: "Opened Packet Viewer",
        description: "Showing related packets in Packet Viewer.",
      });
    }
    if (packetIndex !== null) {
      setSelectedPacketIndex(packetIndex);
    }
  }, [setWiresharkFilter, sessionId, notify]);

  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFilterChange = useCallback((filter: string) => {
    setWiresharkFilter(filter);
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    if (sessionId && !isCapturing) { filterDebounceRef.current = setTimeout(() => { fetchPackets(sessionId, filter); }, 250); }
  }, [sessionId, isCapturing, setWiresharkFilter, fetchPackets]);

  const dropRate = useMemo(() => {
    if (!pipelineStats) return 0;
    const total = pipelineStats.packetsCaptured || 1;
    const dropped = (pipelineStats.packetsDroppedCapture || 0) + (pipelineStats.packetsDroppedParser || 0);
    return (dropped / total) * 100;
  }, [pipelineStats]);

  const expertCriticalCount = useMemo(() => expertFindings.filter((f) => f.severity === "critical").length, [expertFindings]);
  const expertWarningCount = useMemo(() => expertFindings.filter((f) => f.severity === "warning").length, [expertFindings]);

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

  const hasData = totalPacketCount > 0 || sessionId !== null;

  const formatRate = (rate: number): string => {
    if (rate >= 1000000) return `${(rate / 1000000).toFixed(1)}M`;
    if (rate >= 1000) return `${(rate / 1000).toFixed(1)}K`;
    return rate.toFixed(0);
  };

  /* ═══════════════════════════════════ RENDER ══════════════════════════════ */
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
          {/* Single toolbar: capture + list actions + filter + export / layout */}
          <div className="ui-section-header-md flex min-w-0 items-center gap-2 px-3 py-2">
            <UnifiedControlBar
              interfaces={interfaces}
              onRefreshInterfaces={fetchInterfaces}
              executionContext={executionContext}
              isCapturing={isCapturing}
              onStart={handleStart}
              onStop={handleStop}
              onOpenCaptureFilters={() => setShowCaptureFilterDialog(true)}
              activeCaptureFilterCount={activeCaptureFilterCount}
              captureFilterSummary={captureFilterSummary}
              wiresharkFilter={wiresharkFilter}
              onWiresharkFilterChange={handleFilterChange}
              filteredCount={packets.length}
              captureRulesAfterFilter
              toolbarBeforeFilter={
                <>
                  <TooltipWrapper
                    content={
                      annotatedCount.marked > 0
                        ? `${showMarkedOnly ? "Show all packets" : "Show only marked packets"} (${annotatedCount.marked} marked)`
                        : showMarkedOnly
                          ? "Show all packets"
                          : "No marked packets — bookmark rows in the list"
                    }
                  >
                    <Button
                      type="button"
                      variant={showMarkedOnly ? "default" : "neutral"}
                      size="icon-sm"
                      className={cn(
                        showMarkedOnly
                          ? "border border-warning/25 bg-warning/15 text-warning hover:bg-warning/25"
                          : "",
                      )}
                      aria-label={
                        annotatedCount.marked > 0
                          ? `Marked packets, ${annotatedCount.marked} (${showMarkedOnly ? "showing marked only" : "show all"})`
                          : "Marked packets"
                      }
                      onClick={() => setShowMarkedOnly((v) => !v)}
                      disabled={annotatedCount.marked === 0 && !showMarkedOnly}
                    >
                      <Bookmark className={cn("h-3.5 w-3.5", showMarkedOnly && "fill-current")} />
                    </Button>
                  </TooltipWrapper>
                  {isCapturing ? (
                    <div className="inline-flex h-7 shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-border/35 bg-muted/18 px-2 text-xs">
                      <LiveIndicator variant="badge" label="LIVE" size="xs" />
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {totalPacketCount.toLocaleString()} pkts
                      </span>
                      {liveStats?.packetRate != null && liveStats.packetRate > 0 ? (
                        <>
                          <AppDivider orientation="vertical" size="sm" className="mx-0" />
                          <span className="font-mono tabular-nums text-muted-foreground/70">
                            {formatRate(liveStats.packetRate)}/s
                          </span>
                        </>
                      ) : null}
                      {isPipelineMode && dropRate > 0.1 ? (
                        <span
                          className={cn(
                            "font-mono tabular-nums",
                            dropRate >= 5
                              ? "text-destructive"
                              : dropRate >= 1
                                ? "text-warning"
                                : "text-muted-foreground/70",
                          )}
                        >
                          {dropRate.toFixed(1)}% drop
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </>
              }
              toolbarAfterFilter={
                <>
                  <TooltipWrapper content="Re-fetch packets from the capture engine">
                    <Button
                      type="button"
                      variant="neutral"
                      size="icon-sm"
                      aria-label="Refresh packet list"
                      onClick={handleRefresh}
                      disabled={!sessionId || isCapturing}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                  <TooltipWrapper content="Clear all captured packets from this view">
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      aria-label="Clear captured packets"
                      onClick={() => setConfirmClearPackets(true)}
                      disabled={totalPacketCount === 0}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                  <AppDivider orientation="vertical" size="md" className="mx-0.5 shrink-0" />
                  <TooltipWrapper content="Save this capture and open it in the Captures viewer">
                    <Button
                      type="button"
                      variant="neutral"
                      size="icon-sm"
                      aria-label="Save capture and open in Captures"
                      disabled={!hasData}
                      onClick={handleOpenInCaptures}
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                  <TooltipWrapper entry={tooltips.captureExport}>
                    <Button
                      type="button"
                      variant="neutral"
                      size="icon-sm"
                      aria-label="Save or export packets"
                      onClick={() => setShowExport(true)}
                      disabled={!hasData}
                    >
                      <ArrowUpFromLine className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipWrapper>
                  <AppDivider orientation="vertical" size="md" className="mx-0.5" />
                  {showDiagnostics && (
                    <TooltipWrapper
                      content={
                        <div className="space-y-1">
                          <p className="font-medium">Diagnostics</p>
                          <p className="text-xs text-muted-foreground">
                            Findings, live stats, and RTP quality in the side panel.
                          </p>
                          {(expertCriticalCount > 0 || expertWarningCount > 0) && (
                            <p className="text-2xs text-muted-foreground">
                              {expertCriticalCount > 0 && `${expertCriticalCount} critical`}
                              {expertCriticalCount > 0 && expertWarningCount > 0 ? " · " : ""}
                              {expertWarningCount > 0 && `${expertWarningCount} warnings`}
                            </p>
                          )}
                        </div>
                      }
                    >
                      <Button
                        type="button"
                        variant="neutral"
                        size="icon-sm"
                        className={cn(
                          "relative",
                          sidebarOpen && sidebarPane === "diagnostics" && "bg-accent text-foreground",
                        )}
                        aria-label={
                          sidebarOpen && sidebarPane === "diagnostics"
                            ? "Show packet details panel"
                            : "Show diagnostics panel"
                        }
                        aria-pressed={sidebarOpen && sidebarPane === "diagnostics"}
                        onClick={() => {
                          if (sidebarPane === "diagnostics") {
                            setSidebarPane("details");
                          } else {
                            setSidebarPane("diagnostics");
                            setSidebarOpen(true);
                          }
                        }}
                      >
                        <Activity className="h-3.5 w-3.5" />
                        {expertCriticalCount > 0 ? (
                          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-destructive-foreground">
                            {expertCriticalCount > 99 ? "99+" : expertCriticalCount}
                          </span>
                        ) : expertWarningCount > 0 ? (
                          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-bold text-warning-foreground">
                            {expertWarningCount > 99 ? "99+" : expertWarningCount}
                          </span>
                        ) : null}
                      </Button>
                    </TooltipWrapper>
                  )}
                  <TooltipWrapper
                    content={sidebarOpen ? "Collapse right panel" : "Expand right panel"}
                  >
                    <Button
                      variant="neutral"
                      size="icon-sm"
                      className={cn(sidebarOpen && "text-primary")}
                      aria-label={sidebarOpen ? "Collapse right panel" : "Expand right panel"}
                      onClick={() => setSidebarOpen(!sidebarOpen)}
                    >
                      {sidebarOpen ? (
                        <PanelRightClose className="h-3.5 w-3.5" />
                      ) : (
                        <PanelRightOpen className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipWrapper>
                </>
              }
            />
          </div>

          {showDiagnostics && expertFindings.length > 0 && (
            <div className="ui-section-header-sm px-3 py-2">
              <ExpertSummaryBar
                findings={expertFindings}
                onViewAll={() => {
                  setDiagnosticsSection("findings");
                  setSidebarPane("diagnostics");
                  setSidebarOpen(true);
                }}
              />
            </div>
          )}

          <div ref={contentSplitRef} className={cn("flex flex-1 min-h-0", sidebarResizing && "cursor-col-resize select-none")}>
            {/* ── Packet list ── */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-muted/[0.06]">
          <WarperPacketList
            packets={displayPackets} selectedIndex={selectedPacketIndex} onSelect={handleSelectPacket}
            autoScroll={autoScroll && isCapturing} onAutoScrollToggle={handleAutoScrollToggle}
            totalCount={showMarkedOnly ? displayPackets.length : totalPacketCount} className="flex-1"
            annotations={annotationsMap} onToggleMark={handleToggleMark} onSetColor={handleSetColor} onClearAnnotation={handleClearAnnotation} />
            </div>

            {/* ── Details sidebar ── */}
            {sidebarOpen && (
              <>
                <PanelResizeHandle
                  orientation="vertical"
                  density="compact"
                  appearance="rail"
                  label="Resize packet list and details panel"
                  className="shrink-0 rounded-none"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setSidebarResizing(true);
                  }}
                  onDoubleClick={() => setSidebarWidthPx(420)}
                />
                <div
                  className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-muted/[0.08]"
                  style={{ width: `${sidebarWidthPx}px` }}
                >
                <div className="flex min-h-0 flex-1 flex-col">
                  {sidebarPane === "details" ? (
                    <>
                      <div className="ui-section-header-sm box-border flex h-10 flex-none items-center justify-between gap-2 border-b border-[var(--ui-rule)] px-2.5 py-0">
                        <span className="truncate text-xs font-semibold text-foreground">Details</span>
                        <TooltipWrapper content="Open selected packet details in popout">
                          <Button
                            variant="neutral"
                            size="icon-sm"
                            className="h-7 w-7 shrink-0"
                            aria-label="Open selected packet details in popout"
                            onClick={() => setDetailsPopoutOpen(true)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipWrapper>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto">
                        {selectedPacket ? (
                          <PacketDetailsView
                            packet={selectedPacket}
                            sessionId={sessionId}
                            packetIndex={selectedPacket.originalIndex ?? selectedPacketIndex}
                          />
                        ) : (
                          <EmptyState
                            variant="inline"
                            icon={<Scan />}
                            title="No packet selected"
                            description="Select a packet row to inspect details and decoded fields."
                            className="h-full p-6"
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <Tabs
                      value={diagnosticsSection}
                      onValueChange={(v) => setDiagnosticsSection(v as DiagnosticsSectionId)}
                      className="flex min-h-0 flex-1 flex-col"
                    >
                      <div className="ui-section-header-sm box-border flex h-10 shrink-0 flex-none items-center border-b border-[var(--ui-rule)] px-2.5 py-0">
                        <TabsList
                          className="monitor-side-tabs !h-7 !min-h-7 w-full max-w-full flex-1 bg-transparent"
                          aria-label="Diagnostics panels"
                        >
                          {DIAGNOSTICS_SECTIONS.map(({ id, label }) => (
                            <TabsTrigger
                              key={id}
                              value={id}
                              className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs"
                            >
                              {label}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
                        <TabsContent value="findings" className="m-0 outline-none">
                          <FindingsPanel
                            findings={expertFindings}
                            loading={expertFindingsLoading}
                            livePollingActive={expertLivePollingActive}
                            onRefresh={() => sessionId && fetchExpertFindings(sessionId)}
                            onSelectPacket={(idx) => {
                              setSelectedPacketIndex(idx);
                              setSidebarPane("details");
                              void loadExactEvidencePacket(idx);
                            }}
                            onInvestigateFinding={(f) => {
                              handleInvestigateFinding(f);
                            }}
                          />
                        </TabsContent>
                        <TabsContent value="stats" className="m-0 outline-none">
                          <LiveStatsPanel
                            stats={liveStats}
                            pipelineStats={pipelineStats}
                            isCapturing={isCapturing}
                          />
                        </TabsContent>
                        <TabsContent value="rtp" className="m-0 outline-none">
                          <div className="flex min-h-[14rem] flex-col overflow-hidden">
                            <LiveRtpQualityPanel sessionId={sessionId} isCapturing={isCapturing} />
                          </div>
                        </TabsContent>
                      </div>
                    </Tabs>
                  )}
                </div>
                </div>
              </>
            )}
          </div>

      <ConfirmDialog open={confirmClearPackets} onOpenChange={setConfirmClearPackets}
        title="Clear all packets?"
        description={`Remove all ${totalPacketCount.toLocaleString()} captured packet${totalPacketCount !== 1 ? "s" : ""} from the view? Annotations will also be cleared. This cannot be undone.`}
        confirmText="Clear All" cancelText="Cancel" variant="destructive" onConfirm={handleClear} />

      <PacketDetailsPopout
        open={detailsPopoutOpen}
        onOpenChange={setDetailsPopoutOpen}
        packet={selectedPacket}
        sessionId={sessionId}
        packetIndex={selectedPacket?.originalIndex ?? selectedPacketIndex}
      />

      {showCaptureFilterDialog && (
        <FilterDialog
          filterConfig={captureFilterConfig}
          onSave={(config) => {
            setCaptureFilterConfig(config);
            setShowCaptureFilterDialog(false);
          }}
          onCancel={() => setShowCaptureFilterDialog(false)}
        />
      )}

      {showExport && (
        <ExportDialog
          open={showExport}
          onOpenChange={setShowExport}
          packets={displayPackets}
          sessionId={sessionId}
          prepareForPcapExport={ensureStoppedForExport}
        />
      )}
    </div>
  );
}

export default PacketMonitorView;
