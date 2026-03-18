/**
 * CaptureViewer - Dedicated full-featured viewer for saved capture sessions.
 * 
 * Features:
 * - High-performance packet list with virtualization
 * - Packet details view with protocol decode
 * - Wireshark-style filter bar
 * - Statistics dashboard
 * - Export to PCAP functionality
 * - SIP call flow visualization
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Download,
  ArrowLeft,
  Loader2,
  ChevronDown,
} from "@/lib/icons";
import { format } from "date-fns";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import type { CaptureSession, PacketInfo, ExpertFinding } from "@/types/packetCapture";
import { getCaptureSession, getFilteredPackets, exportPcap } from "@/api/packetCapture";
import { PacketListView } from "./monitor/PacketListView";
import { PacketDetailsView } from "./monitor/PacketDetailsView";
import { StatisticsDashboard } from "./monitor/StatisticsDashboard";
import { SipCallFlow } from "./monitor/SipCallFlow";
import { WiresharkFilterBar } from "./monitor/WiresharkFilterBar";
import { FindingsPanel } from "./monitor/FindingsPanel";
import { EmptyState } from "@/components/ui/empty-state";
import {
  buildFindingDisplayFilter,
} from "@/lib/expertFindingUtils";
import { getAnalysisDiagnostics } from "@/lib/diagnostics/query";
import { useNotifications } from "@/hooks/useNotifications";
import { useOpenCaptureStore } from "@/hooks/useOpenCapture";
import { navigateTo } from "@/lib/navigation";

interface CaptureViewerProps {
  sessionId: string;
  onBack?: () => void;
  initialFilter?: string;
  highlightPacketId?: string;
}

/** Get a unique identifier for a packet */
function getPacketId(packet: PacketInfo): string {
  return `${packet.timestamp}-${packet.srcIp}-${packet.dstIp}-${packet.srcPort}-${packet.dstPort}-${packet.size}`;
}

