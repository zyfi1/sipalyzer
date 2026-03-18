import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface FlameNode {
  name: string;
  totalMs: number;
  selfMs: number;
  count: number;
  children: FlameNode[];
}

interface FlameChartProps {
  spans: {
    name: string;
    parent_span_id: string | null;
    span_id: string;
    duration_ms: number;
  }[];
  height?: number;
  className?: string;
}

function buildFlameTree(
  spans: FlameChartProps["spans"],
): FlameNode[] {
  const nameMap = new Map<string, { totalMs: number; count: number; childMs: number }>();

  for (const span of spans) {
    const existing = nameMap.get(span.name) ?? { totalMs: 0, count: 0, childMs: 0 };
    existing.totalMs += span.duration_ms;
    existing.count += 1;
    nameMap.set(span.name, existing);
  }

  const byParent = new Map<string | null, typeof spans>();
  for (const span of spans) {
    const key = span.parent_span_id;
    const list = byParent.get(key) ?? [];
    list.push(span);
    byParent.set(key, list);
  }

  for (const span of spans) {
    const children = byParent.get(span.span_id) ?? [];
    const entry = nameMap.get(span.name)!;
    for (const child of children) {
      entry.childMs += child.duration_ms;
    }
  }

  const nodes: FlameNode[] = [];
  for (const [name, data] of nameMap) {
    nodes.push({
      name,
      totalMs: data.totalMs,
      selfMs: Math.max(0, data.totalMs - data.childMs),
      count: data.count,
      children: [],
    });
  }

  nodes.sort((a, b) => b.totalMs - a.totalMs);
  return nodes;
}

const COLORS = [
  "bg-blue-500/70",
  "bg-emerald-500/70",
  "bg-amber-500/70",
  "bg-purple-500/70",
  "bg-rose-500/70",
  "bg-cyan-500/70",
  "bg-indigo-500/70",
  "bg-orange-500/70",
];

export function FlameChart({ spans, height = 300, className }: FlameChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const nodes = useMemo(() => buildFlameTree(spans), [spans]);

  const maxMs = useMemo(
    () => Math.max(...nodes.map((n) => n.totalMs), 1),
    [nodes],
  );

  if (nodes.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center text-muted-foreground text-sm", className)}
        style={{ height }}
      >
        No span data for flame chart
      </div>
    );
  }

  const barHeight = 28;
  const gap = 2;
  const totalHeight = Math.min(nodes.length * (barHeight + gap), height);

  return (
    <div
      className={cn("overflow-auto", className)}
      style={{ maxHeight: height }}
    >
      <div style={{ minHeight: totalHeight }}>
        {nodes.slice(0, 50).map((node, idx) => {
          const widthPct = (node.totalMs / maxMs) * 100;
          const selfPct = (node.selfMs / maxMs) * 100;
          const isHovered = hoveredIdx === idx;

          return (
            <div
              key={node.name}
              className="relative group cursor-default"
              style={{ height: barHeight, marginBottom: gap }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Total time bar */}
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-sm transition-opacity",
                  COLORS[idx % COLORS.length],
                  isHovered ? "opacity-100" : "opacity-70",
                )}
                style={{ width: `${widthPct}%`, minWidth: "2px" }}
              />
              {/* Self time overlay */}
              <div
                className="absolute inset-y-0 left-0 bg-white/10 rounded-sm"
                style={{ width: `${selfPct}%`, minWidth: node.selfMs > 0 ? "1px" : "0px" }}
              />
              {/* Label */}
              <div className="absolute inset-0 flex items-center px-2 text-xs truncate">
                <span className="font-medium truncate">{node.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums pl-2">
                  {node.totalMs.toFixed(1)}ms
                  {node.count > 1 && ` (x${node.count})`}
                </span>
              </div>

              {/* Tooltip */}
              {isHovered && (
                <div className="absolute left-0 top-full z-50 mt-1 bg-card border border-border/55 rounded-md shadow-card p-2 text-xs whitespace-nowrap">
                  <div className="font-medium">{node.name}</div>
                  <div className="text-muted-foreground mt-1 space-y-0.5">
                    <div>Total: {node.totalMs.toFixed(2)}ms</div>
                    <div>Self: {node.selfMs.toFixed(2)}ms</div>
                    <div>Count: {node.count}</div>
                    <div>Avg: {(node.totalMs / node.count).toFixed(2)}ms</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
