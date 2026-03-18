import { useState, useEffect, useMemo, useRef, useCallback, startTransition, useDeferredValue } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import {
  getFilteredPackets,
  FILTERED_PAGE_SIZE,
} from "@/api/packetCapture";
import { useNotifications } from "@/hooks/useNotifications";
import { MonitorToolbar } from "./monitor/MonitorToolbar";
import { MonitorLayout } from "./monitor/MonitorLayout";
import { ExportDialog } from "./monitor/ExportDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { PacketInfo, FilterConfig } from "@/types/packetCapture";

import { UnifiedControlBar } from "./monitor/UnifiedControlBar";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useToolVisible } from "@/hooks/useToolVisible";
import { FileText, Radio } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RawPacketMonitor() {
  // Use selectors to prevent unnecessary re-renders
  const interfaces = usePacketCaptureStore((state) => state.interfaces);
  const fetchInterfaces = usePacketCaptureStore((state) => state.fetchInterfaces);
  const startCapture = usePacketCaptureStore((state) => state.startCapture);
  const stopCapture = usePacketCaptureStore((state) => state.stopCapture);
  const activeSessionId = usePacketCaptureStore((state) => state.activeSessionId);
  const isCapturing = usePacketCaptureStore((state) => state.isCapturing);
  const runningSessionIds = usePacketCaptureStore((state) => state.runningSessionIds);
  const sessions = usePacketCaptureStore((state) => state.sessions);
  const setActiveSession = usePacketCaptureStore((state) => state.setActiveSession);
  const captureSessionOpenRequestId = usePacketCaptureStore((state) => state.captureSessionOpenRequestId);
  const clearCaptureSessionOpenRequest = usePacketCaptureStore((state) => state.clearCaptureSessionOpenRequest);
  
  // Persistent UI state from store
  const wiresharkFilter = usePacketCaptureStore((state) => state.wiresharkFilter);
  const setWiresharkFilter = usePacketCaptureStore((state) => state.setWiresharkFilter);
  const selectPacketBySip = usePacketCaptureStore((state) => state.selectPacketBySip);
  const setSelectPacketBySip = usePacketCaptureStore((state) => state.setSelectPacketBySip);
  const isVisible = useToolVisible("packet-capture");

  const { notify } = useNotifications();

  // Packet display state - now using server-side filtering/pagination
  const [packets, setPackets] = useState<PacketInfo[]>([]);
  const [totalPacketCount, setTotalPacketCount] = useState<number>(0);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  
  // Page size for server-side pagination
  const PAGE_SIZE = FILTERED_PAGE_SIZE;
  
  // AbortController for cancellable packet fetches
  const fetchAbortControllerRef = useRef<AbortController | null>(null);
  
  // Selected packet by unique ID (timestamp + flow tuple) instead of index
  // This prevents losing selection when filter changes or data refreshes
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  
  // Helper to generate unique packet ID from packet attributes
  const getPacketId = useCallback((packet: PacketInfo): string => {
    // Combine timestamp with flow tuple for a reasonably unique ID
    return `${packet.timestamp}_${packet.srcIp}:${packet.srcPort}_${packet.dstIp}:${packet.dstPort}_${packet.size}`;
  }, []);

  // Build capture filter config - SIP/RTP are primarily UDP; empty = capture all (INVITE, BYE, RTP included)
  const filterConfig = useMemo<FilterConfig>(() => ({
    protocols: [], // Empty = capture all (UDP SIP/RTP and TCP if used)
    srcIpRanges: [],
    dstIpRanges: [],
    srcPorts: [],
    dstPorts: [],
    portRanges: [],
  }), []);
  const [autoScroll, setAutoScroll] = useState(false);
  // selectedPacketIndex is now derived from selectedPacketId for backward compatibility
  const selectedPacketIndex = useMemo(() => {
    if (!selectedPacketId || packets.length === 0) return null;
    const idx = packets.findIndex(p => getPacketId(p) === selectedPacketId);
    return idx >= 0 ? idx : null;
  }, [selectedPacketId, packets, getPacketId]);
  
  // Setter that converts index to packet ID
  const setSelectedPacketIndex = useCallback((index: number | null) => {
    if (index === null || index < 0 || index >= packets.length) {
      setSelectedPacketId(null);
    } else {
      const packet = packets[index];
      if (packet) {
        setSelectedPacketId(getPacketId(packet));
      }
    }
  }, [packets, getPacketId]);
  
  const [showDetails, setShowDetails] = useState(true);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [panelPosition, setPanelPosition] = useState<"left" | "right" | "bottom" | "top" | "hidden">("right");
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [isReadOnlyMode, setIsReadOnlyMode] = useState(false);
  const openCaptureFilters = useCallback(() => {
    notify({
      source: "packet-capture",
      type: "info",
      title: "Capture rules",
      description: "Capture rule editing is not available in raw monitor mode.",
    });
  }, [notify]);
  const captureFilterSummary = "Capturing all protocols, IPs, and ports";

  // Load capture session using server-side filtering
  const loadCaptureSession = useCallback(
    async (sessionId: string) => {
      try {
        setIsReadOnlyMode(true);
        setLoadedSessionId(sessionId);
        setIsLoading(true);
        setCurrentOffset(0);
        
        // Use server-side filtering - filter is applied on backend
        const result = await getFilteredPackets(sessionId, {
          filterExpression: wiresharkFilter.trim() || undefined,
          offset: 0,
          limit: PAGE_SIZE,
        });
        
        setTotalPacketCount(result.totalCount);
        startTransition(() => setPackets(result.packets));
        
        notify({ source: "packet-capture",
          type: "success",
          title: "Capture Loaded",
          description: `Showing ${result.packets.length} of ${result.totalCount.toLocaleString()} packets`,
        });
      } catch (error: any) {
        notify({ source: "packet-capture",
          type: "error",
          title: "Failed to Load Capture",
          description: error.message || "Unknown error",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [notify, wiresharkFilter, PAGE_SIZE]
  );

  useEffect(() => {
    if (!captureSessionOpenRequestId) return;
    void loadCaptureSession(captureSessionOpenRequestId).finally(() => {
      clearCaptureSessionOpenRequest();
    });
  }, [captureSessionOpenRequestId, clearCaptureSessionOpenRequest, loadCaptureSession]);

  // On mount, clear any previous packets and filter state to reduce lag on app startup
  useEffect(() => {
    startTransition(() => setPackets([]));
    setSelectedPacketId(null);
    setTotalPacketCount(0);
    setCurrentOffset(0);
    lastPacketCountRef.current = 0;
    lastBackendTotalRef.current = null;
    lastPacketTimestampRef.current = null;
  }, []);

  // Interfaces are fetched by PacketCaptureTool on mount (deferred) to avoid lag when switching view

  // Interface auto-selection is now handled internally by UnifiedControlBar

  // Track last packet count and backend total to optimize updates
  const lastPacketCountRef = useRef(0);
  const lastBackendTotalRef = useRef<number | null>(null);
  const lastPacketTimestampRef = useRef<string | null>(null);

  // Manual refresh function
  const handleRefresh = useCallback(async () => {
    if (!activeSessionId) {
      notify({ source: "packet-capture",
        type: "info",
        title: "No Active Session",
        description: "No capture session is active",
      });
      return;
    }

    try {
      setIsLoading(true);
      const result = await getFilteredPackets(activeSessionId, {
        filterExpression: wiresharkFilter.trim() || undefined,
        offset: currentOffset,
        limit: PAGE_SIZE,
      });

      if (result.packets.length > 0) {
        lastPacketCountRef.current = result.totalCount;
        const lastP = result.packets[result.packets.length - 1];
        if (lastP) lastPacketTimestampRef.current = lastP.timestamp;
        setTotalPacketCount(result.totalCount);
        startTransition(() => setPackets(result.packets));
        notify({ source: "packet-capture",
          type: "success",
          title: "Refreshed",
          description: `Showing ${result.packets.length} of ${result.totalCount} packets`,
        });
      } else {
        notify({ source: "packet-capture",
          type: "info",
          title: "No Packets",
          description: "No packets match the current filter",
        });
      }
    } catch (error) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Refresh Failed",
        description: error instanceof Error ? error.message : "Failed to refresh packets",
      });
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId, notify, wiresharkFilter, currentOffset, PAGE_SIZE]);

  // Manual clear function
  const handleClear = useCallback(() => {
    startTransition(() => setPackets([]));
    setSelectedPacketId(null);
    setTotalPacketCount(0);
    setCurrentOffset(0);
    lastPacketCountRef.current = 0;
    lastBackendTotalRef.current = null;
    lastPacketTimestampRef.current = null;
    notify({ source: "packet-capture",
      type: "success",
      title: "Cleared",
      description: "All packets cleared from view",
    });
  }, [notify]);

  // Defer filter so typing stays responsive
  const wiresharkFilterTrimmed = useMemo(() => wiresharkFilter.trim(), [wiresharkFilter]);
  const deferredFilter = useDeferredValue(wiresharkFilterTrimmed);

  // Track the last filter to reset offset when filter changes
  const lastAppliedFilterRef = useRef<string>("");
  const lastFetchedFilterRef = useRef<string>("");
  
  // Reset offset to 0 when filter changes (before the fetch)
  useEffect(() => {
    if (deferredFilter !== lastAppliedFilterRef.current) {
      console.log("[RawPacketMonitor] Filter changed, resetting offset to 0");
      lastAppliedFilterRef.current = deferredFilter;
      setCurrentOffset(0);
    }
  }, [deferredFilter]);
  
  // Main data fetching effect - uses server-side filtering with AbortController
  useEffect(() => {
    if (!activeSessionId) return;

    // Cancel any in-flight request
    if (fetchAbortControllerRef.current) {
      fetchAbortControllerRef.current.abort();
    }
    fetchAbortControllerRef.current = new AbortController();
    const abortSignal = fetchAbortControllerRef.current.signal;
    
    const sid = activeSessionId;
    const filterExpr = deferredFilter || undefined;
    
    const fetchPackets = async () => {
      // Don't set loading for polling updates during live capture
      const isInitialFetch = lastFetchedFilterRef.current !== deferredFilter;
      if (isInitialFetch) {
        setIsLoading(true);
      }
      
      try {
        const result = await getFilteredPackets(sid, {
          filterExpression: filterExpr,
          offset: currentOffset,
          limit: PAGE_SIZE,
        });
        
        // Check if request was aborted
        if (abortSignal.aborted) return;
        
        const newCount = result.totalCount;
        const lastPacket = result.packets[result.packets.length - 1];
        const lastTimestamp = lastPacket?.timestamp;
        
        // Only update if data actually changed
        if (
          newCount !== lastPacketCountRef.current ||
          lastTimestamp !== lastPacketTimestampRef.current ||
          deferredFilter !== lastFetchedFilterRef.current
        ) {
          lastPacketCountRef.current = newCount;
          lastPacketTimestampRef.current = lastTimestamp ?? null;
          lastFetchedFilterRef.current = deferredFilter;
          setTotalPacketCount(newCount);
          startTransition(() => setPackets(result.packets));
        }
      } catch (error) {
        if (!abortSignal.aborted) {
          console.error(`[RawPacketMonitor] Error fetching packets:`, error);
        }
      } finally {
        if (!abortSignal.aborted) {
          setIsLoading(false);
        }
      }
    };

    // Only fetch/poll when visible
    if (isVisible) {
      fetchPackets();
    }
    
    // Poll during live capture only when visible
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isCapturing && isVisible) {
      interval = setInterval(fetchPackets, 2000);
    }

    return () => {
      if (fetchAbortControllerRef.current) {
        fetchAbortControllerRef.current.abort();
      }
      if (interval) clearInterval(interval);
    };
  }, [activeSessionId, isCapturing, deferredFilter, currentOffset, PAGE_SIZE, isVisible]);

  // Request more packets when scrolling (for pagination)
  const onRequestMorePackets = useCallback((newOffset: number) => {
    setCurrentOffset(newOffset);
  }, []);

  // Packets are now filtered server-side, so filteredPackets = packets
  const filteredPackets = packets;

  // Note: We no longer need to clear selected packet when filter changes
  // because we now store by ID and it will naturally resolve to null
  // if the packet is no longer in the filtered list

  // When softphone Events timeline requests a packet by SIP method/code, select first matching packet
  useEffect(() => {
    if (!selectPacketBySip || filteredPackets.length === 0) return;
    const { methodOrCode, cseq } = selectPacketBySip;
    const idx = filteredPackets.findIndex((p) => {
      const app = p.decoded?.application;
      if (!app || app.type !== "Sip") return false;
      const sip = app.data;
      const methodMatch = sip.method === methodOrCode;
      const codeMatch = sip.responseCode != null && String(sip.responseCode) === methodOrCode;
      const cseqMatch = !cseq || (sip.cseq != null && (sip.cseq.startsWith(cseq + " ") || sip.cseq.includes(cseq)));
      return (methodMatch || codeMatch) && cseqMatch;
    });
    if (idx >= 0) {
      setSelectedPacketIndex(idx);
      notify({ source: "packet-capture",
        type: "info",
        title: "Packet selected",
        description: `Selected SIP ${methodOrCode}${cseq ? ` (CSeq ${cseq})` : ""} in packet list`,
      });
    }
    setSelectPacketBySip(null);
  }, [selectPacketBySip, filteredPackets, setSelectPacketBySip, notify]);

  const handleStart = async (interfaceToUse: string) => {
    if (!interfaceToUse) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Error",
        description: "No network interface available. Check network and refresh.",
      });
      return;
    }

    try {
      console.log(`[RawPacketMonitor] Starting capture on interface: ${interfaceToUse}`);
      
      // Reset state for new live capture - exit read-only mode and clear old data
      setIsReadOnlyMode(false);
      setLoadedSessionId(null);
      startTransition(() => setPackets([]));
      setSelectedPacketId(null);
      setTotalPacketCount(0);
      setCurrentOffset(0);
      lastPacketCountRef.current = 0;
      lastBackendTotalRef.current = null;
      lastPacketTimestampRef.current = null;
      lastAppliedFilterRef.current = "";
      lastFetchedFilterRef.current = "";
      
      const sessionName = `Packet Capture`;
      const ctx = useExecutionContextStore.getState().resolvedContext("packetCapture");
      const sessionId = await startCapture(sessionName, null, interfaceToUse, filterConfig, ctx);
      console.log(`[RawPacketMonitor] Capture started with session ID: ${sessionId}`);
      notify({ source: "packet-capture",
        type: "success",
        title: "Capture Started",
        description: `Started capturing on ${interfaceToUse}`,
      });
    } catch (error: any) {
      console.error(`[RawPacketMonitor] Failed to start capture:`, error);
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed to Start Capture",
        description: error.message || "Unknown error",
      });
    }
  };

  const handleStop = async () => {
    if (!activeSessionId) return;

    try {
      await stopCapture(activeSessionId);
      notify({ source: "packet-capture",
        type: "success",
        title: "Capture Stopped",
        description: "Packet capture has been stopped",
      });
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed to Stop Capture",
        description: error.message || "Unknown error",
      });
    }
  };




  // Keyboard shortcuts
  useKeyboardShortcuts({
    "ctrl+f": (e) => {
      e.preventDefault();
      // Focus search - handled by input auto-focus
    },
    "ctrl+e": (e) => {
      e.preventDefault();
      if (filteredPackets.length > 0) {
        setShowExportDialog(true);
      }
    },
    "arrowdown": (e) => {
      if (selectedPacketIndex !== null && selectedPacketIndex < filteredPackets.length - 1) {
        e.preventDefault();
        setSelectedPacketIndex(selectedPacketIndex + 1);
      }
    },
    "arrowup": (e) => {
      if (selectedPacketIndex !== null && selectedPacketIndex > 0) {
        e.preventDefault();
        setSelectedPacketIndex(selectedPacketIndex - 1);
      }
    },
    "enter": (e) => {
      if (selectedPacketIndex !== null) {
        e.preventDefault();
        setShowDetails(true);
      }
    },
    "escape": (e) => {
      if (showDetails) {
        e.preventDefault();
        setSelectedPacketIndex(null);
      }
    },
  });

  return (
    <div className="surface-subtle flex w-full min-h-0 flex-col gap-2 rounded-lg p-1.5" style={{ minHeight: "calc(100vh - 280px)" }}>
      {/* Read-only mode indicator */}
      {isReadOnlyMode && loadedSessionId && (
        <Card className="ui-panel-shell shrink-0 rounded-lg">
          <CardContent className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-foreground shrink-0" />
              <span className="text-sm font-medium">
                Viewing saved capture (read-only)
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsReadOnlyMode(false);
                setLoadedSessionId(null);
                startTransition(() => setPackets([]));
              }}
            >
              Return to live capture
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Session selector when multiple captures are running */}
      {runningSessionIds.length > 1 && isCapturing && (
        <Card className="ui-panel-shell shrink-0 rounded-lg">
          <CardContent className="flex items-center gap-2 px-3 py-2">
            <Radio className="h-4 w-4 text-success shrink-0" />
            <span className="text-sm text-muted-foreground shrink-0">View session:</span>
            <Select
              value={activeSessionId ?? ""}
              onValueChange={(id) => setActiveSession(id || null)}
            >
              <SelectTrigger className="h-8 w-[220px] text-sm">
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                {runningSessionIds.map((id) => {
                  const session = sessions.find((s) => s.id === id);
                  return (
                    <SelectItem key={id} value={id}>
                      {session?.name ?? id.slice(0, 8)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {/* Unified Control Bar */}
      <UnifiedControlBar
        interfaces={interfaces}
        onRefreshInterfaces={fetchInterfaces}
        executionContext={useExecutionContextStore.getState().resolvedContext("packetCapture")}
        isCapturing={isCapturing}
        onStart={handleStart}
        onStop={handleStop}
        onOpenCaptureFilters={openCaptureFilters}
        activeCaptureFilterCount={0}
        captureFilterSummary={captureFilterSummary}
        wiresharkFilter={wiresharkFilter}
        onWiresharkFilterChange={setWiresharkFilter}
        filteredCount={filteredPackets.length}
      />

      {/* Main Monitor Area - default view */}
      <Card className="ui-panel-shell flex min-h-[420px] w-full flex-1 flex-col overflow-hidden rounded-lg">
          <div className="surface-subtle border-b border-border/40">
          <MonitorToolbar
            autoScroll={autoScroll}
            onAutoScrollToggle={() => setAutoScroll(!autoScroll)}
            packetCount={filteredPackets.length}
            totalPacketCount={totalPacketCount}
            onExport={() => setShowExportDialog(true)}
            onRefresh={handleRefresh}
            onClear={handleClear}
            panelPosition={panelPosition}
            onPanelPositionChange={setPanelPosition}
          />
          </div>

          <div className="flex min-h-0 w-full flex-1 overflow-hidden p-1.5">
            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
              <MonitorLayout
                packets={filteredPackets}
                selectedPacketIndex={selectedPacketIndex}
                onSelectPacket={setSelectedPacketIndex}
                autoScroll={autoScroll}
                showDetails={panelPosition !== "hidden"}
                panelPosition={panelPosition}
                totalPacketCount={totalPacketCount > filteredPackets.length ? totalPacketCount : null}
                windowStart={currentOffset}
                onRequestWindow={onRequestMorePackets}
                isLoading={isLoading}
              />
          </div>
        </div>
      </Card>

      {showExportDialog && (
        <ExportDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          packets={filteredPackets}
          sessionId={activeSessionId}
        />
      )}
    </div>
  );
}
