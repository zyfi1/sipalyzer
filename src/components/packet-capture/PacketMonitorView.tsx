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
  Download,
  PanelRightOpen,
  PanelRightClose,
  Scan,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
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
  exportPcap,
  type LiveStatsSnapshot,
  type PipelineStats,
} from "@/api/packetCapture";

import { UnifiedControlBar } from "./monitor/UnifiedControlBar";
import { WarperPacketList } from "./monitor/WarperPacketList";
import { PacketDetailsView } from "./monitor/PacketDetailsView";
import { LiveStatsPanel } from "./monitor/LiveStatsPanel";
import { CallFlowTab } from "./monitor/CallFlowTab";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PacketDetailsPopout } from "./monitor/PacketDetailsPopout";
import { useOpenCaptureStore } from "@/hooks/useOpenCapture";
import { navigateTo } from "@/lib/navigation";
import { LiveRtpQualityPanel } from "./monitor/LiveRtpQualityPanel";
import { FindingsPanel } from "./monitor/FindingsPanel";
import { ExpertSummaryBar } from "./monitor/ExpertSummaryBar";
import { Badge } from "@/components/ui/badge";
import { subscribeSharedPoll } from "@/lib/sharedPollCoordinator";
import {
  buildFindingDisplayFilter,
  getPrimaryPacketIndex,
} from "@/lib/expertFindingUtils";
import { FilterDialog } from "./FilterDialog";

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
  const [activeTab, setActiveTab] = useState<"details" | "stats" | "flow" | "rtp" | "expert">("details");
  const [popoutTab, setPopoutTab] = useState<"details" | "stats" | "flow" | "rtp" | "expert">("details");
  const [autoScroll, setAutoScroll] = useState(pmSettings.autoScroll);
  const [showMarkedOnly, setShowMarkedOnly] = useState(false);

  useEffect(() => {
    if (detailsPopoutOpen) {
      setPopoutTab(activeTab);
    }
  }, [detailsPopoutOpen, activeTab]);

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
    return activeTab === "stats" ? baseMs : Math.min(baseMs * 2, 5000);
  }, [pmSettings.statsPollIntervalMs, isVisible, isActiveTab, isCapturing, activeTab]);

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

  useEffect(() => {
    if (!isCapturing || !sessionId || !isVisible || !isActiveTab) return;
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
    isVisible,
    isActiveTab,
    wiresharkFilter,
    pmSettings.pageSize,
    adaptivePacketPollIntervalMs,
    pmSettings.packetPollIntervalMs,
    tabId,
    updateTab,
  ]);

  useEffect(() => {
    if (!isCapturing || !sessionId || !isVisible || !isActiveTab) return;
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
  }, [isCapturing, sessionId, isPipelineMode, isVisible, isActiveTab, activeStatsPollIntervalMs]);

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
      notify({ source: "packet-capture", type: "success", title: "Capture Started", description: `Capturing on ${interfaceName || "auto"}` });
    } catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Capture Failed", description: e.message || "Unknown error" }); }
    finally { setIsLoading(false); }
  }, [isPipelineMode, captureFilterConfig, setActiveSession, storeStartCapture, notify, executionContext, tabId, updateTab, showDiagnostics, startExpertLivePolling]);

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

  const handleExportPcap = useCallback(async () => {
    if (!sessionId) return;
    if (isCapturing) {
      try { await storeStopCapture(sessionId); setIsCapturing(false); updateTab(tabId, { isCapturing: false }); }
      catch (e: any) { notify({ source: "packet-capture", type: "error", title: "Stop Failed", description: e.message || "Unknown error" }); return; }
    }
    try { const path = await exportPcap(sessionId); notify({ source: "packet-capture", type: "success", title: "PCAP Exported", description: `Saved to ${path}` }); }
    catch (e: any) { if (!e.message?.includes("cancelled")) notify({ source: "packet-capture", type: "error", title: "Export Failed", description: e.message || "Unknown error" }); }
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
  const handleSelectPacket = useCallback((index: number) => { setSelectedPacketIndex(index); if (!sidebarOpen) setSidebarOpen(true); setActiveTab("details"); }, [sidebarOpen]);
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

    setSidebarOpen(true);
    setWiresharkFilter(suggestedFilter);
    setActiveTab("expert");
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
    if (!showDiagnostics && activeTab === "expert") {
      setActiveTab("details");
    }
  }, [showDiagnostics, activeTab]);

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
  const panelClass = "packet-graphite-panel overflow-hidden rounded-lg";

  const formatRate = (rate: number): string => {
    if (rate >= 1000000) return `${(rate / 1000000).toFixed(1)}M`;
    if (rate >= 1000) return `${(rate / 1000).toFixed(1)}K`;
    return rate.toFixed(0);
  };

  /* ═══════════════════════════════════ RENDER ══════════════════════════════ */
  return (
    <div className="packet-graphite-stage h-full flex flex-col overflow-hidden rounded-lg">
      <div className="flex-1 min-h-0 p-1.5">
        <div className={cn(panelClass, "h-full min-h-0 flex flex-col")}>
          {/* Primary row: Capture controls + filter */}
          <div className="ui-section-header-md flex items-center gap-2 px-3 pt-2 pb-1.5">
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
            />
          </div>

          {/* Secondary row: Actions */}
          <div className="ui-section-header-sm flex items-center gap-2 px-3 py-1.5">
            <div className="inline-flex items-center gap-1">
              <TooltipWrapper content="Re-fetch packets from the capture engine">
                <Button variant="neutral" size="sm" className="gap-1.5 px-2 text-xs"
                  onClick={handleRefresh} disabled={!sessionId || isCapturing}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </TooltipWrapper>
              <TooltipWrapper content="Clear all captured packets from this view">
                <Button variant="destructive" size="sm" className="gap-1.5 px-2.5 text-xs"
                  onClick={() => setConfirmClearPackets(true)} disabled={totalPacketCount === 0}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </Button>
              </TooltipWrapper>
              <div className="h-4 w-px bg-border/55 mx-0.5" />
              <TooltipWrapper content={showMarkedOnly ? "Show all packets" : "Filter to bookmarked packets only"}>
                <Button variant={showMarkedOnly ? "default" : "neutral"} size="sm"
                  className={cn(
                    "gap-1.5 px-2 text-xs",
                    showMarkedOnly
                      ? "bg-warning/15 hover:bg-warning/25 text-warning border border-warning/25"
                      : "",
                  )}
                  onClick={() => setShowMarkedOnly((v) => !v)} disabled={annotatedCount.marked === 0 && !showMarkedOnly}>
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
              </TooltipWrapper>
            </div>

            {isCapturing && (
              <div className="inline-flex h-7 items-center gap-2 rounded-[var(--radius-md)] border border-border/35 bg-muted/18 px-2 text-xs">
                <LiveIndicator variant="badge" label="LIVE" size="xs" />
                <span className="font-mono tabular-nums text-muted-foreground">
                  {totalPacketCount.toLocaleString()} pkts
                </span>
                {liveStats?.packetRate != null && liveStats.packetRate > 0 && (
                  <>
                    <span className="w-px h-3 bg-border/35" />
                    <span className="font-mono tabular-nums text-muted-foreground/70">
                      {formatRate(liveStats.packetRate)}/s
                    </span>
                  </>
                )}
                {isPipelineMode && dropRate > 0.1 && (
                  <span className={cn("font-mono tabular-nums", dropRate >= 5 ? "text-destructive" : dropRate >= 1 ? "text-warning" : "text-muted-foreground/70")}>
                    {dropRate.toFixed(1)}% drop
                  </span>
                )}
              </div>
            )}

            <div className="ml-auto inline-flex items-center gap-1">
              <TooltipWrapper content="Save this capture and open it in the Captures viewer">
                <Button variant="neutral" size="sm" className="gap-1.5 px-2 text-xs"
                  onClick={handleOpenInCaptures} disabled={!hasData}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Open in Captures</span>
                </Button>
              </TooltipWrapper>
              <TooltipWrapper content="Export captured packets as a .pcap file">
                <Button variant="neutral" size="sm" className="gap-1.5 px-2 text-xs"
                  onClick={handleExportPcap} disabled={!hasData}>
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </TooltipWrapper>
              <div className="h-4 w-px bg-border/55 mx-0.5" />
              <TooltipWrapper content={sidebarOpen ? "Collapse details panel" : "Expand details panel"}>
                <Button variant="neutral" size="icon-sm"
                  className={cn(sidebarOpen && "text-primary")}
                  onClick={() => setSidebarOpen(!sidebarOpen)}>
                  {sidebarOpen ? (
                    <PanelRightClose className="h-3.5 w-3.5" />
                  ) : (
                    <PanelRightOpen className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipWrapper>
            </div>
          </div>

          {showDiagnostics && expertFindings.length > 0 && (
            <div className="ui-section-header-sm px-3 py-2">
              <ExpertSummaryBar
                findings={expertFindings}
                onViewAll={() => { setSidebarOpen(true); setActiveTab("expert"); }}
              />
            </div>
          )}

          <div ref={contentSplitRef} className={cn("flex flex-1 min-h-0", sidebarResizing && "cursor-col-resize select-none")}>
            {/* ── Packet list ── */}
            <div className={cn(
              "flex min-w-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,hsl(var(--card)/0.54),hsl(var(--card)/0.40))]",
            )}>
          <WarperPacketList
            packets={displayPackets} selectedIndex={selectedPacketIndex} onSelect={handleSelectPacket}
            autoScroll={autoScroll && isCapturing} onAutoScrollToggle={handleAutoScrollToggle}
            totalCount={showMarkedOnly ? displayPackets.length : totalPacketCount} className="flex-1"
            annotations={annotationsMap} onToggleMark={handleToggleMark} onSetColor={handleSetColor} onClearAnnotation={handleClearAnnotation} />
            </div>

            {/* ── Details sidebar ── */}
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
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col min-h-0">
                  <div className="ui-section-header-sm flex-none h-10 box-border px-2.5 py-0">
                    <div className="flex h-full items-center gap-2">
                    <TabsList className="monitor-side-tabs !h-7 !min-h-7 flex-1">
                      <TabsTrigger value="details" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                        Details
                      </TabsTrigger>
                      <TabsTrigger value="stats" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                        Stats
                      </TabsTrigger>
                      <TabsTrigger value="flow" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                        Flows
                      </TabsTrigger>
                      <TabsTrigger value="rtp" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                        RTP
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
                        onClick={() => setDetailsPopoutOpen(true)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipWrapper>
                    </div>
                  </div>
                  <TabsContent value="details" className="flex-1 m-0 overflow-auto">
                    {selectedPacket ? <PacketDetailsView
                      packet={selectedPacket}
                      sessionId={sessionId}
                      packetIndex={selectedPacket.originalIndex ?? selectedPacketIndex}
                    /> : (
                      <EmptyState
                        variant="inline"
                        icon={<Scan />}
                        title="No packet selected"
                        description="Select a packet row to inspect details and decoded fields."
                        className="h-full p-6"
                      />
                    )}
                  </TabsContent>
                  <TabsContent value="stats" className="flex-1 m-0 overflow-auto">
                    <LiveStatsPanel stats={liveStats} pipelineStats={pipelineStats} isCapturing={isCapturing} />
                  </TabsContent>
                  <TabsContent value="flow" className="flex-1 m-0 overflow-auto">
                    <CallFlowTab
                      packets={packets}
                      onSelectPacket={(packet) => { const idx = packets.indexOf(packet); if (idx >= 0) handleSelectPacket(idx); }}
                      onOpenTabbedPopout={() => {
                        setPopoutTab("flow");
                        setDetailsPopoutOpen(true);
                      }}
                    />
                  </TabsContent>
                  <TabsContent value="rtp" className="flex-1 m-0 overflow-hidden flex flex-col">
                    <LiveRtpQualityPanel sessionId={sessionId} isCapturing={isCapturing} />
                  </TabsContent>
                  {showDiagnostics && (
                    <TabsContent value="expert" className="flex-1 m-0 overflow-auto">
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex-1 min-h-0 overflow-auto">
                          <FindingsPanel
                            findings={expertFindings}
                            loading={expertFindingsLoading}
                            livePollingActive={expertLivePollingActive}
                            onRefresh={() => sessionId && fetchExpertFindings(sessionId)}
                            onSelectPacket={(idx) => {
                              setSelectedPacketIndex(idx);
                              void loadExactEvidencePacket(idx);
                            }}
                            onInvestigateFinding={handleInvestigateFinding}
                          />
                        </div>
                      </div>
                    </TabsContent>
                  )}
                </Tabs>
                </div>
              </>
            )}
          </div>
        </div>
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
                <TabsTrigger value="flow" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                  Flows
                </TabsTrigger>
                <TabsTrigger value="rtp" className="monitor-side-tab !h-7 !min-h-7 px-3 text-xs">
                  RTP
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
                sessionId={sessionId}
                packetIndex={selectedPacket?.originalIndex ?? selectedPacketIndex}
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
          </TabsContent>
          <TabsContent value="stats" className="flex-1 m-0 overflow-auto">
            <LiveStatsPanel stats={liveStats} pipelineStats={pipelineStats} isCapturing={isCapturing} />
          </TabsContent>
          <TabsContent value="flow" className="flex-1 m-0 overflow-auto">
            <CallFlowTab
              packets={packets}
              onSelectPacket={(packet) => { const idx = packets.indexOf(packet); if (idx >= 0) handleSelectPacket(idx); }}
              onOpenTabbedPopout={() => {
                setPopoutTab("flow");
                setDetailsPopoutOpen(true);
              }}
            />
          </TabsContent>
          <TabsContent value="rtp" className="flex-1 m-0 overflow-hidden flex flex-col">
            <LiveRtpQualityPanel sessionId={sessionId} isCapturing={isCapturing} />
          </TabsContent>
          {showDiagnostics && (
            <TabsContent value="expert" className="flex-1 m-0 overflow-auto">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex-1 min-h-0 overflow-auto">
                  <FindingsPanel
                    findings={expertFindings}
                    loading={expertFindingsLoading}
                    livePollingActive={expertLivePollingActive}
                    onRefresh={() => sessionId && fetchExpertFindings(sessionId)}
                    onSelectPacket={(idx) => {
                      setSelectedPacketIndex(idx);
                      void loadExactEvidencePacket(idx);
                    }}
                    onInvestigateFinding={handleInvestigateFinding}
                  />
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </PacketDetailsPopout>

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
    </div>
  );
}

export default PacketMonitorView;
