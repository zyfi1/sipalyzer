/**
 * Modal component for quick viewing of captured packets.
 * 
 * Opens as a modal overlay for viewing saved captures without
 * disrupting the live packet monitor.
 */

import { useState, useEffect, useCallback, useMemo, startTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, X, Download, Filter, ChevronDown } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { tooltips } from "@/lib/tooltips";
import { WarperPacketList } from "./monitor/WarperPacketList";
import { PacketDetailsView } from "./monitor/PacketDetailsView";
import { getFilteredPackets, exportPcap, FILTERED_PAGE_SIZE } from "@/api/packetCapture";
import type { PacketInfo, CaptureSession } from "@/types/packetCapture";
import { usePacketAnnotationStore, type PacketAnnotation, type PacketColorId } from "@/stores/packetAnnotationStore";
import { formatTimestampCompact } from "@/lib/dateTime";
import { useNotifications } from "@/hooks/useNotifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface PacketViewerModalProps {
  /** The session ID to view. */
  sessionId: string;
  /** Session metadata (optional, for display). */
  session?: CaptureSession;
  /** Whether the modal is open. */
  open: boolean;
  /** Callback when the modal should close. */
  onClose: () => void;
  /** Initial filter expression. */
  initialFilter?: string;
  /** Packet ID to highlight initially. */
  highlightPacketId?: string;
}