export function CaptureViewer({
  sessionId,
  onBack,
  initialFilter = "",
  highlightPacketId,
}: CaptureViewerProps) {
  const { notify } = useNotifications();
  // Session state
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Packet data state
  const [packets, setPackets] = useState<PacketInfo[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [packetsLoading, setPacketsLoading] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);
  const PACKET_PAGE_SIZE = 1000;

  // Filter state
  const [filterExpression, setFilterExpression] = useState(initialFilter);
  const [appliedFilter, setAppliedFilter] = useState(initialFilter);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selection state
  const [selectedPacketIndex, setSelectedPacketIndex] = useState<number | null>(null);
  const [selectedPacket, setSelectedPacket] = useState<PacketInfo | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<"packets" | "statistics" | "flows" | "expert">("packets");

  // Expert findings
  const [expertFindings, setExpertFindings] = useState<ExpertFinding[]>([]);
  const [expertLoading, setExpertLoading] = useState(false);

  // Abort controller for fetch requests
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Load session metadata
  useEffect(() => {
    let mounted = true;
    setSessionLoading(true);
    setSessionError(null);

    getCaptureSession(sessionId)
      .then((s) => {
        if (mounted) {
          setSession(s);
          setSessionLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          setSessionError(e.message || "Failed to load session");
          setSessionLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [sessionId]);

  // Load expert findings
  useEffect(() => {
    setExpertLoading(true);
    getAnalysisDiagnostics(sessionId)
      .then(setExpertFindings)
      .catch(() => setExpertFindings([]))
      .finally(() => setExpertLoading(false));
  }, [sessionId]);

  // Load packets with filter
  const loadPackets = useCallback(async (offset = 0) => {
    // Cancel previous request
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = new AbortController();

    setPacketsLoading(true);
    try {
      const result = await getFilteredPackets(sessionId, {
        filterExpression: appliedFilter || undefined,
        offset,
        limit: PACKET_PAGE_SIZE,
      });
      
      if (offset === 0) {
        setPackets(result.packets);
      } else {
        setPackets((prev) => [...prev, ...result.packets]);
      }
      setTotalCount(result.totalCount);
      setCurrentOffset(offset);
    } catch (e) {
      console.error("Failed to load packets:", e);
    } finally {
      setPacketsLoading(false);
    }
  }, [sessionId, appliedFilter]);

  // Load initial packets
  useEffect(() => {
    if (session) {
      loadPackets(0);
    }
  }, [session, loadPackets]);


  // Handle packet selection
  const handleSelectPacket = useCallback((index: number) => {
    setSelectedPacketIndex(index);
    const packet = packets[index];
    setSelectedPacket(packet ?? null);
  }, [packets]);

  // Handle load more packets
  const handleLoadMore = useCallback(() => {
    if (packets.length < totalCount && !packetsLoading) {
      loadPackets(currentOffset + PACKET_PAGE_SIZE);
    }
  }, [packets.length, totalCount, packetsLoading, loadPackets, currentOffset]);

  // Handle export
  const handleExport = useCallback(async () => {
    if (!session) return;
    
    try {
      const result = await exportPcap(sessionId);
      console.log("Exported to:", result);
    } catch (e) {
      console.error("Export failed:", e);
    }
  }, [sessionId, session]);

  const loadExactEvidencePacket = useCallback(async (packetIndex: number) => {
    if (packetIndex < 0) return;
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

  // Highlight initial packet when packets load
  useEffect(() => {
    if (highlightPacketId && packets.length > 0 && selectedPacketIndex === null) {
      const index = packets.findIndex((p) => getPacketId(p) === highlightPacketId);
      if (index >= 0) {
        setSelectedPacketIndex(index);
        const packet = packets[index];
        if (packet) {
          setSelectedPacket(packet);
        }
      }
    }
  }, [highlightPacketId, packets, selectedPacketIndex]);

  // Loading state
  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (sessionError || !session) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-destructive">{sessionError || "Session not found"}</p>
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4">
      {/* ── Single cohesive island: header + filter + tabs + content ── */}
      <div className="ui-surface-card flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div className="ui-section-header-sm flex-none flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <TooltipWrapper entry={tooltips.captureBack}>
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs shrink-0" onClick={onBack}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              </TooltipWrapper>
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">{session.name}</h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TooltipWrapper entry={tooltips.statInterface}>
                  <span className="cursor-help">{session.interface}</span>
                </TooltipWrapper>
                <span>&bull;</span>
                <TooltipWrapper entry={tooltips.statTotalPackets}>
                  <span className="cursor-help">{session.packetCount.toLocaleString()} packets</span>
                </TooltipWrapper>
                <span>&bull;</span>
                <span>{format(new Date(session.startTime), "MMM d, yyyy HH:mm")}</span>
                <Badge variant={session.status === "Running" ? "default" : "secondary"} className="text-2xs px-1.5 py-0 h-4">
                  {session.status}
                </Badge>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <TooltipWrapper entry={tooltips.captureExportPcap}>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export PCAP
              </Button>
            </TooltipWrapper>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="ui-section-header-sm flex-none px-3 py-1.5">
          <WiresharkFilterBar
            filter={filterExpression}
            onFilterChange={(value) => {
              setFilterExpression(value);
              setSelectedPacketIndex(null);
              setSelectedPacket(null);
              // Debounce the backend filter call
              if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
              filterDebounceRef.current = setTimeout(() => {
                setAppliedFilter(value);
                setCurrentOffset(0);
              }, 250);
            }}
            filteredCount={totalCount}
            matchLabel="packets"
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col min-h-0">
          <div className="ui-section-header-sm flex-none compact-tab-row">
            <TabsList className="subview-tabs-compact">
              <TooltipWrapper entry={tooltips.captureTabPackets}>
                <TabsTrigger value="packets" className="subview-tab-compact">
                  Packets
                </TabsTrigger>
              </TooltipWrapper>
              <TooltipWrapper entry={tooltips.captureTabStatistics}>
                <TabsTrigger value="statistics" className="subview-tab-compact">
                  Statistics
                </TabsTrigger>
              </TooltipWrapper>
              <TooltipWrapper entry={tooltips.captureTabCallFlows}>
                <TabsTrigger value="flows" className="subview-tab-compact">
                  Call Flows
                </TabsTrigger>
              </TooltipWrapper>
              <TabsTrigger value="expert" className="subview-tab-compact">
                Diagnostics
                {expertFindings.length > 0 && (
                  <Badge
                    variant={expertFindings.some(f => f.severity === "critical") ? "destructive" : "secondary"}
                    className="text-3xs px-1 py-0 h-3.5 min-w-[14px] ml-1"
                  >
                    {expertFindings.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Packets Tab */}
          <TabsContent value="packets" className="flex-1 m-0 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
              {/* Packet List */}
              <div className="flex-1 min-h-0 flex flex-col border-r border-border/50">
                <div className="flex-1 min-h-0">
                  <PacketListView
                    packets={packets}
                    selectedPacketIndex={selectedPacketIndex}
                    onSelectPacket={handleSelectPacket}
                    autoScroll={false}
                  />
                </div>
                {packets.length < totalCount && (
                  <div className="flex-none flex justify-center border-t border-border/50 bg-muted/15 p-2">
                    <TooltipWrapper entry={tooltips.captureLoadMore}>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleLoadMore}
                      disabled={packetsLoading}
                    >
                      {packetsLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <ChevronDown className="h-4 w-4 mr-2" />
                      )}
                      Load More ({(totalCount - packets.length).toLocaleString()} remaining)
                    </Button>
                    </TooltipWrapper>
                  </div>
                )}
              </div>
              
              {/* Packet Details */}
              <div className="h-64 overflow-auto border-t border-border/35 bg-transparent lg:h-auto lg:w-[400px] lg:border-t-0 xl:w-[500px]">
                {selectedPacket ? (
                  <PacketDetailsView
                    packet={selectedPacket}
                    sessionId={sessionId}
                    packetIndex={selectedPacket.originalIndex ?? selectedPacketIndex}
                  />
                ) : (
                  <EmptyState compact variant="inline" title="Select a packet to view details" />
                )}
              </div>
            </div>
          </TabsContent>

          {/* Statistics Tab */}
          <TabsContent value="statistics" className="flex-1 m-0 min-h-0 p-6 overflow-auto">
            <StatisticsDashboard packets={packets} />
          </TabsContent>

          {/* Flows Tab */}
          <TabsContent value="flows" className="flex-1 m-0 min-h-0">
            <SipCallFlow 
              packets={packets.filter((p) => p.protocol === "SIP")} 
            />
          </TabsContent>

          <TabsContent value="expert" className="flex-1 m-0 overflow-auto">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex-1 min-h-0 overflow-auto">
                <FindingsPanel
                  findings={expertFindings}
                  loading={expertLoading}
                  onRefresh={async () => {
                    setExpertLoading(true);
                    try {
                      const f = await getAnalysisDiagnostics(sessionId);
                      setExpertFindings(f);
                    } catch {} finally { setExpertLoading(false); }
                  }}
                  onSelectPacket={(idx) => {
                    setSelectedPacketIndex(idx);
                    void loadExactEvidencePacket(idx);
                  }}
                  onInvestigateFinding={(finding) => {
                    const nextFilter = buildFindingDisplayFilter(finding);
                    useOpenCaptureStore.getState().openViewer(sessionId, undefined, { filter: nextFilter });
                    navigateTo("packet-capture", "viewer");
                    notify({
                      source: "packet-capture",
                      type: "info",
                      title: "Opened Packet Viewer",
                      description: "Showing related packets in Packet Viewer.",
                    });
                  }}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default CaptureViewer;
