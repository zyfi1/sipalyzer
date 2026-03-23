import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface WaterfallSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  start_time_unix_ms: number;
  end_time_unix_ms: number;
  duration_ms: number;
  status: string;
  status_message?: string | null;
  kind: string;
  source: string;
  service_name?: string;
  attributes?: [string, string][];
  events?: { name: string; timestamp_unix_ms: number; attributes: [string, string][] }[];
}

interface TraceWaterfallProps {
  spans: WaterfallSpan[];
  onSpanClick?: (span: WaterfallSpan) => void;
  selectedSpanId?: string;
  maxHeight?: number;
}

interface TreeNode {
  span: WaterfallSpan;
  children: TreeNode[];
  depth: number;
}

function buildTree(spans: WaterfallSpan[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  const sorted = [...spans].sort((a, b) => a.start_time_unix_ms - b.start_time_unix_ms);
  for (const span of sorted) {
    byId.set(span.span_id, { span, children: [], depth: 0 });
  }
  for (const node of byId.values()) {
    const parentId = node.span.parent_span_id;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepths(node: TreeNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) setDepths(child, depth + 1);
  }
  for (const root of roots) setDepths(root, 0);
  return roots;
}

function flattenTree(nodes: TreeNode[], collapsed: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(node: TreeNode) {
    result.push(node);
    if (!collapsed.has(node.span.span_id)) {
      for (const child of node.children) walk(child);
    }
  }
  for (const root of nodes) walk(root);
  return result;
}

function durationColor(ms: number): string {
  if (ms < 50) return "bg-emerald-500";
  if (ms < 200) return "bg-green-500";
  if (ms < 500) return "bg-yellow-500";
  if (ms < 1000) return "bg-orange-500";
  return "bg-red-500";
}

function statusDot(status: string): string {
  if (status === "ok") return "bg-emerald-400";
  if (status === "error") return "bg-red-400";
  return "bg-muted-foreground/40";
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function TraceWaterfall({ spans, onSpanClick, selectedSpanId, maxHeight }: TraceWaterfallProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(spans), [spans]);
  const flatNodes = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  const traceStart = useMemo(
    () => Math.min(...spans.map((s) => s.start_time_unix_ms)),
    [spans],
  );
  const traceEnd = useMemo(
    () => Math.max(...spans.map((s) => s.end_time_unix_ms)),
    [spans],
  );
  const totalDuration = traceEnd - traceStart || 1;

  const toggleCollapse = (spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  if (spans.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        No spans to display
      </div>
    );
  }

  return (
    <div className="w-full overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <div className="min-w-[600px]">
        {/* Header */}
        <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider px-2 py-1 border-b border-border/30">
          <div className="w-[280px] shrink-0">Operation</div>
          <div className="flex-1 flex justify-between px-2">
            <span>0ms</span>
            <span>{formatDuration(totalDuration / 4)}</span>
            <span>{formatDuration(totalDuration / 2)}</span>
            <span>{formatDuration((totalDuration * 3) / 4)}</span>
            <span>{formatDuration(totalDuration)}</span>
          </div>
        </div>

        {/* Rows */}
        {flatNodes.map((node) => {
          const { span } = node;
          const offsetPct = ((span.start_time_unix_ms - traceStart) / totalDuration) * 100;
          const widthPct = Math.max((span.duration_ms / totalDuration) * 100, 0.5);
          const hasChildren = node.children.length > 0;
          const isCollapsed = collapsed.has(span.span_id);
          const isSelected = span.span_id === selectedSpanId;

          return (
            <div
              key={span.span_id}
              className={cn(
                "flex items-center h-7 border-b border-border/10 cursor-pointer hover:bg-muted/30 transition-colors",
                isSelected && "bg-muted/50",
              )}
              onClick={() => onSpanClick?.(span)}
            >
              {/* Name column */}
              <div
                className="w-[280px] shrink-0 flex items-center gap-1 px-2 overflow-hidden"
                style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
              >
                {hasChildren && (
                  <button
                    className="text-muted-foreground hover:text-foreground w-3 h-3 flex items-center justify-center text-[10px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(span.span_id);
                    }}
                  >
                    {isCollapsed ? "+" : "-"}
                  </button>
                )}
                {!hasChildren && <span className="w-3" />}
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDot(span.status))} />
                <span className="text-xs truncate">{span.name}</span>
              </div>

              {/* Bar column */}
              <div className="flex-1 relative h-full px-2">
                <div
                  className={cn("absolute top-1.5 h-3.5 rounded-sm opacity-80", durationColor(span.duration_ms))}
                  style={{
                    left: `${offsetPct}%`,
                    width: `${widthPct}%`,
                    minWidth: "2px",
                  }}
                />
                <span
                  className="absolute top-0.5 text-[10px] text-muted-foreground whitespace-nowrap"
                  style={{ left: `${Math.min(offsetPct + widthPct + 1, 90)}%` }}
                >
                  {formatDuration(span.duration_ms)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SpanDetails({ span }: { span: WaterfallSpan }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex gap-2 flex-wrap">
        <Badge variant="secondary" className="text-[10px]">{span.kind}</Badge>
        <Badge variant="secondary" className="text-[10px]">{span.source}</Badge>
        <Badge
          variant={span.status === "error" ? "destructive" : "secondary"}
          className="text-[10px]"
        >
          {span.status}
        </Badge>
        <span className="text-muted-foreground tabular-nums">
          {formatDuration(span.duration_ms)}
        </span>
      </div>

      {span.status_message && (
        <div className="bg-destructive/10 text-destructive p-2 rounded text-[11px]">
          {span.status_message}
        </div>
      )}

      {span.attributes && span.attributes.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Attributes
          </div>
          <div className="bg-muted/30 rounded p-2 space-y-0.5">
            {span.attributes.map(([k, v], i) => (
              <div key={i} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{k}:</span>
                <span className="break-all">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {span.events && span.events.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Events
          </div>
          <div className="space-y-1">
            {span.events.map((evt, i) => (
              <div key={i} className="bg-muted/30 rounded p-2">
                <span className="font-medium">{evt.name}</span>
                <span className="text-muted-foreground ml-2 tabular-nums">
                  {new Date(evt.timestamp_unix_ms).toISOString().slice(11, 23)}
                </span>
                {evt.attributes.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {evt.attributes.map(([k, v], j) => (
                      <div key={j} className="flex gap-2 text-[10px]">
                        <span className="text-muted-foreground">{k}:</span>
                        <span>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
