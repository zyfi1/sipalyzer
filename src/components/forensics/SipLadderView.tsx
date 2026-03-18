/**
 * SIP ladder diagram — HTML/CSS grid-based timeline.
 * Matches WarperPacketList styling: fixed-height rows, mono font, protocol color badges,
 * selection/hover states, compact header. Replaces the old SVG implementation.
 */

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import type { SipDialogMessage } from "@/types/forensics";
import type { ExpertFinding } from "@/types/packetCapture";
import { getTransactionIndicesForMessage } from "@/lib/sipTransaction";
import { getSipBadgeClasses, getSipArrowColorClass } from "@/lib/sipCodes";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { GitBranch, XCircle, AlertTriangle } from "@/lib/icons";
import { formatTimestampCompact } from "@/lib/dateTime";
import { cn } from "@/lib/utils";

/* ─── Helpers ─── */

function isResponse(methodOrCode: string): boolean {
  return /^\d{3}$/.test(methodOrCode.trim());
}

export interface ParticipantDetail {
  label: string;
  ip?: string;
  hostname?: string | null;
}

export type SipTimestampMode = "absolute" | "delta" | "relative";

function formatTimestamp(mode: SipTimestampMode, msg: SipDialogMessage, prevTimestamp: string | null, firstTimestamp: string): string {
  try {
    const t = new Date(msg.timestamp).getTime();
    if (mode === "absolute") return formatTimestampCompact(msg.timestamp);
    if (mode === "delta" && prevTimestamp) {
      const prev = new Date(prevTimestamp).getTime();
      const deltaMs = t - prev;
      if (deltaMs < 1000) return `+${deltaMs}ms`;
      return `+${(deltaMs / 1000).toFixed(2)}s`;
    }
    if (mode === "relative") {
      const first = new Date(firstTimestamp).getTime();
      const deltaMs = t - first;
      if (deltaMs < 1000) return `${deltaMs}ms`;
      return `${(deltaMs / 1000).toFixed(2)}s`;
    }
  } catch {
    return "—";
  }
  return "—";
}

function formatCseqNumber(value?: string): string {
  if (!value) return "—";
  const trimmed = value.trim();
  const numberMatch = trimmed.match(/^(\d+)/);
  return numberMatch?.[1] ?? trimmed;
}

/* ─── Types ─── */

export interface SipLadderViewProps {
  messages: SipDialogMessage[];
  participants?: string[];
  participantDetails?: ParticipantDetail[];
  selectedMessageIndex: number | null;
  onSelectMessage: (index: number | null) => void;
  findingsByMessageIndex?: Map<number, ExpertFinding[]>;
  timestampMode?: SipTimestampMode;
}

/* ─── Component ─── */

