import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Copy,
  Check,
  Radio,
} from "@/lib/icons";
import type { Call, SipLogEntry } from "@/lib/softphone";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import {
  formatOffsetTimeISO,
  getSipStartLine,
  getSipMethodShort,
  getSipCSeq,
  sipUriToHostPort,
} from "./softphone-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━ Unified Timeline Entry ━━━━━━━━━━━━━━━━━━━━━━━ */

type EntryKind = "sip" | "dtmf" | "event";

interface TimelineEntry {
  kind: EntryKind;
  direction: "send" | "recv";
  timestamp: string;
  label: string;
  method?: string;
  statusCode?: number;
  summary?: string;
  raw?: string;
  cseq?: string;
  searchKey?: string;
  digit?: string;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━ Styling helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const METHODS_REQUEST = new Set(["INVITE", "ACK", "BYE", "CANCEL", "REGISTER", "OPTIONS", "SUBSCRIBE", "NOTIFY", "REFER", "UPDATE", "PRACK", "INFO", "MESSAGE"]);

function classify(e: TimelineEntry) {
  if (e.kind === "dtmf") return "dtmf" as const;
  if (e.kind === "event") return "event" as const;
  if (e.method && METHODS_REQUEST.has(e.method.toUpperCase())) return "request" as const;
  if (e.statusCode) {
    if (e.statusCode >= 200 && e.statusCode < 300) return "2xx" as const;
    if (e.statusCode >= 100 && e.statusCode < 200) return "1xx" as const;
    return "err" as const;
  }
  const lbl = e.label;
  if (METHODS_REQUEST.has(lbl) || lbl.startsWith("re-INVITE")) return "request" as const;
  if (/^2\d\d/.test(lbl)) return "2xx" as const;
  if (/^1\d\d/.test(lbl)) return "1xx" as const;
  if (/^[3-6]\d\d/.test(lbl)) return "err" as const;
  return "other" as const;
}

type Classification = ReturnType<typeof classify>;

const DOT: Record<Classification, string> = {
  request: "bg-primary",
  "2xx": "bg-success",
  "1xx": "bg-warning",
  err: "bg-destructive",
  dtmf: "bg-primary",
  event: "bg-info",
  other: "bg-muted-foreground",
};

const BADGE_BG: Record<Classification, string> = {
  request: "bg-primary/15 text-primary",
  "2xx": "bg-success/15 text-success",
  "1xx": "bg-warning/15 text-warning",
  err: "bg-destructive/15 text-destructive",
  dtmf: "bg-primary/15 text-primary",
  event: "bg-info/15 text-info",
  other: "bg-muted/30 text-muted-foreground",
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━ Filter ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

type FilterMode = "all" | "signaling" | "dtmf";

const FILTERS: { value: FilterMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "signaling", label: "Signaling" },
  { value: "dtmf", label: "DTMF" },
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━ Data merging ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function sipLogToEntry(s: SipLogEntry): TimelineEntry {
  const label = s.method
    ? s.method
    : s.status_code
      ? String(s.status_code)
      : s.summary || "SIP";
  return {
    kind: "sip",
    direction: s.direction === "send" ? "send" : "recv",
    timestamp: s.timestamp,
    label,
    method: s.method || undefined,
    statusCode: s.status_code > 0 ? s.status_code : undefined,
    summary: s.summary,
    raw: s.raw,
    searchKey: s.method || (s.status_code > 0 ? String(s.status_code) : undefined),
    cseq: getSipCSeq(s.raw) ?? undefined,
  };
}

function buildInferredTimeline(call: Call): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const sipRequestLine = getSipStartLine(call.requestMessage);
  const sipCSeq = getSipCSeq(call.requestMessage);
  const baseCSeq = call.dialogCSeq ?? 1;

  entries.push({
    kind: "sip",
    direction: "send",
    timestamp: call.startTime,
    label: getSipMethodShort(sipRequestLine),
    method: getSipMethodShort(sipRequestLine),
    searchKey: "INVITE",
    cseq: sipCSeq ?? "1",
  });

  if (call.statusCode && call.statusCode >= 100 && call.statusCode < 200) {
    entries.push({
      kind: "sip",
      direction: "recv",
      timestamp: call.startTime,
      label: `${call.statusCode}`,
      statusCode: call.statusCode,
      searchKey: String(call.statusCode),
      cseq: sipCSeq ?? "1",
    });
  }
  if (call.statusCode && call.statusCode >= 200 && call.statusCode < 300) {
    const responseTs = formatOffsetTimeISO(call.startTime, call.responseTimeMs) ?? call.startTime;
    entries.push({
      kind: "sip",
      direction: "recv",
      timestamp: responseTs,
      label: "200 OK",
      statusCode: 200,
      searchKey: "200",
      cseq: sipCSeq ?? "1",
    });
    entries.push({
      kind: "sip",
      direction: "send",
      timestamp: responseTs,
      label: "ACK",
      method: "ACK",
      searchKey: "ACK",
      cseq: sipCSeq ?? "1",
    });
  }
  if (call.statusCode && call.statusCode >= 300) {
    entries.push({
      kind: "sip",
      direction: "recv",
      timestamp: formatOffsetTimeISO(call.startTime, call.responseTimeMs) ?? call.startTime,
      label: `${call.statusCode} ${call.statusText ?? ""}`.trim(),
      statusCode: call.statusCode,
      searchKey: String(call.statusCode),
      cseq: sipCSeq ?? "1",
    });
  }

  const holdEvents = [...(call.holdEvents ?? [])].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const muteEvents = [...(call.muteEvents ?? [])].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  type Ev = { at: string; kind: "hold" | "resume" | "mute" | "unmute" };
  const allEvents: Ev[] = [
    ...holdEvents.map((e) => ({ at: e.at, kind: e.type as "hold" | "resume" })),
    ...muteEvents.map((e) => ({ at: e.at, kind: e.type as "mute" | "unmute" })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  let holdCSeqIndex = 0;
  for (const ev of allEvents) {
    if (ev.kind === "hold" || ev.kind === "resume") {
      const seq = String(baseCSeq + 1 + holdCSeqIndex++);
      entries.push(
        { kind: "sip", direction: "send", timestamp: ev.at, label: ev.kind === "hold" ? "re-INVITE (hold)" : "re-INVITE (resume)", method: "INVITE", searchKey: "INVITE", cseq: seq },
        { kind: "sip", direction: "recv", timestamp: ev.at, label: "200 OK", statusCode: 200, searchKey: "200", cseq: seq },
        { kind: "sip", direction: "send", timestamp: ev.at, label: "ACK", method: "ACK", searchKey: "ACK", cseq: seq },
      );
    } else {
      entries.push({ kind: "event", direction: "send", timestamp: ev.at, label: ev.kind === "mute" ? "Muted" : "Unmuted" });
    }
  }

  if (call.state === "ended" && call.endTime) {
    entries.push({
      kind: "sip",
      direction: "send",
      timestamp: call.endTime,
      label: "BYE",
      method: "BYE",
      searchKey: "BYE",
      cseq: "2",
    });
  }

  if (call.transferredTo && call.endTime) {
    entries.push({
      kind: "event",
      direction: "send",
      timestamp: call.endTime,
      label: `Transferred → ${call.transferredTo}`,
    });
  }

  return entries;
}

function mergeTimeline(call: Call): TimelineEntry[] {
  const hasSipLog = call.sipLog && call.sipLog.length > 0;

  let sipEntries: TimelineEntry[];
  if (hasSipLog) {
    sipEntries = call.sipLog!.map(sipLogToEntry);
  } else {
    sipEntries = buildInferredTimeline(call);
  }

  const dtmfEntries: TimelineEntry[] = (call.dtmfDigits ?? []).map((d) => ({
    kind: "dtmf" as const,
    direction: d.direction,
    timestamp: d.timestamp,
    label: `DTMF ${d.digit}`,
    digit: d.digit,
  }));

  const appEvents: TimelineEntry[] = [];
  if (hasSipLog) {
    for (const ev of [...(call.muteEvents ?? [])].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())) {
      appEvents.push({
        kind: "event",
        direction: "send",
        timestamp: ev.at,
        label: ev.type === "mute" ? "Muted" : "Unmuted",
      });
    }
    if (call.transferredTo && call.endTime) {
      appEvents.push({
        kind: "event",
        direction: "send",
        timestamp: call.endTime,
        label: `Transferred → ${call.transferredTo}`,
      });
    }
  }

  const all = [...sipEntries, ...dtmfEntries, ...appEvents];
  return all
    .map((entry, idx) => ({ entry, idx }))
    .sort((a, b) => {
      const ta = Date.parse(a.entry.timestamp);
      const tb = Date.parse(b.entry.timestamp);
      const safeTa = Number.isFinite(ta) ? ta : 0;
      const safeTb = Number.isFinite(tb) ? tb : 0;
      if (safeTa !== safeTb) return safeTa - safeTb;
      return a.idx - b.idx;
    })
    .map((x) => x.entry);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━ Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface SipFlowTimelineProps {
  call: Call | undefined;
  isRemoteAgentCall?: boolean;
  captureSessionId?: string | null;
  onJumpToPacket?: (searchKey: string, cseq?: string) => void;
}

export function SipFlowTimeline({
  call,
  isRemoteAgentCall = false,
  captureSessionId,
  onJumpToPacket,
}: SipFlowTimelineProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => (call ? mergeTimeline(call) : []), [
    call?.sipCallId,
    call?.sipLog,
    call?.dtmfDigits,
    call?.holdEvents,
    call?.muteEvents,
    call?.state,
    call?.statusCode,
    call?.transferredTo,
  ]);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "signaling") return entries.filter((e) => e.kind === "sip");
    if (filter === "dtmf") return entries.filter((e) => e.kind === "dtmf");
    return entries;
  }, [entries, filter]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  const handleCopy = useCallback((idx: number, raw: string) => {
    navigator.clipboard.writeText(raw).catch(() => {});
    setCopied(idx);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  if (!call) {
    return <EmptyState compact variant="card" icon={<Radio />} title="No call selected" description="Select a call to view its SIP flow" />;
  }

  if (entries.length === 0) {
    return <EmptyState compact variant="card" icon={<Radio />} title="No SIP activity yet" description="Place a call to see the signaling flow" />;
  }

  const localEndpoint = isRemoteAgentCall
    ? (call.remoteAgentName ?? "Remote Agent")
    : (call.localIp ?? "Local");
  const remoteEndpoint = sipUriToHostPort(call.remoteContactUri ?? call.targetUri);

  const hasDtmf = entries.some((e) => e.kind === "dtmf");

  return (
    <div className="w-full overflow-hidden px-3 py-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">SIP Flow</span>
          <span className="text-2xs text-muted-foreground tabular-nums">
            {filtered.length} message{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Filter selector */}
        {(hasDtmf || entries.length > 3) && (
          <Select value={filter} onValueChange={(value) => setFilter(value as FilterMode)}>
            <SelectTrigger className="h-7 w-[128px] text-2xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.filter((f) => f.value !== "dtmf" || hasDtmf).map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Endpoints */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5 rounded-lg bg-primary/[0.06] border border-primary/10 px-2.5 py-1">
          <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden />
          <span className="text-2xs font-medium text-primary/80">You</span>
          <TooltipWrapper content={localEndpoint}>
            <span className="font-mono text-2xs text-foreground/70 truncate max-w-[130px]">{localEndpoint}</span>
          </TooltipWrapper>
        </div>
        <span className="text-muted-foreground/60 text-xs">↔</span>
        <div className="flex items-center gap-1.5 rounded-lg bg-success/[0.06] border border-success/10 px-2.5 py-1">
          <div className="h-1.5 w-1.5 rounded-full bg-success shrink-0" aria-hidden />
          <span className="text-2xs font-medium text-success/80">Remote</span>
          <TooltipWrapper content={remoteEndpoint}>
            <span className="font-mono text-2xs text-foreground/70 truncate max-w-[130px]">{remoteEndpoint}</span>
          </TooltipWrapper>
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[420px] overflow-y-auto relative px-2 pb-1"
      >
        {/* Vertical rail */}
        <div className="absolute left-3 top-3 bottom-3 w-px bg-border/60" aria-hidden />

        <ul className="space-y-1.5 relative">
          {filtered.map((entry, idx) => {
            const cls = classify(entry);
            const isSend = entry.direction === "send";
            const isExpanded = expandedIdx === idx;
            const hasRaw = !!entry.raw;
            const ts = (() => {
              if (!entry.timestamp) return "—";
              if (entry.timestamp.includes("T")) return entry.timestamp.slice(11, 23);
              return entry.timestamp;
            })();
            const canJump = !!entry.searchKey && !!captureSessionId && !!onJumpToPacket;

            const tooltip = [
              isSend ? "Sent" : "Received",
              entry.summary || entry.label,
              entry.cseq ? `CSeq ${entry.cseq}` : null,
              canJump ? "Click to open in Packet Monitor" : null,
            ].filter(Boolean).join(" · ");

            return (
              <li key={`${entry.timestamp}-${entry.label}-${idx}`} className="relative">
                {/* Main row */}
                <TooltipWrapper content={tooltip}>
                <button
                  type="button"
                  onClick={() => {
                    if (hasRaw) {
                      setExpandedIdx(isExpanded ? null : idx);
                    } else if (canJump) {
                      onJumpToPacket!(entry.searchKey!, entry.cseq);
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 pl-1 pr-3 py-2 rounded-lg text-left transition-smooth group",
                    isExpanded ? "bg-accent/25 border border-border/30" : "hover:bg-accent/10",
                  )}
                >
                  {/* Dot */}
                  <div className="w-4 shrink-0 flex justify-center">
                    <div className={cn("h-2.5 w-2.5 rounded-full z-[1] ring-2 ring-background transition-transform", DOT[cls], isExpanded && "scale-125")} />
                  </div>

                  {/* Timestamp */}
                  <span className="w-[84px] shrink-0 text-2xs tabular-nums text-muted-foreground/75 font-mono">{ts}</span>

                  {/* Direction arrow */}
                  <div className={cn(
                    "h-4 w-4 rounded flex items-center justify-center shrink-0",
                    isSend ? "text-primary/60" : "text-success/60",
                  )}>
                    {isSend
                      ? <ArrowUp className="h-3 w-3" />
                      : <ArrowDown className="h-3 w-3" />
                    }
                  </div>

                  {/* Label badge */}
                  <span className={cn(
                    "text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded shrink-0",
                    BADGE_BG[cls],
                  )}>
                    {entry.kind === "dtmf" ? entry.digit : entry.label}
                  </span>

                  {/* Kind tag for DTMF */}
                  {entry.kind === "dtmf" && (
                    <span className="text-3xs font-medium text-primary/60 uppercase tracking-widest">DTMF</span>
                  )}

                  {/* Summary */}
                  {entry.summary && entry.kind === "sip" && (
                    <span className="flex-1 min-w-0 text-[11px] text-muted-foreground/70 truncate font-mono">
                      {entry.summary}
                    </span>
                  )}
                  {!entry.summary && <span className="flex-1" />}

                  {/* CSeq */}
                  {entry.cseq && entry.cseq !== "—" && (
                    <span className="text-3xs tabular-nums text-muted-foreground/60 shrink-0">
                      CSeq {entry.cseq}
                    </span>
                  )}

                  {/* Troubleshoot link for error codes */}
                  {entry.statusCode && entry.statusCode >= 400 && (
                    <TroubleshootLink sipCode={entry.statusCode} compact />
                  )}

                  {/* Expand indicator */}
                  {hasRaw && (
                    <ChevronDown className={cn(
                      "h-3 w-3 text-muted-foreground/60 transition-transform shrink-0",
                      isExpanded && "rotate-180 text-muted-foreground/60",
                    )} />
                  )}

                  {/* Packet monitor jump hint */}
                  {canJump && !hasRaw && (
                    <span className="text-3xs text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      ↗ Packets
                    </span>
                  )}
                </button>
                </TooltipWrapper>

                {/* Expanded raw SIP */}
                {isExpanded && hasRaw && (
                  <div className="relative ml-4 mr-1 mt-0.5 mb-1.5 animate-in fade-in slide-in-from-top-1 duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]">
                    <div className="ui-panel-shell border border-border/40 overflow-hidden">
                      {/* Raw header bar */}
                      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-border/30">
                        <span className="text-2xs font-medium text-muted-foreground/60">Raw SIP Message</span>
                        <div className="flex items-center gap-1">
                          {canJump && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onJumpToPacket!(entry.searchKey!, entry.cseq);
                              }}
                              className="text-2xs text-primary/60 hover:text-primary px-1.5 py-0.5 rounded hover:bg-primary/10 transition-smooth"
                            >
                              ↗ Packets
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(idx, entry.raw!);
                            }}
                            className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent/50 text-muted-foreground/60 hover:text-foreground/70 transition-smooth"
                            aria-label="Copy raw SIP"
                          >
                            {copied === idx
                              ? <Check className="h-3 w-3 text-success" />
                              : <Copy className="h-3 w-3" />
                            }
                          </button>
                        </div>
                      </div>
                      <pre className="text-2xs leading-relaxed font-mono text-foreground/60 p-3 overflow-x-auto max-h-[280px] overflow-y-auto whitespace-pre-wrap break-all select-text">
                        {entry.raw}
                      </pre>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
