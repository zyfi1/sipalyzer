import { useEffect } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Activity, Package, TrendingUp, Network } from "@/lib/icons";
import { IpAddress } from "@/components/ui/IpAddress";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";

export function CaptureStatistics() {
  const activeSessionId = usePacketCaptureStore((s) => s.activeSessionId);
  const statistics = usePacketCaptureStore((s) => s.statistics);
  const fetchStatistics = usePacketCaptureStore((s) => s.fetchStatistics);

  useEffect(() => {
    if (activeSessionId) {
      fetchStatistics(activeSessionId);
    }
  }, [activeSessionId, fetchStatistics]);

  if (!statistics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Statistics</CardTitle>
          <CardDescription>No active capture session</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            compact
            variant="inline"
            icon={<Activity />}
            title="No active capture"
            description="Start a capture session to view live statistics."
          />
        </CardContent>
      </Card>
    );
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatBps = (bps: number) => {
    if (bps < 1000) return `${bps.toFixed(0)} bps`;
    if (bps < 1000000) return `${(bps / 1000).toFixed(2)} Kbps`;
    return `${(bps / 1000000).toFixed(2)} Mbps`;
  };

  const protocolEntries = Object.entries(statistics.packetsByProtocol || {}).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Real-time Statistics
        </CardTitle>
        <CardDescription>Live capture metrics</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overview */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <TooltipWrapper entry={tooltips.statTotalPackets}>
              <div className="text-sm text-muted-foreground cursor-help">Total Packets</div>
            </TooltipWrapper>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-5 w-5" />
              {statistics.totalPackets.toLocaleString()}
            </div>
          </div>
          <div>
            <TooltipWrapper entry={tooltips.statTotalBytes}>
              <div className="text-sm text-muted-foreground cursor-help">Total Bytes</div>
            </TooltipWrapper>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Network className="h-5 w-5" />
              {formatBytes(statistics.totalBytes)}
            </div>
          </div>
        </div>

        {/* Rates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <TooltipWrapper entry={tooltips.statPacketsPerSec}>
              <div className="text-sm text-muted-foreground cursor-help">Packets/sec</div>
            </TooltipWrapper>
            <div className="text-xl font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              {statistics.packetsPerSecond.toFixed(1)}
            </div>
          </div>
          <div>
            <TooltipWrapper entry={tooltips.statBandwidth}>
              <div className="text-sm text-muted-foreground cursor-help">Bandwidth</div>
            </TooltipWrapper>
            <div className="text-xl font-semibold">
              {formatBps(statistics.bytesPerSecond * 8)}
            </div>
          </div>
        </div>

        {/* Protocol Breakdown */}
        <div>
          <TooltipWrapper entry={tooltips.statProtocolBreakdown}>
            <div className="text-sm font-medium mb-3 cursor-help">Protocol Breakdown</div>
          </TooltipWrapper>
          <div className="space-y-2">
            {protocolEntries.map(([protocol, count]) => {
              const percentage = statistics.totalPackets > 0
                ? (count / statistics.totalPackets) * 100
                : 0;
              const bytes = statistics.bytesByProtocol?.[protocol] || 0;

              return (
                <div key={protocol} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{protocol}</span>
                    <span className="text-muted-foreground">
                      {count.toLocaleString()} ({formatBytes(bytes)})
                    </span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Top IPs */}
        {(statistics.topSrcIps?.length > 0 || statistics.topDstIps?.length > 0) && (
          <div className="grid grid-cols-2 gap-4">
            {statistics.topSrcIps?.length > 0 && (
              <div>
                <TooltipWrapper entry={tooltips.statTopSourceIps}>
                  <div className="text-sm font-medium mb-2 cursor-help">Top Source IPs</div>
                </TooltipWrapper>
                <div className="space-y-1">
                  {statistics.topSrcIps.slice(0, 5).map(([ip, count]) => (
                    <div key={ip} className="flex justify-between items-center text-xs group">
                      <IpAddress ip={ip} variant="mono" size="sm" className="truncate flex-1" />
                      <span className="text-muted-foreground ml-2">{count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {statistics.topDstIps?.length > 0 && (
              <div>
                <TooltipWrapper entry={tooltips.statTopDestIps}>
                  <div className="text-sm font-medium mb-2 cursor-help">Top Destination IPs</div>
                </TooltipWrapper>
                <div className="space-y-1">
                  {statistics.topDstIps.slice(0, 5).map(([ip, count]) => (
                    <div key={ip} className="flex justify-between items-center text-xs group">
                      <IpAddress ip={ip} variant="mono" size="sm" className="truncate flex-1" />
                      <span className="text-muted-foreground ml-2">{count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
