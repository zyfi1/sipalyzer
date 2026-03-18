import { useEffect, useState } from "react";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
} from "recharts";
import { Activity, Package, TrendingUp, Network } from "@/lib/icons";
import { formatTime } from "@/lib/dateTime";
import { SipCallFlow } from "./SipCallFlow";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import type { PacketInfo } from "@/types/packetCapture";
import { EmptyState } from "@/components/ui/empty-state";

interface StatisticsDashboardProps {
  packets?: PacketInfo[];
}

export function StatisticsDashboard({ packets = [] }: StatisticsDashboardProps) {
  const activeSessionId = usePacketCaptureStore((s) => s.activeSessionId);
  const statistics = usePacketCaptureStore((s) => s.statistics);
  const fetchStatistics = usePacketCaptureStore((s) => s.fetchStatistics);
  const [timeSeriesData, setTimeSeriesData] = useState<Array<{
    time: string;
    packets: number;
    bytes: number;
    sip: number;
    rtp: number;
    rtcp: number;
  }>>([]);

  useEffect(() => {
    if (activeSessionId) {
      fetchStatistics(activeSessionId);
    }
  }, [activeSessionId, fetchStatistics]);

  // Update time series data
  useEffect(() => {
    if (statistics) {
      const now = formatTime(new Date().toISOString());
      setTimeSeriesData((prev) => {
        const newData = [
          ...prev,
          {
            time: now,
            packets: statistics.packetsPerSecond,
            bytes: statistics.bytesPerSecond,
            sip: statistics.packetsByProtocol?.["SIP"] || 0,
            rtp: statistics.packetsByProtocol?.["RTP"] || 0,
            rtcp: statistics.packetsByProtocol?.["RTCP"] || 0,
          },
        ];
        // Keep last 60 data points
        return newData.slice(-60);
      });
    }
  }, [statistics]);

  if (!statistics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            variant="inline"
            compact
            title="No active capture session"
            className="items-start p-0 pt-0 text-left"
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

  const protocolChartData = protocolEntries.map(([name, value]) => ({
    name,
    value,
  }));

  const COLORS = {
    SIP: "#3b82f6",
    RTP: "#10b981",
    RTCP: "#a855f7",
    FAX: "#f97316",
    Other: "#6b7280",
  };

  return (
    <div className="space-y-4 bg-card/50 p-2.5">
      {/* Metrics Cards */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-muted-foreground" />
              <div>
                <TooltipWrapper entry={tooltips.statTotalPackets}>
                  <div className="text-sm text-muted-foreground cursor-help">Total Packets</div>
                </TooltipWrapper>
                <div className="text-2xl font-bold">{statistics.totalPackets.toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Network className="h-5 w-5 text-muted-foreground" />
              <div>
                <TooltipWrapper entry={tooltips.statTotalBytes}>
                  <div className="text-sm text-muted-foreground cursor-help">Total Bytes</div>
                </TooltipWrapper>
                <div className="text-2xl font-bold">{formatBytes(statistics.totalBytes)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <div>
                <TooltipWrapper entry={tooltips.statPacketsPerSec}>
                  <div className="text-sm text-muted-foreground cursor-help">Packets/sec</div>
                </TooltipWrapper>
                <div className="text-2xl font-bold">{statistics.packetsPerSecond.toFixed(1)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              <div>
                <TooltipWrapper entry={tooltips.statBandwidth}>
                  <div className="text-sm text-muted-foreground cursor-help">Bandwidth</div>
                </TooltipWrapper>
                <div className="text-2xl font-bold">{formatBps(statistics.bytesPerSecond * 8)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {/* Packets per Second Chart */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Packets per Second</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={timeSeriesData}>
                <defs>
                  <linearGradient id="packetsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 2" className="stroke-muted/30" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="packets" stroke="#3b82f6" strokeWidth={2} fill="url(#packetsGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Protocol Distribution */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <TooltipWrapper entry={tooltips.statProtocolBreakdown}>
              <CardTitle className="cursor-help">Protocol Distribution</CardTitle>
            </TooltipWrapper>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={protocolChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {protocolChartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[entry.name as keyof typeof COLORS] || COLORS.Other}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Protocol Breakdown Table */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <TooltipWrapper entry={tooltips.statProtocolBreakdown}>
            <CardTitle className="cursor-help">Protocol Breakdown</CardTitle>
          </TooltipWrapper>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {protocolEntries.map(([protocol, count]) => {
              const percentage =
                statistics.totalPackets > 0 ? (count / statistics.totalPackets) * 100 : 0;
              const bytes = statistics.bytesByProtocol?.[protocol] || 0;

              return (
                <div key={protocol} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{protocol}</span>
                    <span className="text-muted-foreground">
                      {count.toLocaleString()} ({formatBytes(bytes)})
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor:
                          COLORS[protocol as keyof typeof COLORS] || COLORS.Other,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Top IPs */}
      {(statistics.topSrcIps?.length > 0 || statistics.topDstIps?.length > 0) && (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {statistics.topSrcIps?.length > 0 && (
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <TooltipWrapper entry={tooltips.statTopSourceIps}>
                  <CardTitle className="cursor-help">Top Source IPs</CardTitle>
                </TooltipWrapper>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={statistics.topSrcIps.slice(0, 10).map(([ip, count]) => ({ ip, count }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="ip" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b82f6" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {statistics.topDstIps?.length > 0 && (
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <TooltipWrapper entry={tooltips.statTopDestIps}>
                  <CardTitle className="cursor-help">Top Destination IPs</CardTitle>
                </TooltipWrapper>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={statistics.topDstIps.slice(0, 10).map(([ip, count]) => ({ ip, count }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="ip" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#10b981" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* SIP Call Flows */}
      {packets.length > 0 && (
        <SipCallFlow packets={packets} />
      )}
    </div>
  );
}
