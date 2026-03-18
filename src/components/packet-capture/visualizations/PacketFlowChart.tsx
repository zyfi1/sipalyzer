/**
 * Real-time packet flow visualization using Recharts.
 *
 * Displays packets per second over time with protocol breakdown.
 */

import React, { useCallback, useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/empty-state";
import type { PacketInfo } from "@/types/packetCapture";

/** Chart margins. */
const MARGIN = { top: 20, right: 30, bottom: 40, left: 50 };

/** Protocol colors — resolved from CSS design-system variables at runtime. */
function getProtocolColors(): Record<string, string> {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => root.getPropertyValue(name).trim() || fb;
  return {
    SIP: v("--color-protocol-sip", "#60a5fa"),
    RTP: v("--color-protocol-rtp", "#34d399"),
    RTCP: v("--color-protocol-rtcp", "#22d3ee"),
    FAX: v("--color-chart-cyan", "#2dd4bf"),
    TCP: v("--color-protocol-tcp", "#38bdf8"),
    UDP: v("--color-protocol-udp", "#94a3b8"),
    HTTP: v("--color-protocol-http", "#fb923c"),
    HTTPS: v("--color-chart-orange", "#f97316"),
    DNS: v("--color-protocol-dns", "#facc15"),
    ICMP: v("--color-protocol-icmp", "#f87171"),
    OTHER: "#4b5563",
  };
}

let _protocolColors: Record<string, string> | null = null;
function protocolColors(): Record<string, string> {
  if (!_protocolColors) _protocolColors = getProtocolColors();
  return _protocolColors;
}

/** Time bucket for aggregation. */
interface TimeBucket {
  timestamp: Date;
  total: number;
  byProtocol: Record<string, number>;
}

interface ChartBucket extends TimeBucket {
  timestampMs: number;
}

interface PacketFlowChartProps {
  /** Packets to visualize. */
  packets: PacketInfo[];
  /** Bucket size in milliseconds. */
  bucketSizeMs?: number;
  /** Max buckets to display. */
  maxBuckets?: number;
  /** Chart height. */
  height?: number;
  /** Show area chart (true) or bar chart (false). */
  showArea?: boolean;
  /** Protocols to display (null = all). */
  protocols?: string[] | null;
  /** Callback when clicking on a bucket. */
  onBucketClick?: (bucket: TimeBucket) => void;
}

/**
 * Aggregate packets into time buckets.
 */
function aggregatePackets(
  packets: PacketInfo[],
  bucketSizeMs: number,
  maxBuckets: number
): TimeBucket[] {
  if (packets.length === 0) return [];

  // Find time range
  const timestamps = packets.map((p) => new Date(p.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  // Calculate bucket boundaries
  const totalDuration = maxTime - minTime;
  const numBuckets = Math.min(
    maxBuckets,
    Math.ceil(totalDuration / bucketSizeMs) + 1
  );
  const adjustedBucketSize = totalDuration / (numBuckets - 1) || bucketSizeMs;

  // Create buckets
  const buckets: Map<number, TimeBucket> = new Map();

  for (let i = 0; i < numBuckets; i++) {
    const bucketTime = minTime + i * adjustedBucketSize;
    buckets.set(i, {
      timestamp: new Date(bucketTime),
      total: 0,
      byProtocol: {},
    });
  }

  // Assign packets to buckets
  for (const packet of packets) {
    const time = new Date(packet.timestamp).getTime();
    const bucketIndex = Math.floor((time - minTime) / adjustedBucketSize);
    const bucket = buckets.get(Math.min(bucketIndex, numBuckets - 1));

    if (bucket) {
      bucket.total++;
      const protocol = packet.protocol || "OTHER";
      bucket.byProtocol[protocol] = (bucket.byProtocol[protocol] || 0) + 1;
    }
  }

  return Array.from(buckets.values());
}

/**
 * Inner chart component.
 */
function PacketFlowChartInner({
  height,
  packets,
  bucketSizeMs = 1000,
  maxBuckets = 60,
  showArea = true,
  protocols = null,
  onBucketClick,
}: PacketFlowChartProps) {
  const chartPrimary = useMemo(() => protocolColors().SIP || "#60a5fa", []);
  void protocols;

  const buckets = useMemo(
    () => aggregatePackets(packets, bucketSizeMs, maxBuckets),
    [packets, bucketSizeMs, maxBuckets]
  );

  const chartData = useMemo<ChartBucket[]>(() => {
    return buckets.map((bucket) => ({
      ...bucket,
      timestampMs: bucket.timestamp.getTime(),
    }));
  }, [buckets]);

  const handleChartClick = useCallback(
    (state: any) => {
      if (!onBucketClick) return;
      const bucket = state?.activePayload?.[0]?.payload as
        | ChartBucket
        | undefined;
      if (!bucket) return;
      onBucketClick({
        timestamp: bucket.timestamp,
        total: bucket.total,
        byProtocol: bucket.byProtocol,
      });
    },
    [onBucketClick]
  );

  if (chartData.length === 0) {
    return (
      <EmptyState compact variant="inline" title="No packet data to display" />
    );
  }

  const tooltipStyle: React.CSSProperties = {
    background: "hsl(var(--card) / 0.98)",
    color: "hsl(var(--foreground))",
    border: "1px solid hsl(var(--border) / 0.55)",
    borderRadius: "6px",
    padding: "8px 12px",
    fontSize: "12px",
  };

  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const first = payload[0];
    const bucket = first?.payload as ChartBucket | undefined;
    if (!bucket) return null;
    return (
      <div style={tooltipStyle}>
        <div className="font-semibold">
          {bucket.timestamp.toLocaleTimeString()}
        </div>
        <div className="text-muted-foreground">Total: {bucket.total} packets</div>
        <div className="mt-1 space-y-0.5">
          {Object.entries(bucket.byProtocol)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([protocol, count]) => (
              <div key={protocol} className="flex items-center gap-2 text-xs">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      protocolColors()[protocol] || protocolColors().OTHER,
                  }}
                />
                <span>{protocol}:</span>
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))}
        </div>
      </div>
    );
  };

  const commonAxisProps = {
    axisLine: false,
    tickLine: false,
    tick: { fontSize: 10, fill: "currentColor" },
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height || 200}>
        {showArea ? (
          <AreaChart
            data={chartData}
            margin={MARGIN}
            onClick={handleChartClick}
            style={{ cursor: onBucketClick ? "pointer" : "default" }}
          >
            <defs>
              <linearGradient id="packet-flow-area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartPrimary} stopOpacity={0.4} />
                <stop offset="100%" stopColor={chartPrimary} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.1} />
            <XAxis
              {...commonAxisProps}
              dataKey="timestampMs"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickCount={5}
              tickFormatter={(value: number) =>
                new Date(value).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              }
            />
            <YAxis
              {...commonAxisProps}
              allowDecimals={false}
              tickCount={5}
              label={{
                value: "Packets/s",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "currentColor" },
              }}
            />
            <Tooltip content={customTooltip} cursor={{ stroke: chartPrimary, strokeDasharray: "4" }} />
            <Area
              type="monotone"
              dataKey="total"
              stroke={chartPrimary}
              strokeWidth={2}
              fill="url(#packet-flow-area-gradient)"
              dot={false}
              activeDot={{ r: 4, fill: chartPrimary, stroke: "#fff", strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke={chartPrimary}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        ) : (
          <BarChart
            data={chartData}
            margin={MARGIN}
            onClick={handleChartClick}
            style={{ cursor: onBucketClick ? "pointer" : "default" }}
          >
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.1} />
            <XAxis
              {...commonAxisProps}
              dataKey="timestampMs"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickCount={5}
              tickFormatter={(value: number) =>
                new Date(value).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              }
            />
            <YAxis
              {...commonAxisProps}
              allowDecimals={false}
              tickCount={5}
              label={{
                value: "Packets/s",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "currentColor" },
              }}
            />
            <Tooltip content={customTooltip} cursor={{ fill: "transparent", stroke: chartPrimary, strokeDasharray: "4" }} />
            <Bar dataKey="total" fill={chartPrimary} opacity={0.8} />
            <Line
              type="monotone"
              dataKey="total"
              stroke={chartPrimary}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Responsive packet flow chart component.
 */
export function PacketFlowChart(props: PacketFlowChartProps) {
  return <PacketFlowChartInner {...props} />;
}

export default PacketFlowChart;
