/**
 * Protocol distribution visualization using Recharts.
 *
 * Displays the breakdown of packets by protocol as a pie/donut chart.
 */

import { useMemo } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { EmptyState } from "@/components/ui/empty-state";
import type { PacketInfo } from "@/types/packetCapture";

/** Protocol colors matching the packet list. */
const PROTOCOL_COLORS: Record<string, string> = {
  SIP: "#60a5fa",
  RTP: "#34d399",
  RTCP: "#22d3d1",
  FAX: "#2dd4bf",
  TCP: "#9ca3af",
  UDP: "#6b7280",
  HTTP: "#fb923c",
  HTTPS: "#f97316",
  DNS: "#facc15",
  ICMP: "#f87171",
  ARP: "#f59e0b",
  OTHER: "#4b5563",
};

/** Protocol data for the chart. */
interface ProtocolData {
  protocol: string;
  count: number;
  percentage: number;
  bytes: number;
}

interface ProtocolDistributionChartProps {
  /** Packets to analyze. */
  packets: PacketInfo[];
  /** Show as donut (true) or pie (false). */
  donut?: boolean;
  /** Chart size. */
  size?: number;
  /** Show legend. */
  showLegend?: boolean;
  /** Callback when clicking on a protocol. */
  onProtocolClick?: (protocol: string) => void;
}

/**
 * Calculate protocol distribution from packets.
 */
function calculateDistribution(packets: PacketInfo[]): ProtocolData[] {
  const counts: Map<string, { count: number; bytes: number }> = new Map();

  for (const packet of packets) {
    const protocol = packet.protocol || "OTHER";
    const existing = counts.get(protocol) || { count: 0, bytes: 0 };
    existing.count++;
    existing.bytes += packet.size || packet.frameLength || 0;
    counts.set(protocol, existing);
  }

  const total = packets.length;
  const result: ProtocolData[] = [];

  for (const [protocol, data] of counts) {
    result.push({
      protocol,
      count: data.count,
      percentage: total > 0 ? (data.count / total) * 100 : 0,
      bytes: data.bytes,
    });
  }

  return result.sort((a, b) => b.count - a.count);
}

/**
 * Format bytes to human readable.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Inner chart component.
 */
function ProtocolDistributionChartInner({
  height,
  packets,
  donut = true,
  showLegend = true,
  onProtocolClick,
}: ProtocolDistributionChartProps & { height: number }) {
  const data = useMemo(() => calculateDistribution(packets), [packets]);

  const radius = height / 2 - 10;
  const innerRadius = donut ? radius * 0.6 : 0;
  const totalCount = useMemo(
    () => data.reduce((sum, d) => sum + d.count, 0),
    [data]
  );

  if (data.length === 0) {
    return (
      <EmptyState compact variant="inline" title="No packet data to display" />
    );
  }

  return (
    <div className="flex w-full items-center">
      <div className="relative min-w-0 flex-1" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="protocol"
              cx="50%"
              cy="50%"
              outerRadius={radius}
              innerRadius={innerRadius}
              paddingAngle={0.8}
              stroke="hsl(var(--background))"
              strokeWidth={2}
              onClick={(_, index) => {
                const target =
                  typeof index === "number" ? data[index] : undefined;
                if (target) onProtocolClick?.(target.protocol);
              }}
              label={({ percent, cx, cy, midAngle, innerRadius, outerRadius }) => {
                if (!percent || percent < 0.04) return null;
                const r = Number(innerRadius) + (Number(outerRadius) - Number(innerRadius)) * 0.5;
                const x = Number(cx) + r * Math.cos((-Number(midAngle) * Math.PI) / 180);
                const y = Number(cy) + r * Math.sin((-Number(midAngle) * Math.PI) / 180);
                return (
                  <text
                    x={x}
                    y={y}
                    fill="white"
                    fontSize={10}
                    fontWeight="bold"
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                  >
                    {(percent * 100).toFixed(0)}%
                  </text>
                );
              }}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.protocol}
                  fill={PROTOCOL_COLORS[entry.protocol] || PROTOCOL_COLORS.OTHER}
                  style={{ cursor: onProtocolClick ? "pointer" : "default" }}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }: any) => {
                if (!active || !payload?.length) return null;
                const first = payload[0];
                const item = first?.payload as ProtocolData | undefined;
                if (!item) return null;
                return (
                  <div
                    style={{
                      background: "hsl(var(--card) / 0.98)",
                      color: "hsl(var(--foreground))",
                      border: "1px solid hsl(var(--border) / 0.55)",
                      borderRadius: "6px",
                      padding: "8px 12px",
                      fontSize: "12px",
                    }}
                  >
                    <div className="font-semibold">{item.protocol}</div>
                    <div className="text-muted-foreground">
                      {item.count.toLocaleString()} packets ({item.percentage.toFixed(1)}%)
                    </div>
                    <div className="text-muted-foreground">{formatBytes(item.bytes)}</div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center label for donut */}
        {donut && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[20px] font-bold text-foreground">
              {totalCount.toLocaleString()}
            </div>
            <div className="text-[11px] text-muted-foreground">packets</div>
          </div>
        )}
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="ml-2 flex flex-col gap-1">
          {data.slice(0, 8).map((d) => (
            <div
              key={d.protocol}
              className="flex cursor-pointer items-center gap-2 text-xs hover:opacity-80"
              onClick={() => onProtocolClick?.(d.protocol)}
            >
              <div
                className="h-3 w-3 flex-shrink-0 rounded-md"
                style={{
                  backgroundColor: PROTOCOL_COLORS[d.protocol] || PROTOCOL_COLORS.OTHER,
                }}
              />
              <span className="font-medium">{d.protocol}</span>
              <span className="ml-auto text-muted-foreground">
                {d.count.toLocaleString()}
              </span>
            </div>
          ))}
          {data.length > 8 && (
            <div className="text-xs text-muted-foreground">
              +{data.length - 8} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Responsive protocol distribution chart.
 */
export function ProtocolDistributionChart(props: ProtocolDistributionChartProps) {
  const size = props.size || 200;

  return (
    <div className="w-full" style={{ minWidth: size }}>
      <ProtocolDistributionChartInner
        height={size}
        {...props}
      />
    </div>
  );
}

export default ProtocolDistributionChart;