export function PacketViewerModal({
  sessionId,
  session,
  open,
  onClose,
  initialFilter = "",
  highlightPacketId,
}: PacketViewerModalProps) {
  const { notify } = useNotifications();
  const annotationStore = usePacketAnnotationStore();
  
  // Local state
  const [packets, setPackets] = useState<PacketInfo[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [filterInput, setFilterInput] = useState(initialFilter);
  const [appliedFilter, setAppliedFilter] = useState(initialFilter);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const annotationsMap = useMemo<Record<number, PacketAnnotation>>(() => {
    const map: Record<number, PacketAnnotation> = {};
    const prefix = `${sessionId}::`;
    for (const [key, annotation] of Object.entries(annotationStore.annotations)) {
      if (!key.startsWith(prefix)) continue;
      const idx = parseInt(key.slice(prefix.length), 10);
      if (Number.isNaN(idx)) continue;
      map[idx] = annotation;
    }
    return map;
  }, [annotationStore.annotations, sessionId]);
  
  // Derive selected packet
  const selectedPacket = useMemo(() => {
    if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= packets.length) {
      return null;
    }
    return packets[selectedIndex];
  }, [selectedIndex, packets]);

  // Load packets when modal opens or filter changes
  useEffect(() => {
    if (!open || !sessionId) return;
    
    let cancelled = false;
    
    const loadPackets = async () => {
      setIsLoading(true);
      try {
        const result = await getFilteredPackets(sessionId, {
          filterExpression: appliedFilter.trim() || undefined,
          offset: currentOffset,
          limit: FILTERED_PAGE_SIZE,
        });
        
        if (cancelled) return;
        
        startTransition(() => {
          setPackets(result.packets);
          setTotalCount(result.totalCount);
        });
        
        // Find and select the highlighted packet if specified
        if (highlightPacketId && currentOffset === 0) {
          const idx = result.packets.findIndex((p) => 
            `${p.timestamp}_${p.srcIp}:${p.srcPort}_${p.dstIp}:${p.dstPort}_${p.size}` === highlightPacketId
          );
          if (idx >= 0) {
            setSelectedIndex(idx);
          }
        }
      } catch (error) {
        console.error("[PacketViewerModal] Failed to load packets:", error);
        if (!cancelled) {
          notify({ source: "packet-capture",
            type: "error",
            title: "Failed to Load",
            description: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    
    loadPackets();
    
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, appliedFilter, currentOffset, highlightPacketId, notify]);

  // Handle filter apply
  const handleApplyFilter = useCallback(() => {
    setAppliedFilter(filterInput);
    setCurrentOffset(0);
    setSelectedIndex(null);
  }, [filterInput]);

  // Handle filter key press
  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApplyFilter();
    }
  }, [handleApplyFilter]);

  // Handle clear filter
  const handleClearFilter = useCallback(() => {
    setFilterInput("");
    setAppliedFilter("");
    setCurrentOffset(0);
    setSelectedIndex(null);
  }, []);

  // Handle window request for pagination
  const handleRequestWindow = useCallback((offset: number) => {
    setCurrentOffset(offset);
  }, []);
  const handleToggleMark = useCallback((index: number) => {
    annotationStore.toggleMark(sessionId, index);
  }, [annotationStore, sessionId]);
  const handleSetColor = useCallback((index: number, colorId: PacketColorId | undefined) => {
    annotationStore.setColor(sessionId, index, colorId);
  }, [annotationStore, sessionId]);
  const handleClearAnnotation = useCallback((index: number) => {
    annotationStore.clearAnnotation(sessionId, index);
  }, [annotationStore, sessionId]);

  // Handle export
  const handleExport = useCallback(async () => {
    if (!sessionId) return;
    
    setIsExporting(true);
    try {
      const path = await exportPcap(sessionId);
      notify({ source: "packet-capture",
        type: "success",
        title: "Export Complete",
        description: `Saved to ${path}`,
      });
    } catch (error) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsExporting(false);
    }
  }, [sessionId, notify]);

  // Handle double-click (could open in dedicated viewer)
  const handleDoubleClick = useCallback((_packet: PacketInfo, index: number) => {
    // For now, just select the packet
    setSelectedIndex(index);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="graphite-modal-content max-w-[90vw] w-[1400px] h-[85vh] max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col p-0 gap-0 overflow-hidden rounded-lg">
        {/* Header */}
        <DialogHeader className="ui-section-header-md flex-shrink-0 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <DialogTitle className="text-base font-semibold">
                {session?.name || `Capture ${sessionId.slice(0, 8)}`}
              </DialogTitle>
              {session && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="h-5 ui-control-shell">
                    {session.status}
                  </Badge>
                  <span>{session.packetCount.toLocaleString()} packets</span>
                  <span>•</span>
                  <span>{formatTimestampCompact(session.startTime)}</span>
                </div>
              )}
            </div>
            
            {/* Actions */}
            <div className="flex items-center gap-2">
              <TooltipWrapper entry={tooltips.captureExport}>
                <Button
                  variant="neutral"
                  size="sm"
                  onClick={handleExport}
                  disabled={isExporting}
                  className="h-8"
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  Export
                </Button>
              </TooltipWrapper>
              <TooltipWrapper entry={tooltips.captureClosePreview}>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </TooltipWrapper>
            </div>
          </div>
          
          {/* Filter bar */}
          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={filterInput}
                onChange={(e) => setFilterInput(e.target.value)}
                onKeyDown={handleFilterKeyDown}
                placeholder="Enter filter expression (e.g., ip.src == 192.168.1.1 or sip)"
                className="h-8 ui-control-shell pl-8 pr-8"
              />
              {filterInput && (
                <TooltipWrapper entry={tooltips.captureClearFilter}>
                  <button
                    onClick={handleClearFilter}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </TooltipWrapper>
              )}
            </div>
            <TooltipWrapper entry={tooltips.captureApplyFilter}>
              <Button
                variant="neutral"
                size="sm"
                onClick={handleApplyFilter}
                disabled={isLoading}
                className="h-8"
              >
                <Filter className="h-4 w-4 mr-1" />
                Apply
              </Button>
            </TooltipWrapper>
            
            {/* Quick filters */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="neutral" size="sm" className="h-8">
                  Quick Filters <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setFilterInput("sip"); handleApplyFilter(); }}>
                  SIP Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setFilterInput("rtp"); handleApplyFilter(); }}>
                  RTP Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setFilterInput("rtcp"); handleApplyFilter(); }}>
                  RTCP Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setFilterInput("tcp"); handleApplyFilter(); }}>
                  TCP Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setFilterInput("udp"); handleApplyFilter(); }}>
                  UDP Only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          {/* Status bar */}
          <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>
                Showing {packets.length.toLocaleString()} of {totalCount.toLocaleString()} packets
              </span>
              {appliedFilter && (
                <Badge variant="secondary" className="h-5 ui-control-shell text-xs">
                  Filter: {appliedFilter}
                </Badge>
              )}
            </div>
            {isLoading && (
              <div className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading...</span>
              </div>
            )}
          </div>
        </DialogHeader>
        
        {/* Main content */}
        <div className="packet-graphite-stage flex-1 flex min-h-0 overflow-hidden">
          {/* Packet list */}
          <div className="packet-graphite-panel flex-1 flex min-w-0 flex-col border-r border-border/45 rounded-none">
            <WarperPacketList
              packets={packets}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              autoScroll={false}
              totalCount={totalCount}
              windowOffset={currentOffset}
              onRequestWindow={handleRequestWindow}
              onDoubleClick={handleDoubleClick}
              annotations={annotationsMap}
              onToggleMark={handleToggleMark}
              onSetColor={handleSetColor}
              onClearAnnotation={handleClearAnnotation}
              onApplyDisplayFilter={(filter) => {
                setFilterInput(filter);
                setAppliedFilter(filter);
                setCurrentOffset(0);
                setSelectedIndex(null);
              }}
              onFollowRtpStream={(packet) => {
                const app = packet.decoded?.application;
                if (!app || (app.type !== "Rtp" && app.type !== "Srtp")) return;
                const filter = `rtp.ssrc == ${app.data.ssrc}`;
                setFilterInput(filter);
                setAppliedFilter(filter);
                setCurrentOffset(0);
                setSelectedIndex(null);
              }}
              onFollowSipCall={(packet) => {
                const app = packet.decoded?.application;
                if (app?.type === "Sip" && app.data.callId) {
                  const filter = `sip.Call-ID == "${app.data.callId}"`;
                  setFilterInput(filter);
                  setAppliedFilter(filter);
                } else {
                  setFilterInput("sip");
                  setAppliedFilter("sip");
                }
                setCurrentOffset(0);
                setSelectedIndex(null);
              }}
              onFollowConversation={(packet) => {
                const proto = packet.decoded?.tcp || packet.protocol.toUpperCase() === "TCP" ? "tcp" : "udp";
                const filter =
                  `${proto} && ((ip.src == ${packet.srcIp} && ip.dst == ${packet.dstIp} && ${proto}.srcport == ${packet.srcPort} && ${proto}.dstport == ${packet.dstPort}) || (ip.src == ${packet.dstIp} && ip.dst == ${packet.srcIp} && ${proto}.srcport == ${packet.dstPort} && ${proto}.dstport == ${packet.srcPort}))`;
                setFilterInput(filter);
                setAppliedFilter(filter);
                setCurrentOffset(0);
                setSelectedIndex(null);
              }}
              className="flex-1"
            />
          </div>
          
          {/* Details panel */}
          <div className="packet-graphite-panel w-[400px] flex-shrink-0 overflow-auto border-l border-border/45 rounded-none">
            {selectedPacket ? (
              <PacketDetailsView packet={selectedPacket} />
            ) : (
              <EmptyState
                variant="inline"
                compact
                title="No packet selected"
                description="Select a packet in the list to view decoded details."
                className="h-full p-6"
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PacketViewerModal;
