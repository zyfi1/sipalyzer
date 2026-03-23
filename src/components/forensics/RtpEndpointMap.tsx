/**
 * RTP Topology Map — Deterministic Circular Endpoint Diagram
 *
 * Endpoints arranged in a circle, directed broken-line arrows between
 * source/destination pairs, quality-colored by MOS score.
 * Clean technical style matching SIPalyzer dark UI.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { saveExportFile } from "@/api/packetCapture";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Network, Download, Copy, Check } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { IpAddress } from "@/components/ui/IpAddress";
import { cn } from "@/lib/utils";
import { formatIpPortEndpoint } from "@/lib/networkUtils";
import { AppDivider } from "@/components/ui/panel-chrome";
import type { RtpStreamInfo } from "@/types/packetCapture";
import {
  drawDirectedBrokenLine,
  drawIconNode,
  getIconImage,
} from "@/lib/canvas-map-utils";

// ── Types ────────────────────────────────────────────────────────

export interface RtpEndpointMapProps {
  streams: RtpStreamInfo[];
  selectedStream: RtpStreamInfo | null;
  onSelectStream: (stream: RtpStreamInfo, index: number) => void;
}

// ── Quality helpers ──────────────────────────────────────────────

type Tier = "good" | "fair" | "poor";
function mos2tier(m: number): Tier {
  return m >= 4 ? "good" : m >= 3 ? "fair" : "poor";
}

const Q_COLOR: Record<Tier, string> = {
  good: "#34D399",
  fair: "#FBBF24",
  poor: "#F87171",
};
const Q_LABEL: Record<Tier, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

// ── Layout types ─────────────────────────────────────────────────

interface EndpointNode {
  id: string; // IP address
  x: number;
  y: number;
  radius: number;
  quality: Tier;
  streamCount: number;
  ports: number[];
}

interface StreamLink {
  stream: RtpStreamInfo;
  index: number;
  srcId: string;
  dstId: string;
  quality: Tier;
}

// ── Deterministic circular layout ────────────────────────────────

function computeLayout(
  streams: RtpStreamInfo[],
  width: number,
  height: number,
): { nodes: EndpointNode[]; links: StreamLink[] } {
  if (streams.length === 0) return { nodes: [], links: [] };

  // Collect unique endpoints by IP
  const epMap = new Map<
    string,
    { ports: Set<number>; mosSum: number; mosCount: number; streamCount: number }
  >();

  for (const s of streams) {
    for (const [ip, port] of [
      [s.srcIp, s.srcPort],
      [s.dstIp, s.dstPort],
    ] as [string, number][]) {
      if (!epMap.has(ip)) {
        epMap.set(ip, { ports: new Set(), mosSum: 0, mosCount: 0, streamCount: 0 });
      }
      const ep = epMap.get(ip)!;
      ep.ports.add(port);
      ep.mosSum += s.mosScore;
      ep.mosCount++;
      ep.streamCount++;
    }
  }

  // Sort IPs for determinism
  const sortedIps = [...epMap.keys()].sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 4; i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
  });

  const cx = width / 2;
  const cy = height / 2;
  const ringRadius = Math.min(width, height) * 0.35;

  // Size nodes proportional to stream count
  const maxStreams = Math.max(
    1,
    ...sortedIps.map((ip) => epMap.get(ip)!.streamCount),
  );

  const nodes: EndpointNode[] = sortedIps.map((ip, i) => {
    const ep = epMap.get(ip)!;
    const angle = (2 * Math.PI * i) / sortedIps.length - Math.PI / 2;
    const avgMos = ep.mosCount > 0 ? ep.mosSum / ep.mosCount : 4;
    const sizeRatio = ep.streamCount / maxStreams;
    const radius = 12 + sizeRatio * 8; // 12–20px

    return {
      id: ip,
      x: sortedIps.length === 1 ? cx : cx + ringRadius * Math.cos(angle),
      y: sortedIps.length === 1 ? cy : cy + ringRadius * Math.sin(angle),
      radius,
      quality: mos2tier(avgMos),
      streamCount: ep.streamCount / 2, // each stream is counted for both src + dst
      ports: [...ep.ports].sort((a, b) => a - b),
    };
  });

  // Build links
  const links: StreamLink[] = streams.map((s, i) => ({
    stream: s,
    index: i,
    srcId: s.srcIp,
    dstId: s.dstIp,
    quality: mos2tier(s.mosScore),
  }));

  return { nodes, links };
}

// ── Stream info panel ────────────────────────────────────────────

function StreamPanel({ stream }: { stream: RtpStreamInfo }) {
  const q = mos2tier(stream.mosScore);
  const c = Q_COLOR[q];
  return (
    <div className="packet-graphite-panel absolute top-3 right-3 w-72 z-10 overflow-hidden">
      <div className="h-0.5" style={{ backgroundColor: c }} />
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div
            className="h-8 w-8 rounded-md flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${c}20` }}
          >
            <Network className="h-4 w-4" style={{ color: c }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">
              {stream.codecName}
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              SSRC {stream.ssrc.toString(16).toUpperCase()}
            </p>
          </div>
          <Badge
            className={cn(
              "ml-auto text-2xs font-semibold",
              q === "good"
                ? "bg-success/20 text-success"
                : q === "fair"
                  ? "bg-warning/20 text-warning"
                  : "bg-destructive/20 text-destructive",
            )}
          >
            {Q_LABEL[q]}
          </Badge>
        </div>
        <div className="space-y-1.5 text-xs">
          <Row label="MOS" value={stream.mosScore.toFixed(2)} mono />
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-14 shrink-0 font-medium">Source</span>
            <IpAddress
              ip={formatIpPortEndpoint(stream.srcIp, stream.srcPort)}
              size="sm"
              variant="mono"
              className="min-w-0 flex-1 text-xs"
              showIpInfo={false}
              truncate
            />
          </div>
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-14 shrink-0 font-medium">Dest</span>
            <IpAddress
              ip={formatIpPortEndpoint(stream.dstIp, stream.dstPort)}
              size="sm"
              variant="mono"
              className="min-w-0 flex-1 text-xs"
              showIpInfo={false}
              truncate
            />
          </div>
          <Row
            label="Codec"
            value={`${stream.codecName} (PT ${stream.payloadType})`}
          />
          <Row
            label="Packets"
            value={stream.packetCount.toLocaleString()}
            mono
          />
          <Row
            label="Lost"
            value={`${stream.lostPackets.toLocaleString()} (${stream.lossPercentage.toFixed(2)}%)`}
            mono
          />
          <Row label="Jitter" value={`${stream.jitter.toFixed(2)} ms`} mono />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  copyable = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-start gap-2 group/row">
      <span className="text-muted-foreground w-14 shrink-0 font-medium">
        {label}
      </span>
      <span className={cn("break-all flex-1", mono && "font-mono tabular-nums")}>
        {value}
      </span>
      {copyable && (
        <TooltipWrapper title={copied ? "Copied!" : `Copy ${label}`}>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "shrink-0 p-0.5 rounded transition-smooth",
              copied
                ? "text-success opacity-100"
                : "text-muted-foreground/60 opacity-0 group-hover/row:opacity-100 hover:text-foreground",
            )}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </TooltipWrapper>
      )}
    </div>
  );
}

function QualityLegend({ streams }: { streams: RtpStreamInfo[] }) {
  const counts = useMemo(() => {
    const c: Record<Tier, number> = { good: 0, fair: 0, poor: 0 };
    for (const s of streams) c[mos2tier(s.mosScore)]++;
    return c;
  }, [streams]);
  return (
    <div className="absolute bottom-3 left-3 p-2.5 z-10 flex items-center gap-3 rounded-md border border-border/70 bg-background/90">
      {(Object.entries(counts) as [Tier, number][])
        .filter(([, n]) => n > 0)
        .map(([t, n]) => (
          <div key={t} className="flex items-center gap-1.5 text-2xs">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: Q_COLOR[t] }}
            />
            <span className="text-muted-foreground">{Q_LABEL[t]}</span>
            <Badge
              variant="secondary"
              className="text-3xs h-4 px-1 tabular-nums"
            >
              {n}
            </Badge>
          </div>
        ))}
    </div>
  );
}

// ── Canvas rendering ────────────────────────────────────────────

function renderCanvas(
  ctx: CanvasRenderingContext2D,
  nodes: EndpointNode[],
  links: StreamLink[],
  width: number,
  height: number,
  hovered: string | null,
  selectedStreamIdx: number | null,
  transform: { x: number; y: number; k: number },
) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Background tuned to match the Graphite Cobalt analysis palette.
  ctx.fillStyle = "#121a24";
  ctx.fillRect(0, 0, width, height);

  // Apply zoom/pan
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  // Build node lookup
  const nodeMap = new Map<string, EndpointNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Count same-pair links for offset computation
  const pairCounts = new Map<string, number>();
  const pairIdxMap = new Map<string, number>();
  for (const link of links) {
    const pairKey = [link.srcId, link.dstId].sort().join("↔");
    pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
  }

  // Draw links
  for (const link of links) {
    const src = nodeMap.get(link.srcId);
    const dst = nodeMap.get(link.dstId);
    if (!src || !dst) continue;

    const pairKey = [link.srcId, link.dstId].sort().join("↔");
    const totalInPair = pairCounts.get(pairKey) ?? 1;
    const idxInPair = pairIdxMap.get(pairKey) ?? 0;
    pairIdxMap.set(pairKey, idxInPair + 1);

    // Offset for multiple streams between same pair
    const offset =
      totalInPair > 1
        ? (idxInPair - (totalInPair - 1) / 2) * (8 / transform.k)
        : 0;

    const isHighlighted =
      link.index === selectedStreamIdx ||
      link.srcId === hovered ||
      link.dstId === hovered;

    const color = Q_COLOR[link.quality];
    const alpha = isHighlighted ? "70" : "30";
    const lw = (isHighlighted ? 2 : 1) / transform.k;
    const arrowSize = 6 / transform.k;

    drawDirectedBrokenLine(
      ctx,
      src.x + offset,
      src.y + offset,
      dst.x + offset,
      dst.y + offset,
      color + alpha,
      lw,
      arrowSize,
    );

    // Draw codec label on highlighted links
    if (isHighlighted && link.stream) {
      const midX = (src.x + dst.x) / 2 + offset;
      const midY = (src.y + dst.y) / 2 + offset;
      const fs = Math.max(9 / transform.k, 3);
      ctx.font = `500 ${fs}px "Geist Mono", Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = color + "AA";
      ctx.fillText(
        `${link.stream.codecName} MOS ${link.stream.mosScore.toFixed(1)}`,
        midX,
        midY - 6 / transform.k,
      );
    }
  }

  // Draw nodes
  for (const node of nodes) {
    const color = Q_COLOR[node.quality];
    const isH = node.id === hovered;
    const isS = links.some(
      (l) =>
        l.index === selectedStreamIdx &&
        (l.srcId === node.id || l.dstId === node.id),
    );

    drawIconNode(ctx, node.x, node.y, node.radius, color, "phone", {
      label: node.id,
      subLabel: `${Math.round(node.streamCount)} stream${Math.round(node.streamCount) !== 1 ? "s" : ""}`,
      isHovered: isH,
      isSelected: isS,
      scale: transform.k,
    });
  }

  ctx.restore();
}

// ── Hit testing ─────────────────────────────────────────────────

function hitTestNode(
  nodes: EndpointNode[],
  canvasX: number,
  canvasY: number,
  transform: { x: number; y: number; k: number },
): EndpointNode | null {
  const wx = (canvasX - transform.x) / transform.k;
  const wy = (canvasY - transform.y) / transform.k;

  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    const dx = wx - n.x;
    const dy = wy - n.y;
    const hitR = n.radius + 4;
    if (dx * dx + dy * dy <= hitR * hitR) return n;
  }
  return null;
}

function hitTestLink(
  links: StreamLink[],
  nodes: EndpointNode[],
  canvasX: number,
  canvasY: number,
  transform: { x: number; y: number; k: number },
): StreamLink | null {
  const wx = (canvasX - transform.x) / transform.k;
  const wy = (canvasY - transform.y) / transform.k;
  const nodeMap = new Map<string, EndpointNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const threshold = 8 / transform.k;

  for (const link of links) {
    const src = nodeMap.get(link.srcId);
    const dst = nodeMap.get(link.dstId);
    if (!src || !dst) continue;

    // Check proximity to the 3 segments of the broken line
    const midX = (src.x + dst.x) / 2;

    // Segment 1: src → (midX, src.y)
    if (
      distToSegment(wx, wy, src.x, src.y, midX, src.y) < threshold
    )
      return link;
    // Segment 2: (midX, src.y) → (midX, dst.y)
    if (
      distToSegment(wx, wy, midX, src.y, midX, dst.y) < threshold
    )
      return link;
    // Segment 3: (midX, dst.y) → dst
    if (
      distToSegment(wx, wy, midX, dst.y, dst.x, dst.y) < threshold
    )
      return link;
  }
  return null;
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ── Main component ───────────────────────────────────────────────

export function RtpEndpointMap({
  streams,
  selectedStream,
  onSelectStream,
}: RtpEndpointMapProps) {
  const [panel, setPanel] = useState<RtpStreamInfo | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dim, setDim] = useState({ width: 800, height: 600 });
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const { nodes, links } = useMemo(
    () => computeLayout(streams, dim.width, dim.height),
    [streams, dim.width, dim.height],
  );

  // Sync external selectedStream to internal index
  useEffect(() => {
    if (selectedStream) {
      const idx = streams.indexOf(selectedStream);
      if (idx >= 0) setSelectedIdx(idx);
    }
  }, [selectedStream, streams]);

  // Preload phone icons
  useEffect(() => {
    getIconImage("phone", "#ffffff", 48);
  }, []);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0];
      if (!r) return;
      const { width, height } = r.contentRect;
      if (width > 0 && height > 0) setDim({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Canvas setup
  const needsRedraw = useRef(true);
  const animRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dim.width * dpr;
    canvas.height = dim.height * dpr;
    canvas.style.width = `${dim.width}px`;
    canvas.style.height = `${dim.height}px`;
    ctx.scale(dpr, dpr);
    needsRedraw.current = true;
  }, [dim]);

  // Render loop
  useEffect(() => {
    function frame() {
      animRef.current = requestAnimationFrame(frame);
      if (!needsRedraw.current) return;
      needsRedraw.current = false;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderCanvas(
        ctx,
        nodes,
        links,
        dim.width,
        dim.height,
        hovered,
        selectedIdx,
        transformRef.current,
      );
      ctx.restore();
    }
    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [nodes, links, dim, hovered, selectedIdx]);

  // Schedule redraws on state changes
  useEffect(() => {
    needsRedraw.current = true;
  }, [nodes, links, hovered, selectedIdx]);

  // Reset transform when streams change
  useEffect(() => {
    transformRef.current = { x: 0, y: 0, k: 1 };
    needsRedraw.current = true;
  }, [streams.length, dim]);

  // ── Mouse handlers ──────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      if (isDragging.current) {
        const dx = cx - lastMouse.current.x;
        const dy = cy - lastMouse.current.y;
        transformRef.current.x += dx;
        transformRef.current.y += dy;
        lastMouse.current = { x: cx, y: cy };
        needsRedraw.current = true;
        return;
      }

      const hitNode = hitTestNode(nodes, cx, cy, transformRef.current);
      setHovered(hitNode ? hitNode.id : null);
    },
    [nodes],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      isDragging.current = true;
      lastMouse.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    [],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const dx = cx - lastMouse.current.x;
      const dy = cy - lastMouse.current.y;

      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        // Click — check node first, then link
        const hitNode = hitTestNode(nodes, cx, cy, transformRef.current);
        if (hitNode) {
          const s = streams.find(
            (st) => st.srcIp === hitNode.id || st.dstIp === hitNode.id,
          );
          if (s) {
            const idx = streams.indexOf(s);
            setPanel(s);
            setSelectedIdx(idx);
            onSelectStream(s, idx);
          }
        } else {
          const hitLink = hitTestLink(
            links,
            nodes,
            cx,
            cy,
            transformRef.current,
          );
          if (hitLink) {
            setPanel(hitLink.stream);
            setSelectedIdx(hitLink.index);
            onSelectStream(hitLink.stream, hitLink.index);
          } else {
            setPanel(null);
            setSelectedIdx(null);
          }
        }
      }

      isDragging.current = false;
    },
    [nodes, links, streams, onSelectStream],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const t = transformRef.current;
      const newK = Math.max(0.2, Math.min(5, t.k * factor));
      const ratio = newK / t.k;

      transformRef.current = {
        x: cx - (cx - t.x) * ratio,
        y: cy - (cy - t.y) * ratio,
        k: newK,
      };
      needsRedraw.current = true;
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    setHovered(null);
    isDragging.current = false;
  }, []);

  // ── Export / Zoom ────────────────────────────────────────────

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
    saveExportFile(`rtp-topology-${Date.now()}.png`, base64, "PNG images", "png").catch(() => {});
  }, []);

  const zoomToFit = useCallback(() => {
    transformRef.current = { x: 0, y: 0, k: 1 };
    needsRedraw.current = true;
  }, []);

  // ── Render ───────────────────────────────────────────────────

  if (!streams.length) {
    return (
      <EmptyState
        icon={<Network />}
        title="No RTP streams"
        description="Select a capture and a call to see the RTP topology."
        className="flex-1 p-4"
      />
    );
  }

  const display = panel ?? selectedStream;

  return (
    <div
      className="packet-graphite-panel flex-1 flex flex-col min-h-0 relative"
      style={{ minHeight: 400 }}
    >
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 rounded-md border border-border/70 bg-background/90 p-1">
        <Badge
          variant="secondary"
          className="text-2xs font-mono tabular-nums mx-1"
        >
          {streams.length} stream{streams.length !== 1 ? "s" : ""}
        </Badge>
        <AppDivider orientation="vertical" size="md" className="mx-0.5" />
        <TooltipWrapper content="Zoom to fit">
          <button
            type="button"
            onClick={zoomToFit}
            className="px-2 py-1 text-2xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-sm transition-smooth font-medium"
          >
            Fit
          </button>
        </TooltipWrapper>
        <TooltipWrapper content="Export PNG">
          <button
            type="button"
            onClick={exportPng}
            className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-sm transition-smooth"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </TooltipWrapper>
      </div>

      {display && <StreamPanel stream={display} />}
      <QualityLegend streams={streams} />

      <div ref={containerRef} className="flex-1 min-h-0">
        <canvas
          ref={canvasRef}
          className="block cursor-grab active:cursor-grabbing"
          style={{ width: dim.width, height: dim.height }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
        />
      </div>
    </div>
  );
}
