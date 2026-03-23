import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ChevronDown, ChevronRight } from "@/lib/icons";
import { tooltips } from "@/lib/tooltips";
import { cn } from "@/lib/utils";
import type { PacketDiffRow } from "./packetDiffEngine";
import { correlationKeysForPacket, voipQualityHint } from "./packetCorrelation";
import { diffPacketFields } from "./packetFieldDiff";
import {
  buildRtpCollapsedItems,
  collapsedRunSummary,
  computeInterArrivalDeltasForFlat,
  DEFAULT_RTP_COLLAPSE_MIN_RUN,
  flattenVisibleItems,
} from "./packetDiffRtpCollapse";
import type { PacketDiffFlatRow } from "./packetDiffRtpCollapse";
import {
  fieldStatusToneClasses,
  rowStatusMarkerClasses,
} from "./packetDiffUiTone";

interface PacketDiffSplitViewProps {
  rows: PacketDiffRow[];
  loading: boolean;
  error: string | null;
  leftLabel: string;
  rightLabel: string;
  onOpenPacket: (side: "left" | "right", packetIndex: number) => void;
}

function packetTooltipSummary(packet: PacketDiffRow["left"]): { title: string; description: string } {
  if (!packet) {
    return {
      title: "Missing packet",
      description: "No packet exists on this side for the selected diff row.",
    };
  }
  const app = packet.decoded?.application;
  const qoe = voipQualityHint(packet);
  const qoeSuffix = qoe ? ` | ${qoe}` : "";
  if (app?.type === "Sip") {
    const method = app.data.method ? app.data.method.toUpperCase() : null;
    const response = app.data.responseCode
      ? `${app.data.responseCode}${app.data.responseText ? ` ${app.data.responseText}` : ""}`
      : null;
    return {
      title: `SIP ${method ?? response ?? "message"}`,
      description: `Call-ID: ${app.data.callId ?? "unknown"} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}${qoeSuffix}`,
    };
  }
  if (app?.type === "SipOverWs") {
    const sip = app.data.sip;
    const method = sip.method ? sip.method.toUpperCase() : null;
    const response = sip.responseCode
      ? `${sip.responseCode}${sip.responseText ? ` ${sip.responseText}` : ""}`
      : null;
    return {
      title: `SIP (WS) ${method ?? response ?? "message"}`,
      description: `Call-ID: ${sip.callId ?? "unknown"} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}${qoeSuffix}`,
    };
  }
  if (app?.type === "Rtp" || app?.type === "Srtp") {
    return {
      title: `${app.type.toUpperCase()} PT ${app.data.payloadType}`,
      description: `SSRC: ${app.data.ssrc} | Seq: ${app.data.sequenceNumber} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}${qoeSuffix}`,
    };
  }
  if (app?.type === "Rtcp") {
    const first = app.data.packets[0];
    return {
      title: "RTCP report",
      description: `Packets: ${app.data.packets.length} | First type: ${first?.packetType ?? "unknown"} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}${qoeSuffix}`,
    };
  }
  if (app?.type === "Dns") {
    const query = app.data.queries[0]?.name ?? "unknown";
    return {
      title: app.data.isResponse ? "DNS response" : "DNS query",
      description: `${query} | RCODE: ${app.data.responseCode} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`,
    };
  }
  if (app?.type === "T38") {
    return {
      title: "T.38 fax packet",
      description: `Seq: ${app.data.seq} | IFP: ${app.data.ifpType ?? "unknown"} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`,
    };
  }
  return {
    title: `${packet.protocol} packet`,
    description: `${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort} | ${compactText(packet.summary, 160)}`,
  };
}

function compactText(value: string, max = 88): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function packetDetailText(side: "A" | "B", row: PacketDiffRow): string {
  const packet = side === "A" ? row.left : row.right;
  const idx = side === "A" ? row.leftIndex : row.rightIndex;
  if (!packet) return "—";
  const app = packet.decoded?.application;
  const appHint = app ? app.type : "Unknown";
  const qoe = voipQualityHint(packet);
  const lines = [
    `Frame #${typeof idx === "number" ? idx + 1 : "—"}`,
    `Time: ${packet.timestamp}`,
    `Protocol: ${packet.protocol}`,
    `Endpoint: ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`,
    `Length: ${packet.frameLength ?? packet.size}`,
    `App: ${appHint}`,
    `Summary: ${packet.summary}`,
  ];
  if (qoe) lines.push(`QoE (RTCP-XR): ${qoe}`);
  return lines.join("\n");
}

