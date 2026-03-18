import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { cn } from "@/lib/utils";
import type { PacketDiffRow } from "./packetDiffEngine";
import { diffPacketFields } from "./packetFieldDiff";
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
  if (app?.type === "Sip") {
    const method = app.data.method ? app.data.method.toUpperCase() : null;
    const response = app.data.responseCode
      ? `${app.data.responseCode}${app.data.responseText ? ` ${app.data.responseText}` : ""}`
      : null;
    return {
      title: `SIP ${method ?? response ?? "message"}`,
      description: `Call-ID: ${app.data.callId ?? "unknown"} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`,
    };
  }
  if (app?.type === "Rtp" || app?.type === "Srtp") {
    return {
      title: `${app.type.toUpperCase()} PT ${app.data.payloadType}`,
      description: `SSRC: ${app.data.ssrc} | Seq: ${app.data.sequenceNumber} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`,
    };
  }
  if (app?.type === "Rtcp") {
    const first = app.data.packets[0];
    return {
      title: "RTCP report",
      description: `Packets: ${app.data.packets.length} | First type: ${first?.packetType ?? "unknown"} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`,
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
  return [
    `Frame #${typeof idx === "number" ? idx + 1 : "—"}`,
    `Time: ${packet.timestamp}`,
    `Protocol: ${packet.protocol}`,
    `Endpoint: ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`,
    `Length: ${packet.frameLength ?? packet.size}`,
    `App: ${appHint}`,
    `Summary: ${packet.summary}`,
  ].join("\n");
}

const ROW_HEIGHT_CLASS = "h-[68px]";

function statusSymbol(status: PacketDiffRow["status"]): string {
  if (status === "exact") return "=";
  if (status === "changed") return "~";
  if (status === "left_only") return "-";
  return "+";
}

function sidePacketCell(
  side: "left" | "right",
  row: PacketDiffRow,
  onSelect: () => void,
  isSelected: boolean,
) {
  const packet = side === "left" ? row.left : row.right;
  const packetIndex = side === "left" ? row.leftIndex : row.rightIndex;
  const markerSideClass = side === "left" ? "left-0" : "right-0";
  const paddingClass = side === "left" ? "pl-3.5 pr-2" : "pl-2 pr-3.5";
  const tooltip = packetTooltipSummary(packet);

  return (
    <tr key={`${side}-${row.key}`} className="border-b border-border/20">
      <td
        className={cn(
          "relative cursor-pointer align-middle even:bg-muted/[0.02] transition-colors",
          paddingClass,
          ROW_HEIGHT_CLASS,
          isSelected && "bg-accent/10 ring-1 ring-inset ring-accent/40",
        )}
        onClick={onSelect}
      >
        <div className={cn("absolute top-0 h-full w-[3px]", markerSideClass, rowStatusMarkerClasses(row.status))} />
        {packet ? (
          <TooltipWrapper
            title={tooltip.title}
            description={tooltip.description}
            side="top"
            sideOffset={8}
          >
            <div className="min-w-0 overflow-hidden">
              <div className="flex items-center gap-1.5 min-w-0 text-xs leading-4">
                <span className="shrink-0 rounded border border-border/45 bg-background/70 px-1 font-mono text-3xs">
                  #{typeof packetIndex === "number" ? packetIndex + 1 : "—"}
                </span>
                <span className="truncate font-mono uppercase text-[11px] text-muted-foreground">{packet.protocol}</span>
              </div>
              <div
                className="mt-0.5 truncate text-[13px] leading-5 text-foreground/90"
                title={`${packet.summary} | ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`}
              >
                {compactText(packet.summary, 110)}
              </div>
              <div className="mt-0.5 hidden truncate font-mono text-[10px] leading-4 text-muted-foreground lg:block">
                {`${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`}
              </div>
            </div>
          </TooltipWrapper>
        ) : (
          <div className="grid h-full place-items-center text-3xs text-muted-foreground/70">—</div>
        )}
      </td>
    </tr>
  );
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
  const syncingRef = useRef<"left" | "right" | null>(null);
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const rightScrollRef = useRef<HTMLDivElement | null>(null);

  const selectedRow = useMemo(() => {
    if (rows.length === 0) return null;
    if (selectedKey) {
      const found = rows.find((row) => row.key === selectedKey);
      if (found) return found;
    }
    return rows[0] ?? null;
  }, [rows, selectedKey]);

  const handleScrollSync = (source: "left" | "right") => {
    const from = source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const to = source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (!from || !to) return;
    if (syncingRef.current && syncingRef.current !== source) return;
    syncingRef.current = source;
    to.scrollTop = from.scrollTop;
    queueMicrotask(() => {
      syncingRef.current = null;
    });
  };

  const summary = {
    exact: rows.filter((row) => row.status === "exact").length,
    changed: rows.filter((row) => row.status === "changed").length,
    leftOnly: rows.filter((row) => row.status === "left_only").length,
    rightOnly: rows.filter((row) => row.status === "right_only").length,
  };

  const selectedFieldRows = useMemo(
    () => (selectedRow ? diffPacketFields(selectedRow.left, selectedRow.right) : []),
    [selectedRow],
  );
  const changedFieldCount = selectedFieldRows.filter((row) => row.status === "changed").length;
  const leftOnlyFieldCount = selectedFieldRows.filter((row) => row.status === "left_only").length;
  const rightOnlyFieldCount = selectedFieldRows.filter((row) => row.status === "right_only").length;
  const visibleFieldRows = showUnchangedFields
    ? selectedFieldRows
    : selectedFieldRows.filter((row) => row.status !== "same");

  return (
    <section className="surface-flat overflow-hidden">
      <div className="px-3 py-2 border-b border-border/25 bg-background/35 flex flex-wrap items-center gap-1.5">
        <TooltipWrapper entry={tooltips.packetDiffExactCount}>
          <Badge variant="outline" className="h-5 px-1.5 text-2xs">
            {summary.exact} exact
          </Badge>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffChangedCount}>
          <Badge variant="outline" className="h-5 px-1.5 text-2xs border-warning/35 text-warning">
            {summary.changed} changed
          </Badge>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffLeftOnlyCount}>
          <Badge variant="outline" className="h-5 px-1.5 text-2xs">
            {summary.leftOnly} A-only
          </Badge>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffRightOnlyCount}>
          <Badge variant="outline" className="h-5 px-1.5 text-2xs">
            {summary.rightOnly} B-only
          </Badge>
        </TooltipWrapper>
      </div>

      <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] gap-2 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b border-border/35 bg-[hsl(var(--card)/0.98)]">
        <TooltipWrapper entry={tooltips.packetDiffLaneLeft}>
          <div>{leftLabel}</div>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffLaneStatus}>
          <div>Status</div>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.packetDiffLaneRight}>
          <div>{rightLabel}</div>
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
          <div className="grid grid-cols-[minmax(0,1fr)_42px_minmax(0,1fr)] gap-1 px-3 max-h-[460px]">
            <div ref={leftScrollRef} className="overflow-auto" onScroll={() => handleScrollSync("left")}>
              <table className="w-full table-fixed border-separate border-spacing-0">
                <tbody>
                  {rows.map((row) =>
                    sidePacketCell("left", row, () => setSelectedKey(row.key), selectedRow?.key === row.key),
                  )}
                </tbody>
              </table>
            </div>
            <div className="overflow-hidden">
              <table className="w-full table-fixed border-separate border-spacing-0">
                <tbody>
                  {rows.map((row) => {
                    const isSelected = selectedRow?.key === row.key;
                    return (
                      <tr key={`mid-${row.key}`} className="border-b border-border/20">
                        <td
                          className={cn(
                            "px-0.5 text-center align-middle cursor-pointer transition-colors",
                            ROW_HEIGHT_CLASS,
                            isSelected && "bg-accent/10 ring-1 ring-inset ring-accent/40",
                          )}
                          onClick={() => setSelectedKey(row.key)}
                          title={row.status}
                        >
                          <TooltipWrapper
                            title={`Row status: ${row.status}`}
                            description={tooltips.packetDiffLaneStatus.description}
                          >
                            <span
                              className={cn(
                                "inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-semibold",
                                row.status === "exact" && "border-success/35 text-success",
                                row.status === "changed" && "border-warning/35 text-warning",
                                row.status === "left_only" && "border-destructive/35 text-destructive",
                                row.status === "right_only" && "border-success/35 text-success",
                              )}
                            >
                              {statusSymbol(row.status)}
                            </span>
                          </TooltipWrapper>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div ref={rightScrollRef} className="overflow-auto" onScroll={() => handleScrollSync("right")}>
              <table className="w-full table-fixed border-separate border-spacing-0">
                <tbody>
                  {rows.map((row) =>
                    sidePacketCell("right", row, () => setSelectedKey(row.key), selectedRow?.key === row.key),
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedRow && (
            <div className="mt-2 border-t border-border/25 bg-card/55 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Selected Row Detail</div>
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
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <pre className="rounded-md border border-border/30 bg-background/70 p-2.5 text-xs leading-5 whitespace-pre-wrap break-words overflow-auto max-h-[220px]">
{packetDetailText("A", selectedRow)}
                </pre>
                <pre className="rounded-md border border-border/30 bg-background/70 p-2.5 text-xs leading-5 whitespace-pre-wrap break-words overflow-auto max-h-[220px]">
{packetDetailText("B", selectedRow)}
                </pre>
              </div>

              <div className="mt-3 rounded-md border border-border/30 bg-card/55 overflow-hidden">
                <div className="px-2.5 py-2 border-b border-border/25 flex flex-wrap items-center gap-1.5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Protocol Field Diff</div>
                  <Badge variant="outline" className="h-5 px-1.5 text-2xs border-warning/35 text-warning">
                    {changedFieldCount} changed
                  </Badge>
                  <Badge variant="outline" className="h-5 px-1.5 text-2xs">
                    {leftOnlyFieldCount} A-only
                  </Badge>
                  <Badge variant="outline" className="h-5 px-1.5 text-2xs">
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
            </div>
          )}
        </div>
      )}
    </section>
  );
}
