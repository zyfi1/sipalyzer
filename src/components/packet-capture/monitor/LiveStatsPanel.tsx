/**
 * LiveStatsPanel - Real-time statistics visualization panel.
 * 
 * Displays live capture statistics with charts and metrics:
 * - Header cards: Total packets, bytes, packet rate, bandwidth
 * - Rate chart: Real-time packet rate line chart
 * - Protocol distribution: Donut chart
 * - Top talkers: Source/destination IP tables
 */

import { useMemo, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  HardDrive,
  Zap,
  TrendingUp,
  Server,
  Network,
  HelpCircle,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { tooltips } from "@/lib/tooltips";
import type { LiveStatsSnapshot, PipelineStats } from "@/api/packetCapture";
import type { CaptureStatistics } from "@/types/packetCapture";

/** Format bytes to human readable */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** Format rate with unit */
function formatRate(rate: number): string {
  if (rate >= 1000000) return `${(rate / 1000000).toFixed(1)}M`;
  if (rate >= 1000) return `${(rate / 1000).toFixed(1)}K`;
  return rate.toFixed(0);
}

/** Protocol color mapping */
const PROTOCOL_COLORS: Record<string, string> = {
  SIP: "#3b82f6", // blue
  RTP: "#22c55e", // green
  RTCP: "#06b6d4", // cyan
  UDP: "#6b7280", // gray
  TCP: "#0ea5e9", // sky
  HTTP: "#f97316", // orange
  HTTPS: "#f97316",
  DNS: "#eab308", // yellow
  ICMP: "#ef4444", // red
  ARP: "#f59e0b", // amber
  OTHER: "#94a3b8", // slate
};

/** Get tooltip entry for protocol name */
function getProtocolTooltip(protocol: string): { title: string; description?: string } {
  const protocolMap: Record<string, keyof typeof tooltips> = {
    SIP: "protoSip",
    RTP: "protoRtp",
    RTCP: "protoRtcp",
    UDP: "protoUdp",
    TCP: "protoTcp",
    DNS: "protoDns",
    HTTP: "protoHttp",
    HTTPS: "protoHttps",
    ICMP: "protoIcmp",
    ARP: "protoArp",
  };
  
  const tooltipKey = protocolMap[protocol];
  if (tooltipKey) {
    const entry = tooltips[tooltipKey];
    if (entry && typeof entry === "object" && "title" in entry) {
      return entry as { title: string; description?: string };
    }
  }
  
  // Fallback
  return { title: protocol, description: `${protocol} protocol` };
}

interface LiveStatsPanelProps {
  stats: LiveStatsSnapshot | null;
  pipelineStats: PipelineStats | null;
  isCapturing: boolean;
  historicalStats?: CaptureStatistics | null;
}

function toLiveSnapshotFromHistorical(stats: CaptureStatistics): LiveStatsSnapshot {
  const totalPackets = stats.totalPackets || 0;
  const totalBytes = stats.totalBytes || 0;
  const protocolCounts = Object.entries(stats.packetsByProtocol ?? {}).map(([protocol, count]) => {
    const bytes = stats.bytesByProtocol?.[protocol] ?? 0;
    return {
      protocol,
      count,
      bytes,
      percentage: totalPackets > 0 ? (count / totalPackets) * 100 : 0,
    };
  });
  const topSrcIps = (stats.topSrcIps ?? []).map(([ip, count]) => ({
    ip,
    count,
    percentage: totalPackets > 0 ? (count / totalPackets) * 100 : 0,
  }));
  const topDstIps = (stats.topDstIps ?? []).map(([ip, count]) => ({
    ip,
    count,
    percentage: totalPackets > 0 ? (count / totalPackets) * 100 : 0,
  }));
  const firstPacketTime = stats.startTime ? Date.parse(stats.startTime) : null;
  const lastPacketTime = stats.lastPacketTime ? Date.parse(stats.lastPacketTime) : null;
  const durationSeconds = firstPacketTime != null && lastPacketTime != null && !Number.isNaN(firstPacketTime) && !Number.isNaN(lastPacketTime)
    ? Math.max(0, Math.round((lastPacketTime - firstPacketTime) / 1000))
    : 0;

  return {
    totalPackets,
    totalBytes,
    packetRate: stats.packetsPerSecond || 0,
    byteRate: stats.bytesPerSecond || 0,
    protocolCounts,
    topSrcIps,
    topDstIps,
    topSrcPorts: [],
    topDstPorts: [],
    topIpPairs: [],
    durationSeconds,
    firstPacketTime,
    lastPacketTime,
  };
}

export function LiveStatsPanel({ stats, pipelineStats, isCapturing, historicalStats = null }: LiveStatsPanelProps) {
  const effectiveStats = useMemo(
    () => stats ?? (historicalStats ? toLiveSnapshotFromHistorical(historicalStats) : null),
    [stats, historicalStats],
  );
  const showingHistorical = !stats && !!effectiveStats;
  // Rate history for sparkline (last 60 seconds)
  const [rateHistory, setRateHistory] = useState<number[]>([]);
  const historyRef = useRef<number[]>([]);
  
  // Update rate history
  useEffect(() => {
    if (!effectiveStats) return;
    
    historyRef.current = [...historyRef.current.slice(-59), effectiveStats.packetRate];
    setRateHistory([...historyRef.current]);
  }, [effectiveStats?.packetRate]);
  
  // Clear history when capture starts/stops
  useEffect(() => {
    if (!isCapturing) {
      historyRef.current = [];
      setRateHistory([]);
    }
  }, [isCapturing]);
  
  // Calculate protocol distribution
  const protocolDistribution = useMemo(() => {
    if (!effectiveStats?.protocolCounts || !Array.isArray(effectiveStats.protocolCounts)) return [];
    
    return effectiveStats.protocolCounts
      .map((item) => ({
        protocol: item.protocol,
        count: item.count,
        percentage: item.percentage,
        color: PROTOCOL_COLORS[item.protocol] || PROTOCOL_COLORS.OTHER,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [effectiveStats?.protocolCounts]);
  
  // Top IPs
  const topSourceIps = useMemo(() => {
    if (!effectiveStats?.topSrcIps) return [];
    return effectiveStats.topSrcIps.slice(0, 5);
  }, [effectiveStats?.topSrcIps]);
  
  const topDestIps = useMemo(() => {
    if (!effectiveStats?.topDstIps) return [];
    return effectiveStats.topDstIps.slice(0, 5);
  }, [effectiveStats?.topDstIps]);
  
  // Max rate for sparkline scaling
  const maxRate = useMemo(() => {
    return Math.max(1, ...rateHistory);
  }, [rateHistory]);
  
  if (!effectiveStats && !isCapturing) {
    return (
      <EmptyState
        variant="inline"
        icon={<Activity />}
        title="No statistics yet"
        description="Start or load a capture to view packet and protocol metrics."
        className="h-full p-6"
      />
    );
  }
  
  return (
    <div className="space-y-2.5 overflow-auto p-2.5">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-2">
        <TooltipWrapper entry={tooltips.captureTotalPackets}>
          <MetricCard
            icon={<HardDrive className="h-4 w-4" />}
            label="Total Packets"
            value={effectiveStats?.totalPackets?.toLocaleString() ?? "0"}
            trend={isCapturing ? "up" : undefined}
          />
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.captureTotalBytes}>
          <MetricCard
            icon={<Server className="h-4 w-4" />}
            label="Total Bytes"
            value={formatBytes(effectiveStats?.totalBytes ?? 0)}
          />
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.capturePacketRate}>
          <MetricCard
            icon={<Zap className="h-4 w-4" />}
            label="Packet Rate"
            value={`${formatRate(effectiveStats?.packetRate ?? 0)}/s`}
            highlight={isCapturing}
          />
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.captureBandwidth}>
          <MetricCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Bandwidth"
            value={`${formatBytes(effectiveStats?.byteRate ?? 0)}/s`}
          />
        </TooltipWrapper>
      </div>
      
      {/* Rate Sparkline */}
      {rateHistory.length > 1 && (
        <Card className="overflow-hidden border-border/50 bg-card/50">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs font-medium flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" />
              {showingHistorical ? "Packet Rate Summary" : "Packet Rate (last 60s)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <svg
              viewBox={`0 0 ${rateHistory.length} 40`}
              className="w-full h-12"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="rateGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(34, 197, 94)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="rgb(34, 197, 94)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d={`
                  M 0 40
                  ${rateHistory.map((rate, i) => {
                    const y = 40 - (rate / maxRate) * 36;
                    return `L ${i} ${y}`;
                  }).join(" ")}
                  L ${rateHistory.length - 1} 40
                  Z
                `}
                fill="url(#rateGradient)"
              />
              <path
                d={rateHistory.map((rate, i) => {
                  const y = 40 - (rate / maxRate) * 36;
                  return `${i === 0 ? "M" : "L"} ${i} ${y}`;
                }).join(" ")}
                fill="none"
                stroke="rgb(34, 197, 94)"
                strokeWidth="1.5"
              />
            </svg>
          </CardContent>
        </Card>
      )}
      
      {/* Protocol Distribution */}
      {protocolDistribution.length > 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="py-2 px-3">
            <TooltipWrapper entry={tooltips.captureProtocolDist}>
              <CardTitle className="text-xs font-medium flex items-center gap-2 cursor-help">
                <Network className="h-3.5 w-3.5" />
                Protocol Distribution
              </CardTitle>
            </TooltipWrapper>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            <div className="space-y-1.5">
              {protocolDistribution.map(({ protocol, count, percentage, color }) => (
                <div key={protocol} className="flex items-center gap-2 text-xs">
                  <div
                    className="w-2 h-2 rounded-full flex-none"
                    style={{ backgroundColor: color }}
                  />
                  <TooltipWrapper entry={getProtocolTooltip(protocol)}>
                    <span className="font-mono flex-none w-12 cursor-help">{protocol}</span>
                  </TooltipWrapper>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-smooth"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground w-16 text-right tabular-nums">
                    {count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Top Talkers */}
      {(topSourceIps.length > 0 || topDestIps.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="py-2 px-3">
              <TooltipWrapper entry={tooltips.captureTopSources}><CardTitle className="text-xs font-medium cursor-help">Top Sources</CardTitle></TooltipWrapper>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0">
              <div className="space-y-1">
                {topSourceIps.map(({ ip, count }) => (
                  <div key={ip} className="flex items-center justify-between text-xs font-mono">
                    <span className="truncate">{ip}</span>
                    <span className="text-muted-foreground">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="py-2 px-3">
              <TooltipWrapper entry={tooltips.captureTopDests}><CardTitle className="text-xs font-medium cursor-help">Top Destinations</CardTitle></TooltipWrapper>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0">
              <div className="space-y-1">
                {topDestIps.map(({ ip, count }) => (
                  <div key={ip} className="flex items-center justify-between text-xs font-mono">
                    <span className="truncate">{ip}</span>
                    <span className="text-muted-foreground">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Pipeline Stats */}
      {pipelineStats && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="py-2 px-3">
            <TooltipWrapper entry={tooltips.capturePipelinePerf}>
              <CardTitle className="text-xs font-medium flex items-center gap-2 cursor-help">
                <Zap className="h-3.5 w-3.5" />
                Pipeline Performance
              </CardTitle>
            </TooltipWrapper>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between items-center gap-1">
                <TooltipWrapper entry={tooltips.statPipelineCaptured}>
                  <span className="flex items-center gap-1 cursor-help">
                    <span className="text-muted-foreground">Captured:</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
                  </span>
                </TooltipWrapper>
                <span className="font-mono">{pipelineStats.packetsCaptured?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <TooltipWrapper entry={tooltips.statPipelineParsed}>
                  <span className="flex items-center gap-1 cursor-help">
                    <span className="text-muted-foreground">Parsed:</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
                  </span>
                </TooltipWrapper>
                <span className="font-mono">{pipelineStats.packetsParsed?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <TooltipWrapper entry={tooltips.statPipelineRawQueue}>
                  <span className="flex items-center gap-1 cursor-help">
                    <span className="text-muted-foreground">Raw Queue:</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
                  </span>
                </TooltipWrapper>
                <span className="font-mono">{pipelineStats.rawQueueSize ?? 0}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <TooltipWrapper entry={tooltips.statPipelineParsedQueue}>
                  <span className="flex items-center gap-1 cursor-help">
                    <span className="text-muted-foreground">Parsed Queue:</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
                  </span>
                </TooltipWrapper>
                <span className="font-mono">{pipelineStats.parsedQueueSize ?? 0}</span>
              </div>
              {(pipelineStats.packetsDroppedCapture || 0) > 0 && (
                <div className="flex justify-between items-center gap-1 col-span-2 text-warning">
                  <TooltipWrapper entry={tooltips.statPipelineDropCapture}>
                    <span className="flex items-center gap-1 cursor-help">
                      <span>Dropped (capture):</span>
                      <HelpCircle className="h-3 w-3 text-warning/50 hover:text-warning" />
                    </span>
                  </TooltipWrapper>
                  <span className="font-mono">{pipelineStats.packetsDroppedCapture}</span>
                </div>
              )}
              {(pipelineStats.packetsDroppedParser || 0) > 0 && (
                <div className="flex justify-between items-center gap-1 col-span-2 text-warning">
                  <TooltipWrapper entry={tooltips.statPipelineDropParser}>
                    <span className="flex items-center gap-1 cursor-help">
                      <span>Dropped (parser):</span>
                      <HelpCircle className="h-3 w-3 text-warning/50 hover:text-warning" />
                    </span>
                  </TooltipWrapper>
                  <span className="font-mono">{pipelineStats.packetsDroppedParser}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Metric card component */
function MetricCard({
  icon,
  label,
  value,
  trend,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: "up" | "down";
  highlight?: boolean;
}) {
  return (
    <Card className={cn("border-border/50 bg-card/50 transition-smooth", highlight && "bg-success/[0.08]")}>
      <CardContent className="p-2.5">
        <div className="flex items-center gap-2">
          <div className={cn(
            "text-muted-foreground",
            highlight && "text-success"
          )}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-2xs text-muted-foreground uppercase tracking-wider">
              {label}
            </div>
            <div className="font-mono text-sm font-medium tabular-nums flex items-center gap-1">
              {value}
              {trend === "up" && (
                <TrendingUp className="h-3 w-3 text-success" />
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default LiveStatsPanel;