const ROW_HEIGHT_CLASS = "h-[68px]";

function statusSymbol(status: PacketDiffRow["status"]): string {
  if (status === "exact") return "=";
  if (status === "changed") return "~";
  if (status === "left_only") return "-";
  return "+";
}

function rowCompareHint(status: PacketDiffRow["status"]): string {
  switch (status) {
    case "exact":
      return "Same decode on both captures";
    case "changed":
      return "Paired frames, but decoded fields differ";
    case "left_only":
      return "Frame on A — nothing matched on B";
    case "right_only":
      return "Frame on B — nothing matched on A";
    default:
      return "";
  }
}

function deltaLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function deltaToneClasses(ms: number | null): string {
  if (ms === null) return "text-muted-foreground/40";
  if (ms < 30) return "text-muted-foreground";
  if (ms < 100) return "text-warning";
  return "text-destructive";
}

function deltaMeterClass(ms: number | null): string {
  if (ms === null) return "bg-muted/25";
  if (ms < 30) return "bg-success/35";
  if (ms < 100) return "bg-warning/55";
  return "bg-destructive/55";
}

function mergeCorrelationKeys(row: PacketDiffRow): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of correlationKeysForPacket(row.left)) {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  for (const k of correlationKeysForPacket(row.right)) {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function mergeCorrelationKeysForRows(packetRows: PacketDiffRow[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of packetRows) {
    for (const k of mergeCorrelationKeys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

function keysForFlatHover(fr: PacketDiffFlatRow): string[] {
  if (fr.collapsed) return mergeCorrelationKeysForRows(fr.collapsed.rows);
  return mergeCorrelationKeys(fr.row);
}

export function PacketDiffSplitView({
  rows,
  loading,
  error,
  leftLabel,
  rightLabel,
  onOpenPacket,
}: PacketDiffSplitViewProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showUnchangedFields, setShowUnchangedFields] = useState(false);
  const [dimExactMatches, setDimExactMatches] = useState(true);
  const [collapseRtpRuns, setCollapseRtpRuns] = useState(false);
  const [expandedCollapsedIds, setExpandedCollapsedIds] = useState(() => new Set<string>());
  const [hoverCorrelKeys, setHoverCorrelKeys] = useState<string[] | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hoverClearTimerRef.current) clearTimeout(hoverClearTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!collapseRtpRuns) setExpandedCollapsedIds(new Set());
  }, [collapseRtpRuns]);

  const beginHoverKeys = (keys: string[]) => {
    if (hoverClearTimerRef.current) {
      clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    setHoverCorrelKeys(keys.length > 0 ? keys : null);
  };

  const scheduleClearHoverKeys = () => {
    if (hoverClearTimerRef.current) clearTimeout(hoverClearTimerRef.current);
    hoverClearTimerRef.current = setTimeout(() => {
      setHoverCorrelKeys(null);
      hoverClearTimerRef.current = null;
    }, 48);
  };

  const visibleItems = useMemo(
    () => buildRtpCollapsedItems(rows, { enabled: collapseRtpRuns, minRun: DEFAULT_RTP_COLLAPSE_MIN_RUN }),
    [rows, collapseRtpRuns],
  );

  const flatRows = useMemo(
    () => flattenVisibleItems(visibleItems, expandedCollapsedIds),
    [visibleItems, expandedCollapsedIds],
  );

  const correlationDisplayKeys = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (correlKey: string, displayKey: string) => {
      let s = map.get(correlKey);
      if (!s) {
        s = new Set();
        map.set(correlKey, s);
      }
      s.add(displayKey);
    };
    for (const fr of flatRows) {
      if (fr.collapsed) {
        for (const r of fr.collapsed.rows) {
          for (const k of mergeCorrelationKeys(r)) add(k, fr.displayKey);
        }
      } else {
        for (const k of mergeCorrelationKeys(fr.row)) add(k, fr.displayKey);
      }
    }
    return map;
  }, [flatRows]);

  const hoverHighlightedDisplayIds = useMemo(() => {
    if (!hoverCorrelKeys || hoverCorrelKeys.length === 0) return null;
    const out = new Set<string>();
    for (const k of hoverCorrelKeys) {
      const s = correlationDisplayKeys.get(k);
      if (s) {
        for (const dk of s) out.add(dk);
      }
    }
    return out.size > 0 ? out : null;
  }, [hoverCorrelKeys, correlationDisplayKeys]);

  const leftDeltas = useMemo(() => computeInterArrivalDeltasForFlat(flatRows, "left"), [flatRows]);
  const rightDeltas = useMemo(() => computeInterArrivalDeltasForFlat(flatRows, "right"), [flatRows]);

  const selectedFlat = useMemo(() => {
    if (flatRows.length === 0) return null;
    if (selectedKey) {
      const f = flatRows.find((x) => x.displayKey === selectedKey);
      if (f) return f;
    }
    return flatRows[0] ?? null;
  }, [flatRows, selectedKey]);

  const selectedRow = selectedFlat?.row ?? null;
  const selectedCollapsedBanner = selectedFlat?.collapsed ?? null;
  const isCollapsedBannerSelected = Boolean(selectedCollapsedBanner);

  const handleExpandCollapsed = (id: string, firstRowKey: string) => {
    setExpandedCollapsedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSelectedKey(firstRowKey);
  };

  const handleReCollapseRun = (collapsedId: string) => {
    setExpandedCollapsedIds((prev) => {
      const next = new Set(prev);
      next.delete(collapsedId);
      return next;
    });
    setSelectedKey(collapsedId);
  };

  const summary = {
    exact: rows.filter((row) => row.status === "exact").length,
    changed: rows.filter((row) => row.status === "changed").length,
    leftOnly: rows.filter((row) => row.status === "left_only").length,
    rightOnly: rows.filter((row) => row.status === "right_only").length,
  };

  const selectedFieldRows = useMemo(
    () => (selectedRow && !isCollapsedBannerSelected ? diffPacketFields(selectedRow.left, selectedRow.right) : []),
    [selectedRow, isCollapsedBannerSelected],
  );
  const changedFieldCount = selectedFieldRows.filter((row) => row.status === "changed").length;
  const leftOnlyFieldCount = selectedFieldRows.filter((row) => row.status === "left_only").length;
  const rightOnlyFieldCount = selectedFieldRows.filter((row) => row.status === "right_only").length;
  const visibleFieldRows = showUnchangedFields
    ? selectedFieldRows
    : selectedFieldRows.filter((row) => row.status !== "same");

  const collapsedSummary = selectedCollapsedBanner ? collapsedRunSummary(selectedCollapsedBanner.rows) : null;

  return (
    <section className="surface-flat overflow-hidden">
      <div className="px-3 py-2 border-b border-border/25 bg-background/35 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-2xs text-muted-foreground shrink-0">Visible rows:</span>
        <TooltipWrapper entry={tooltips.packetDiffExactCount}>
          <Badge variant="secondary" className="h-5 px-1.5 text-2xs">
            {summary.exact} same
          </Badge>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffChangedCount}>
          <Badge variant="secondary" className="h-5 px-1.5 text-2xs border-warning/35 text-warning">
            {summary.changed} different
          </Badge>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffLeftOnlyCount}>
          <Badge variant="secondary" className="h-5 px-1.5 text-2xs">
            {summary.leftOnly} only A
          </Badge>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffRightOnlyCount}>
          <Badge variant="secondary" className="h-5 px-1.5 text-2xs">
            {summary.rightOnly} only B
          </Badge>
        </TooltipWrapper>
        <details className="ml-auto min-w-0 flex flex-col items-end sm:flex-row sm:items-center gap-1">
          <summary className="list-none cursor-pointer text-2xs text-muted-foreground hover:text-foreground select-none [&::-webkit-details-marker]:hidden">
            Table options ▾
          </summary>
          <div className="flex flex-wrap justify-end gap-1 pt-1 sm:pt-0">
            <TooltipWrapper entry={tooltips.packetDiffCollapseRtp}>
              <Button
                variant={collapseRtpRuns ? "default" : "neutral"}
                size="sm"
                className="h-5 px-2 text-2xs"
                onClick={(e) => {
                  e.preventDefault();
                  setCollapseRtpRuns((v) => !v);
                }}
              >
                {collapseRtpRuns ? "Long RTP runs collapsed" : "Show every RTP row"}
              </Button>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.packetDiffDimExact}>
              <Button
                variant={dimExactMatches ? "default" : "neutral"}
                size="sm"
                className="h-5 px-2 text-2xs"
                onClick={(e) => {
                  e.preventDefault();
                  setDimExactMatches((v) => !v);
                }}
              >
                {dimExactMatches ? "Fade matching rows" : "Same brightness for all"}
              </Button>
            </TooltipWrapper>
          </div>
        </details>
      </div>

      <p className="px-3 py-1.5 text-[11px] leading-snug text-muted-foreground border-b border-border/25 bg-muted/[0.06]">
        <span className="text-foreground/90 font-medium">Tip:</span> Hover a packet to highlight related SIP or RTP on
        the other side. Center column: <span className="font-mono">=</span> same decode,{" "}
        <span className="font-mono">~</span> paired but different, <span className="font-mono">−</span> /{" "}
        <span className="font-mono">+</span> only on one capture.
      </p>

      <div className="sticky top-0 z-10 grid grid-cols-[52px_minmax(0,1fr)_48px_minmax(0,1fr)_52px] gap-1 px-3 py-2 text-2xs font-medium text-muted-foreground border-b border-border/35 bg-[hsl(var(--card)/0.98)]">
        <TooltipWrapper entry={tooltips.packetDiffDeltaTime}>
          <div className="text-center leading-tight">
            Gap
            <span className="block font-normal text-[9px] text-muted-foreground/90 normal-case">(ms)</span>
          </div>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffLaneLeft}>
          <div className="truncate">{leftLabel}</div>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffLaneStatus}>
          <div className="text-center leading-tight px-0.5">
            Match
            <span className="block font-normal text-[9px] text-muted-foreground/90 normal-case">= ~ − +</span>
          </div>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffLaneRight}>
          <div className="truncate">{rightLabel}</div>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffDeltaTime}>
          <div className="text-center leading-tight">
            Gap
            <span className="block font-normal text-[9px] text-muted-foreground/90 normal-case">(ms)</span>
          </div>
        </TooltipWrapper>
      </div>

      {loading ? (
        <div className="px-3 py-3 text-2xs text-muted-foreground">Loading packet diff…</div>
      ) : error ? (
        <div className="px-3 py-3 text-2xs text-destructive">Packet diff failed: {error}</div>
      ) : rows.length === 0 ? (
        <div className="px-3 py-3 text-2xs text-muted-foreground">
          No packets available for packet diff.
        </div>
      ) : (
        <div className="flex flex-col">
          <div ref={scrollRef} className="overflow-auto max-h-[min(520px,52vh)] px-3">
            <div className="grid grid-cols-[52px_minmax(0,1fr)_48px_minmax(0,1fr)_52px] gap-x-1">
              {flatRows.map((fr, rowIndex) => {
                const leftMs = leftDeltas[rowIndex] ?? null;
                const rightMs = rightDeltas[rowIndex] ?? null;
                const correlRow = hoverHighlightedDisplayIds?.has(fr.displayKey) ?? false;
                const isSelected = selectedFlat?.displayKey === fr.displayKey;
                const isBanner = fr.collapsed !== null;
                const run = fr.collapsed?.rows;
                const sum = isBanner && run ? collapsedRunSummary(run) : null;

                const rowForMarkers = fr.row;
                const leftPacket = fr.row.left;
                const rightPacket = fr.row.right;
                const leftTooltip = packetTooltipSummary(leftPacket);
                const rightTooltip = packetTooltipSummary(rightPacket);
                const dimRow = !isBanner && dimExactMatches && fr.row.status === "exact";

                const prevFr = rowIndex > 0 ? flatRows[rowIndex - 1] : null;
                const isFirstInExpandedRun =
                  Boolean(fr.expandedFromCollapsedId) &&
                  (!prevFr || prevFr.expandedFromCollapsedId !== fr.expandedFromCollapsedId);

                return (
                  <Fragment key={fr.displayKey}>
                    <div
                      className={cn(
                        "flex flex-col items-center justify-center gap-0.5 border-b border-border/20",
                        ROW_HEIGHT_CLASS,
                        correlRow && "bg-primary/[0.06]",
                      )}
                      onMouseEnter={() => beginHoverKeys(keysForFlatHover(fr))}
                      onMouseLeave={scheduleClearHoverKeys}
                    >
                      <span className={cn("font-mono text-[10px] tabular-nums", deltaToneClasses(leftMs))}>
                        {deltaLabel(leftMs)}
                      </span>
                      <div
                        className={cn("h-1 w-6 rounded-sm shrink-0", deltaMeterClass(leftMs))}
                        title="Inter-arrival vs previous visible row (capture A)"
                      />
                    </div>
                    <div
                      className={cn(
                        "relative cursor-pointer border-b border-border/20 pl-3.5 pr-2 min-w-0 flex items-center",
                        ROW_HEIGHT_CLASS,
                        correlRow && "bg-primary/[0.06]",
                        isSelected && "bg-accent/10 ring-1 ring-inset ring-accent/40",
                      )}
                      onClick={() => setSelectedKey(fr.displayKey)}
                      onMouseEnter={() => beginHoverKeys(keysForFlatHover(fr))}
                      onMouseLeave={scheduleClearHoverKeys}
                    >
                      <div
                        className={cn(
                          "absolute top-0 left-0 h-full w-[3px]",
                          rowStatusMarkerClasses(rowForMarkers.status),
                        )}
                      />
                      {isBanner && run && sum && fr.collapsed ? (
                        <div className="flex items-center gap-2 min-w-0 w-full">
                          <TooltipWrapper entry={tooltips.packetDiffCollapseRtp}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 shrink-0 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExpandCollapsed(fr.collapsed!.id, run[0]!.key);
                              }}
                            >
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </TooltipWrapper>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-foreground truncate">{sum.label}</div>
                            <div className="text-2xs text-muted-foreground truncate">
                              {sum.codecLabel} · {sum.seqRange}
                            </div>
                            <div className="text-2xs text-muted-foreground/80 font-mono truncate hidden lg:block">
                              A {sum.frameRangeA}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="min-w-0 w-full">
                          {isFirstInExpandedRun && fr.expandedFromCollapsedId ? (
                            <button
                              type="button"
                              className="mb-0.5 text-2xs text-primary hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReCollapseRun(fr.expandedFromCollapsedId!);
                              }}
                            >
                              Collapse run
                            </button>
                          ) : null}
                          {leftPacket ? (
                            <TooltipWrapper
                              title={leftTooltip.title}
                              description={leftTooltip.description}
                              side="top"
                              sideOffset={8}
                            >
                              <div className={cn("min-w-0 overflow-hidden w-full", dimRow && "opacity-[0.78]")}>
                                <div className="flex items-center gap-1.5 min-w-0 text-xs leading-4">
                                  <span className="shrink-0 rounded border border-border/45 bg-background/70 px-1 font-mono text-3xs">
                                    #{typeof fr.row.leftIndex === "number" ? fr.row.leftIndex + 1 : "—"}
                                  </span>
                                  <span className="truncate font-mono uppercase text-[11px] text-muted-foreground">
                                    {leftPacket.protocol}
                                  </span>
                                </div>
                                <div
                                  className="mt-0.5 truncate text-[13px] leading-5 text-foreground/90"
                                  title={`${leftPacket.summary} | ${leftPacket.srcIp}:${leftPacket.srcPort} -> ${leftPacket.dstIp}:${leftPacket.dstPort}`}
                                >
                                  {compactText(leftPacket.summary, 110)}
                                </div>
                                <div className="mt-0.5 hidden truncate font-mono text-[10px] leading-4 text-muted-foreground lg:block">
                                  {`${leftPacket.srcIp}:${leftPacket.srcPort} -> ${leftPacket.dstIp}:${leftPacket.dstPort}`}
                                </div>
                              </div>
                            </TooltipWrapper>
                          ) : (
                            <div className="grid h-full w-full place-items-center text-3xs text-muted-foreground/70">—</div>
                          )}
                        </div>
                      )}
                    </div>
                    <div
                      className={cn(
                        "flex flex-col items-center justify-center gap-0.5 border-b border-border/20 cursor-pointer",
                        ROW_HEIGHT_CLASS,
                        correlRow && "bg-primary/[0.06]",
                        isSelected && "bg-accent/10 ring-1 ring-inset ring-accent/40",
                      )}
                      onClick={() => setSelectedKey(fr.displayKey)}
                      onMouseEnter={() => beginHoverKeys(keysForFlatHover(fr))}
                      onMouseLeave={scheduleClearHoverKeys}
                      title={rowCompareHint(rowForMarkers.status)}
                    >
                      <TooltipWrapper
                        title={rowCompareHint(rowForMarkers.status)}
                        description={tooltips.packetDiffLaneStatus.description}
                      >
                        <span
                          className={cn(
                            "inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-semibold",
                            rowForMarkers.status === "exact" && "border-success/35 text-success",
                            rowForMarkers.status === "changed" && "border-warning/35 text-warning",
                            rowForMarkers.status === "left_only" && "border-destructive/35 text-destructive",
                            rowForMarkers.status === "right_only" && "border-success/35 text-success",
                          )}
                        >
                          {isBanner ? "≡" : statusSymbol(rowForMarkers.status)}
                        </span>
                      </TooltipWrapper>
                      {isBanner && run ? (
                        <Badge variant="secondary" className="h-4 px-1 text-[9px] tabular-nums">
                          {run.length}
                        </Badge>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        "relative cursor-pointer border-b border-border/20 pl-2 pr-3.5 min-w-0 flex items-center",
                        ROW_HEIGHT_CLASS,
                        correlRow && "bg-primary/[0.06]",
                        isSelected && "bg-accent/10 ring-1 ring-inset ring-accent/40",
                      )}
                      onClick={() => setSelectedKey(fr.displayKey)}
                      onMouseEnter={() => beginHoverKeys(keysForFlatHover(fr))}
                      onMouseLeave={scheduleClearHoverKeys}
                    >
                      <div
                        className={cn(
                          "absolute top-0 right-0 h-full w-[3px]",
                          rowStatusMarkerClasses(rowForMarkers.status),
                        )}
                      />
                      {isBanner && run && sum && fr.collapsed ? (
                        <div className="flex items-center gap-2 min-w-0 w-full justify-end">
                          <div className="min-w-0 flex-1 text-right">
                            <div className="text-xs font-medium text-foreground truncate">{sum.label}</div>
                            <div className="text-2xs text-muted-foreground truncate">
                              {sum.codecLabel} · {sum.seqRange}
                            </div>
                            <div className="text-2xs text-muted-foreground/80 font-mono truncate hidden lg:block">
                              B {sum.frameRangeB}
                            </div>
                          </div>
                          <TooltipWrapper entry={tooltips.packetDiffCollapseRtp}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 shrink-0 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExpandCollapsed(fr.collapsed!.id, run[0]!.key);
                              }}
                            >
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </TooltipWrapper>
                        </div>
                      ) : (
                        <div className="min-w-0 w-full">
                          {isFirstInExpandedRun && fr.expandedFromCollapsedId ? (
                            <div className="mb-0.5 flex justify-end">
                              <button
                                type="button"
                                className="text-2xs text-primary hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReCollapseRun(fr.expandedFromCollapsedId!);
                                }}
                              >
                                Collapse run
                              </button>
                            </div>
                          ) : null}
                          {rightPacket ? (
                            <TooltipWrapper
                              title={rightTooltip.title}
                              description={rightTooltip.description}
                              side="top"
                              sideOffset={8}
                            >
                              <div className={cn("min-w-0 overflow-hidden w-full", dimRow && "opacity-[0.78]")}>
                                <div className="flex items-center gap-1.5 min-w-0 text-xs leading-4">
                                  <span className="shrink-0 rounded border border-border/45 bg-background/70 px-1 font-mono text-3xs">
                                    #{typeof fr.row.rightIndex === "number" ? fr.row.rightIndex + 1 : "—"}
                                  </span>
                                  <span className="truncate font-mono uppercase text-[11px] text-muted-foreground">
                                    {rightPacket.protocol}
                                  </span>
                                </div>
                                <div
                                  className="mt-0.5 truncate text-[13px] leading-5 text-foreground/90"
                                  title={`${rightPacket.summary} | ${rightPacket.srcIp}:${rightPacket.srcPort} -> ${rightPacket.dstIp}:${rightPacket.dstPort}`}
                                >
                                  {compactText(rightPacket.summary, 110)}
                                </div>
                                <div className="mt-0.5 hidden truncate font-mono text-[10px] leading-4 text-muted-foreground lg:block">
                                  {`${rightPacket.srcIp}:${rightPacket.srcPort} -> ${rightPacket.dstIp}:${rightPacket.dstPort}`}
                                </div>
                              </div>
                            </TooltipWrapper>
                          ) : (
                            <div className="grid h-full w-full place-items-center text-3xs text-muted-foreground/70">—</div>
                          )}
                        </div>
                      )}
                    </div>
                    <div
                      className={cn(
                        "flex flex-col items-center justify-center gap-0.5 border-b border-border/20",
                        ROW_HEIGHT_CLASS,
                        correlRow && "bg-primary/[0.06]",
                      )}
                      onMouseEnter={() => beginHoverKeys(keysForFlatHover(fr))}
                      onMouseLeave={scheduleClearHoverKeys}
                    >
                      <span className={cn("font-mono text-[10px] tabular-nums", deltaToneClasses(rightMs))}>
                        {deltaLabel(rightMs)}
                      </span>
                      <div
                        className={cn("h-1 w-6 rounded-sm shrink-0", deltaMeterClass(rightMs))}
                        title="Inter-arrival vs previous visible row (capture B)"
                      />
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>

          {selectedFlat && selectedRow && (
            <div className="mt-2 border-t border-border/25 bg-card/55 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {isCollapsedBannerSelected ? "Collapsed RTP run" : "Selected pair — decoded fields"}
                </div>
                {isCollapsedBannerSelected && selectedCollapsedBanner && collapsedSummary ? (
                  <>
                    <TooltipWrapper entry={tooltips.packetDiffCollapseRtp}>
                      <Button
                        variant="neutral"
                        size="sm"
                        className="h-6 px-2 text-3xs ml-auto"
                        onClick={() => handleExpandCollapsed(selectedCollapsedBanner.id, selectedCollapsedBanner.rows[0]!.key)}
                      >
                        <ChevronDown className="h-3 w-3 mr-1" />
                        Expand run
                      </Button>
                    </TooltipWrapper>
                    {typeof selectedCollapsedBanner.rows[0]!.leftIndex === "number" &&
                      typeof selectedCollapsedBanner.rows[selectedCollapsedBanner.rows.length - 1]!.leftIndex ===
                        "number" && (
                        <>
                          <Button
                            variant="neutral"
                            size="sm"
                            className="h-6 px-2 text-3xs"
                            onClick={() =>
                              onOpenPacket("left", selectedCollapsedBanner.rows[0]!.leftIndex!)
                            }
                          >
                            A first
                          </Button>
                          <Button
                            variant="neutral"
                            size="sm"
                            className="h-6 px-2 text-3xs"
                            onClick={() =>
                              onOpenPacket(
                                "left",
                                selectedCollapsedBanner.rows[selectedCollapsedBanner.rows.length - 1]!.leftIndex!,
                              )
                            }
                          >
                            A last
                          </Button>
                        </>
                      )}
                    {typeof selectedCollapsedBanner.rows[0]!.rightIndex === "number" &&
                      typeof selectedCollapsedBanner.rows[selectedCollapsedBanner.rows.length - 1]!.rightIndex ===
                        "number" && (
                        <>
                          <Button
                            variant="neutral"
                            size="sm"
                            className="h-6 px-2 text-3xs"
                            onClick={() =>
                              onOpenPacket("right", selectedCollapsedBanner.rows[0]!.rightIndex!)
                            }
                          >
                            B first
                          </Button>
                          <Button
                            variant="neutral"
                            size="sm"
                            className="h-6 px-2 text-3xs"
                            onClick={() =>
                              onOpenPacket(
                                "right",
                                selectedCollapsedBanner.rows[selectedCollapsedBanner.rows.length - 1]!.rightIndex!,
                              )
                            }
                          >
                            B last
                          </Button>
                        </>
                      )}
                  </>
                ) : (
                  <>
                    {typeof selectedRow.leftIndex === "number" && (
                      <TooltipWrapper entry={tooltips.packetDiffOpenLeftPacket}>
                        <Button
                          variant="neutral"
                          size="sm"
                          className="h-6 px-2 text-3xs ml-auto"
                          onClick={() => onOpenPacket("left", selectedRow.leftIndex!)}
                        >
                          Open A packet
                        </Button>
                      </TooltipWrapper>
                    )}
                    {typeof selectedRow.rightIndex === "number" && (
                      <TooltipWrapper entry={tooltips.packetDiffOpenRightPacket}>
                        <Button
                          variant="neutral"
                          size="sm"
                          className="h-6 px-2 text-3xs"
                          onClick={() => onOpenPacket("right", selectedRow.rightIndex!)}
                        >
                          Open B packet
                        </Button>
                      </TooltipWrapper>
                    )}
                  </>
                )}
              </div>

              {isCollapsedBannerSelected && collapsedSummary ? (
                <div className="rounded-md border border-border/30 bg-background/70 p-2.5 text-xs leading-5 space-y-1">
                  <div className="font-medium text-foreground">{collapsedSummary.label}</div>
                  <div className="text-muted-foreground">{collapsedSummary.codecLabel}</div>
                  <div className="font-mono text-2xs text-muted-foreground">
                    {collapsedSummary.seqRange} · Frames A {collapsedSummary.frameRangeA} · B {collapsedSummary.frameRangeB}
                  </div>
                  <p className="text-2xs text-muted-foreground pt-1">
                    Field-level diff applies to a single frame — expand the run or open first/last in the viewer.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <pre className="rounded-md border border-border/30 bg-background/70 p-2.5 text-xs leading-5 whitespace-pre-wrap break-words overflow-auto max-h-[220px]">
{packetDetailText("A", selectedRow)}
                  </pre>
                  <pre className="rounded-md border border-border/30 bg-background/70 p-2.5 text-xs leading-5 whitespace-pre-wrap break-words overflow-auto max-h-[220px]">
{packetDetailText("B", selectedRow)}
                  </pre>
                </div>
              )}

              {!isCollapsedBannerSelected ? (
                <div className="mt-3 rounded-md border border-border/30 bg-card/55 overflow-hidden">
                  <div className="px-2.5 py-2 border-b border-border/25 flex flex-wrap items-center gap-1.5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Protocol Field Diff</div>
                    <Badge variant="secondary" className="h-5 px-1.5 text-2xs border-warning/35 text-warning">
                      {changedFieldCount} changed
                    </Badge>
                    <Badge variant="secondary" className="h-5 px-1.5 text-2xs">
                      {leftOnlyFieldCount} A-only
                    </Badge>
                    <Badge variant="secondary" className="h-5 px-1.5 text-2xs">
                      {rightOnlyFieldCount} B-only
                    </Badge>
                    <TooltipWrapper entry={tooltips.packetDiffToggleFields}>
                      <Button
                        variant="neutral"
                        size="sm"
                        className="h-6 px-2 text-3xs ml-auto"
                        onClick={() => setShowUnchangedFields((v) => !v)}
                      >
                        {showUnchangedFields ? "Hide unchanged" : "Show unchanged"}
                      </Button>
                    </TooltipWrapper>
                  </div>

                  <div className="max-h-[280px] overflow-auto">
                    <table className="min-w-[780px] w-full text-sm border-separate border-spacing-0">
                      <thead className="sticky top-0 bg-background/95 z-10">
                        <tr className="text-muted-foreground">
                          <th className="text-left font-medium px-2 py-2 border-b border-border/25">Field</th>
                          <th className="text-left font-medium px-2 py-2 border-b border-border/25">A</th>
                          <th className="text-left font-medium px-2 py-2 border-b border-border/25">B</th>
                          <th className="text-left font-medium px-2 py-2 border-b border-border/25">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleFieldRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-2 py-2 text-muted-foreground">
                              No field-level differences for this row.
                            </td>
                          </tr>
                        ) : (
                          visibleFieldRows.map((row) => (
                            <tr key={row.key} className="even:bg-muted/[0.03]">
                              <td className="px-2 py-2.5 border-b border-border/20 text-foreground align-top whitespace-normal break-words leading-5" title={row.label}>
                                {row.label}
                              </td>
                              <td className="px-2 py-2.5 border-b border-border/20 font-mono text-muted-foreground align-top whitespace-pre-wrap break-words leading-5" title={row.left}>
                                {row.left}
                              </td>
                              <td className="px-2 py-2.5 border-b border-border/20 font-mono text-muted-foreground align-top whitespace-pre-wrap break-words leading-5" title={row.right}>
                                {row.right}
                              </td>
                              <td className="px-2 py-2.5 border-b border-border/20 align-top">
                                <span
                                  className={cn(
                                    "inline-flex rounded border px-1.5 py-[2px] text-xs uppercase tracking-wide",
                                    fieldStatusToneClasses(row.status),
                                    row.status === "changed" && "border-warning/40 text-warning bg-warning/[0.14]",
                                    row.status === "left_only" && "border-destructive/40 text-destructive bg-destructive/[0.14]",
                                    row.status === "right_only" && "border-success/40 text-success bg-success/[0.14]",
                                    row.status === "same" && "border-border/40 text-muted-foreground",
                                  )}
                                >
                                  {row.status === "changed" && "changed"}
                                  {row.status === "left_only" && "A-only"}
                                  {row.status === "right_only" && "B-only"}
                                  {row.status === "same" && "same"}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