export function SipLadderView({
  messages,
  participants = ["Caller (A)", "Callee (B)"],
  participantDetails,
  selectedMessageIndex,
  onSelectMessage,
  findingsByMessageIndex,
  timestampMode = "absolute",
}: SipLadderViewProps) {
  const ROW_HEIGHT = 44;
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const nParticipants = Math.max(2, participants.length);
  const timeColWidthPx = 96; // matches w-24
  const cseqColWidthPx = 80; // matches w-20
  const firstTimestamp = messages[0]?.timestamp ?? "";
  const headerGridTemplateColumns = useMemo(
    () => `${timeColWidthPx}px repeat(${nParticipants}, minmax(0, 1fr)) ${cseqColWidthPx}px`,
    [timeColWidthPx, nParticipants, cseqColWidthPx],
  );
  const rowGridTemplateColumns = useMemo(
    () => `${timeColWidthPx}px minmax(0, 1fr) ${cseqColWidthPx}px`,
    [timeColWidthPx, cseqColWidthPx],
  );
  const laneCenterPercent = useCallback(
    (laneIndex: number) => ((laneIndex + 0.5) / nParticipants) * 100,
    [nParticipants],
  );

  const highlightIndices = useMemo(() => {
    if (hoverIndex == null) return null;
    return getTransactionIndicesForMessage(messages, hoverIndex);
  }, [messages, hoverIndex]);

  // Build short participant labels
  const shortLabels = useMemo(() => {
    return participants.map((p) => {
      const base = (p.split(" (")[0] ?? p).trim() || p;
      return base.length > 20 ? base.slice(0, 19) + "…" : base;
    });
  }, [participants]);

  useEffect(() => {
    if (selectedMessageIndex == null) return;
    const row = rowRefs.current.get(selectedMessageIndex);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedMessageIndex]);

  if (messages.length === 0) {
    return (
      <EmptyState
        compact
        variant="inline"
        icon={<GitBranch />}
        title="No SIP messages"
        description="Select a capture and choose a dialog to view the call flow."
        className="py-16 px-6"
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ─── Sticky header ─── */}
      <div
        className="shrink-0 grid items-center h-8 section-label-sm border-b border-border/40 bg-background select-none px-2"
        style={{ gridTemplateColumns: headerGridTemplateColumns }}
      >
        <span className="truncate">Time</span>
        {Array.from({ length: nParticipants }).map((_, i) => {
          const detail = participantDetails?.[i];
          const titleParts = [participants[i] ?? `P${i + 1}`];
          if (detail?.ip) titleParts.push(detail.ip);
          if (detail?.hostname) titleParts.push(detail.hostname);
          return (
            <TooltipWrapper key={i} title={participants[i] ?? `P${i + 1}`} description={titleParts.slice(1).join(" — ") || undefined}>
              <span className="block w-full text-center truncate px-1">
                {shortLabels[i] ?? `P${i + 1}`}
              </span>
            </TooltipWrapper>
          );
        })}
        <span className="text-right truncate">CSeq</span>
      </div>

      {/* ─── Message rows ─── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {messages.map((msg, index) => {
          const findingsForRow = findingsByMessageIndex?.get(index);
          // ─ Direction: clamp indices, fix broken fallback ─
          const fromIdx = Math.max(0, Math.min(msg.fromParticipantIndex ?? 0, nParticipants - 1));
          const defaultToIdx = fromIdx === 0 ? Math.min(1, nParticipants - 1) : 0;
          const toIdx = Math.max(0, Math.min(msg.toParticipantIndex ?? defaultToIdx, nParticipants - 1));

          const isSelected = selectedMessageIndex === index;
          const isHighlighted = highlightIndices != null && highlightIndices.has(index);
          const isResponseMsg = isResponse(msg.methodOrCode);
          const prevTs = index > 0 ? messages[index - 1]?.timestamp ?? null : null;
          const timeStr = formatTimestamp(timestampMode, msg, prevTs, firstTimestamp);
          const isSelfMsg = fromIdx === toIdx;

          const badgeClasses = getSipBadgeClasses(msg.methodOrCode);
          const arrowColorClass = isSelected ? "text-foreground" : isHighlighted ? "text-foreground/70" : getSipArrowColorClass(msg.methodOrCode);
          const fromLaneCenterPct = laneCenterPercent(fromIdx);
          const toLaneCenterPct = laneCenterPercent(toIdx);
          const laneCenters = Array.from({ length: nParticipants }, (_, laneIndex) => laneCenterPercent(laneIndex));
          const methodLabel = msg.methodOrCode?.trim() ?? "";
          const hasMethodLabel = methodLabel.length > 0;
          const cseqLabel = formatCseqNumber(msg.cseq);
          const goingRight = toLaneCenterPct >= fromLaneCenterPct;
          const arrowLeftPct = Math.min(fromLaneCenterPct, toLaneCenterPct);
          const arrowWidthPct = Math.abs(toLaneCenterPct - fromLaneCenterPct);
          const arrowY = 22;
          const weightedBadgeCenterPct =
            (((fromIdx + 0.5) * 0.65 + (toIdx + 0.5) * 0.35) / nParticipants) * 100;

          return (
            <div
              key={index}
              ref={(el) => {
                if (el) rowRefs.current.set(index, el);
                else rowRefs.current.delete(index);
              }}
              onClick={() => onSelectMessage(index)}
              onMouseEnter={() => setHoverIndex(index)}
              onMouseLeave={() => setHoverIndex(null)}
              className={cn(
                "relative grid items-center text-xs font-mono cursor-pointer select-none px-2",
                "border-b border-border/40 transition-smooth duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : isHighlighted
                    ? "bg-muted/30 hover:bg-accent/40"
                    : "hover:bg-accent/40 text-foreground",
              )}
              style={{
                height: ROW_HEIGHT,
                gridTemplateColumns: rowGridTemplateColumns,
              }}
              role="row"
              aria-selected={isSelected}
            >
              {isSelected && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-foreground" aria-hidden />
              )}
              {/* Time */}
              <span className="text-muted-foreground tabular-nums truncate text-2xs">
                {timeStr}
              </span>

              {/* Participant columns with arrow visualization */}
              <div
                className="min-w-0 relative h-full"
              >
                <svg
                  className={cn("absolute inset-0 z-20 pointer-events-none", arrowColorClass)}
                  viewBox={`0 0 100 ${ROW_HEIGHT}`}
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  {laneCenters.map((center, laneIndex) => (
                    <line
                      key={`lifeline-${laneIndex}`}
                      x1={center}
                      y1={0}
                      x2={center}
                      y2={ROW_HEIGHT}
                      stroke="hsl(var(--border) / 0.45)"
                      strokeWidth={0.22}
                      strokeDasharray="0.9 1.2"
                    />
                  ))}

                  {isSelfMsg && hasMethodLabel ? (
                    <>
                      <path
                        d={`M ${fromLaneCenterPct} ${arrowY} L ${fromLaneCenterPct + 2.6} ${arrowY} L ${fromLaneCenterPct + 2.6} 35 L ${fromLaneCenterPct + 1.1} 35`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={0.65}
                        strokeDasharray={isResponseMsg ? "1.4 1.2" : undefined}
                        strokeLinecap="round"
                      />
                      <circle cx={fromLaneCenterPct} cy={arrowY} r={0.9} fill="currentColor" />
                    </>
                  ) : null}
                </svg>

                {!isSelfMsg && hasMethodLabel && (
                  <div className={cn("absolute inset-0 z-20 pointer-events-none", arrowColorClass)}>
                    <div
                      className="absolute h-[1.5px] rounded-full"
                      style={{
                        top: `${arrowY}px`,
                        left: `${arrowLeftPct}%`,
                        width: `${arrowWidthPct}%`,
                        transform: "translateY(-50%)",
                        background: isResponseMsg
                          ? "repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 8px)"
                          : "currentColor",
                      }}
                    />
                    <div
                      className="absolute h-[7px] w-[7px] -translate-x-1/2 rounded-full bg-current"
                      style={{ top: `${arrowY}px`, left: `${fromLaneCenterPct}%`, transform: "translate(-50%, -50%)" }}
                    />
                    <div
                      className="absolute"
                      style={{
                        top: `${arrowY}px`,
                        left: goingRight ? `calc(${toLaneCenterPct}% - 1px)` : `calc(${toLaneCenterPct}% + 1px)`,
                        transform: goingRight ? "translateY(-50%)" : "translate(-100%, -50%)",
                        ...(goingRight
                          ? { borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "6px solid currentColor" }
                          : { borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderRight: "6px solid currentColor" }),
                      }}
                    />
                  </div>
                )}

                {/* Method/status badge — biased toward source participant */}
                {!isSelfMsg && hasMethodLabel && (
                  <div
                    className="absolute z-30 pointer-events-none"
                    style={{
                      left: `${weightedBadgeCenterPct}%`,
                      top: "50%",
                      transform: "translate(-50%, -120%)",
                    }}
                  >
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded text-2xs font-bold leading-none border whitespace-nowrap",
                      badgeClasses,
                    )}>
                      {methodLabel}
                    </span>
                  </div>
                )}

                {/* Finding indicator */}
                {findingsForRow && findingsForRow.length > 0 && !isSelfMsg && (
                  <div
                    className="absolute z-30 pointer-events-auto"
                    style={{
                      left: `${weightedBadgeCenterPct}%`,
                      top: 2,
                      transform: "translateX(-50%)",
                    }}
                  >
                    <TooltipWrapper content={findingsForRow.map(f => f.title).join(", ")}>
                      {findingsForRow.some(f => f.severity === "critical")
                        ? <XCircle className="h-3 w-3 text-destructive cursor-help" />
                        : <AlertTriangle className="h-3 w-3 text-warning cursor-help" />
                      }
                    </TooltipWrapper>
                  </div>
                )}

                {/* Self-message badge */}
                {isSelfMsg && hasMethodLabel && (
                  <div
                    className="absolute z-30 pointer-events-none"
                    style={{
                      left: `${fromLaneCenterPct}%`,
                      top: 2,
                      transform: "translateX(8px)",
                    }}
                  >
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded text-2xs font-bold leading-none border whitespace-nowrap",
                      badgeClasses,
                    )}>
                      {methodLabel}
                    </span>
                  </div>
                )}
              </div>

              {/* CSeq column */}
              <span className="text-right text-muted-foreground tabular-nums truncate text-2xs">
                {cseqLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

