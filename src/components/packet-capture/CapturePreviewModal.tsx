import { useEffect, useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Clock, Package, RefreshCw } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { getCaptureStatistics, getCapturePackets } from "@/api/packetCapture";
import type { CaptureSession, PacketInfo } from "@/types/packetCapture";
import { formatDateTime } from "@/lib/dateTime";
import { ExportDialog } from "./monitor/ExportDialog";
import { IpAddress } from "@/components/ui/IpAddress";
import { EmptyState } from "@/components/ui/empty-state";
import { LiveIndicator } from "@/components/ui/live-indicator";

interface CapturePreviewModalProps {
  session: CaptureSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CapturePreviewModal({ 
  session, 
  open, 
  onOpenChange,
}: CapturePreviewModalProps) {
  const [packets, setPackets] = useState<PacketInfo[]>([]);
  const [loadingPackets, setLoadingPackets] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [statistics, setStatistics] = useState<any>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPreviewData = useCallback(async () => {
    try {
      // Fetch packets for both running and stopped sessions
      const fetchedPackets = await getCapturePackets(session.id, 200);
      setPackets(fetchedPackets || []);

      // Try to get statistics
      try {
        const stats = await getCaptureStatistics(session.id);
        setStatistics(stats);
      } catch {
        // Statistics might not be available for old captures
        setStatistics(null);
      }
    } catch (error) {
      console.error("Failed to load preview data:", error);
      setPackets([]);
    }
  }, [session.id]);

  // Initial load
  useEffect(() => {
    if (open && session) {
      setLoadingPackets(true);
      loadPreviewData().finally(() => setLoadingPackets(false));
    }
    return () => {
      if (!open) {
        setPackets([]);
        setStatistics(null);
      }
    };
  }, [open, session, loadPreviewData]);

  // Auto-refresh for running sessions
  useEffect(() => {
    if (open && session.status === "Running") {
      refreshTimerRef.current = setInterval(() => {
        loadPreviewData();
      }, 2000);
      return () => {
        if (refreshTimerRef.current) {
          clearInterval(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      };
    }
  }, [open, session.status, loadPreviewData]);

  const formatDuration = () => {
    if (!session.startTime || !session.endTime) return "N/A";
    const start = new Date(session.startTime);
    const end = new Date(session.endTime);
    const diffMs = end.getTime() - start.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffHours > 0) return `${diffHours}h ${diffMins % 60}m`;
    if (diffMins > 0) return `${diffMins}m ${diffSecs % 60}s`;
    return `${diffSecs}s`;
  };

  const getFileSize = () => {
    // File size would need to be calculated from the file
    // For now, estimate based on packet count
    const estimatedBytes = session.packetCount * 100; // Rough estimate
    if (estimatedBytes < 1024) return `${estimatedBytes} B`;
    if (estimatedBytes < 1024 * 1024) return `${(estimatedBytes / 1024).toFixed(1)} KB`;
    return `${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const protocolBreakdown = () => {
    if (!statistics?.packetsByProtocol) return null;
    return Object.entries(statistics.packetsByProtocol)
      .sort(([, a]: any, [, b]: any) => b - a)
      .slice(0, 5);
  };

  const isRunning = session.status === "Running";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[calc(min(100vh,100dvh)-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {session.name}
              {isRunning && (
                <LiveIndicator variant="badge" label="LIVE" size="sm" className="ml-2" />
              )}
            </DialogTitle>
            <DialogDescription>
              {isRunning
                ? "Live preview — auto-refreshing every 2s"
                : "Capture session preview"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={isRunning ? "default" : "secondary"}>
                  {session.status}
                </Badge>
              </div>
              <div className="space-y-1">
                <TooltipWrapper entry={tooltips.statInterface}>
                  <div className="text-xs text-muted-foreground cursor-help">Interface</div>
                </TooltipWrapper>
                <div className="text-sm font-medium">{session.interface}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Start Time
                </div>
                <div className="text-sm font-mono">
                  {formatDateTime(session.startTime)}
                </div>
              </div>
              {session.endTime && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Duration</div>
                  <div className="text-sm">{formatDuration()}</div>
                </div>
              )}
              <div className="space-y-1">
                <TooltipWrapper entry={tooltips.statTotalPackets}>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 cursor-help">
                    <Package className="h-3 w-3" />
                    Packet Count
                  </div>
                </TooltipWrapper>
                <div className="text-sm font-medium">{session.packetCount.toLocaleString()}</div>
              </div>
              <div className="space-y-1">
                <TooltipWrapper entry={tooltips.statPcapFile}>
                  <div className="text-xs text-muted-foreground cursor-help">File Size (est.)</div>
                </TooltipWrapper>
                <div className="text-sm">{getFileSize()}</div>
              </div>
            </div>

            {session.description && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Description</div>
                <div className="text-sm">{session.description}</div>
              </div>
            )}

            {/* Statistics Preview */}
            {statistics && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Statistics</div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <TooltipWrapper entry={tooltips.statTotalBytes}>
                      <div className="text-xs text-muted-foreground cursor-help">Total Bytes</div>
                    </TooltipWrapper>
                    <div className="font-medium">
                      {statistics.totalBytes ? statistics.totalBytes.toLocaleString() : "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Packets/sec</div>
                    <div className="font-medium">
                      {statistics.packetsPerSecond ? statistics.packetsPerSecond.toFixed(2) : "N/A"}
                    </div>
                  </div>
                </div>
                {protocolBreakdown() && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Top Protocols</div>
                    <div className="flex flex-wrap gap-2">
                      {protocolBreakdown()!.map(([protocol, count]: any) => (
                        <Badge key={protocol} variant="secondary" className="text-xs">
                          {protocol}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Packet Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">
                  Packet Preview
                  {packets.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({packets.length.toLocaleString()} loaded)
                    </span>
                  )}
                </div>
                {isRunning && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Auto-refreshing
                  </span>
                )}
              </div>
              {loadingPackets ? (
                <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading packets...
                </div>
              ) : packets.length > 0 ? (
                <div className="surface-flat max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="surface-subtle sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          <TooltipWrapper entry={tooltips.colTime}>
                            <span className="cursor-help">Time</span>
                          </TooltipWrapper>
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          <TooltipWrapper entry={tooltips.colSource}>
                            <span className="cursor-help">Source</span>
                          </TooltipWrapper>
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          <TooltipWrapper entry={tooltips.colDestination}>
                            <span className="cursor-help">Destination</span>
                          </TooltipWrapper>
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          <TooltipWrapper entry={tooltips.colProtocol}>
                            <span className="cursor-help">Protocol</span>
                          </TooltipWrapper>
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">
                          <TooltipWrapper entry={tooltips.colLength}>
                            <span className="cursor-help">Size</span>
                          </TooltipWrapper>
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          <TooltipWrapper entry={tooltips.colInfo}>
                            <span className="cursor-help">Info</span>
                          </TooltipWrapper>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {packets.slice(0, 100).map((packet, idx) => (
                        <tr key={idx} className="hover:bg-muted/40 transition-smooth">
                          <td className="px-2 py-1 font-mono text-muted-foreground tabular-nums">{idx + 1}</td>
                          <td className="px-2 py-1 font-mono tabular-nums">{packet.timestamp}</td>
                          <td className="px-2 py-1"><IpAddress ip={`${packet.srcIp}:${packet.srcPort}`} size="sm" variant="mono" showCopyOnHover={false} /></td>
                          <td className="px-2 py-1"><IpAddress ip={`${packet.dstIp}:${packet.dstPort}`} size="sm" variant="mono" showCopyOnHover={false} /></td>
                          <td className="px-2 py-1 font-semibold">{packet.protocol}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{packet.size || packet.frameLength || 0}</td>
                          <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">{packet.summary || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {packets.length > 100 && (
                    <div className="surface-subtle px-2 py-1.5 text-center text-xs text-muted-foreground">
                      Showing first 100 of {packets.length.toLocaleString()} packets
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState compact variant="inline" title="No packets available for preview" />
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <TooltipWrapper entry={tooltips.captureClosePreview}>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.captureExport}>
              <Button variant="outline" onClick={() => setShowExport(true)}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </TooltipWrapper>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showExport && (
        <ExportDialog
          open={showExport}
          onOpenChange={setShowExport}
          packets={packets}
          sessionId={session.id}
        />
      )}
    </>
  );
}
