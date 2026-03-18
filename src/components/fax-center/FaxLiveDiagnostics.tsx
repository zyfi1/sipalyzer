/**
 * FaxLiveDiagnostics — Real-time fax packet flow monitor.
 *
 * Shows during active fax send:
 *   - Phase timeline with current step highlighted
 *   - Animated bidirectional packet flow (TX / RX)
 *   - Live stats grid: packets, rate, jitter depth, elapsed
 *   - SIP/RTP message flow log with directional arrows (like a packet monitor)
 *
 * All data comes from the `progress` prop (fax:send_progress events) —
 * no extra Tauri listeners, no audio processing, no canvas.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Radio,
  X,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Info,
  CheckCircle2,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { navigateTo } from "@/lib/navigation";
import { phasePct, phaseLabel, PHASE_LABEL, phaseTransport } from "./FaxShared";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import type { FaxSendProgress } from "./FaxShared";

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

interface ActivityEntry {
  ts: number;        // Date.now()
  label: string;
  phase: string;
  transport?: string | null;
  /** Direction of the message: outbound (→), inbound (←), or info */
  direction?: "outbound" | "inbound" | "info";
  /** SIP message summary */
  sipMessage?: string;
  /** SDP info */
  sdpInfo?: string;
  /** NAT info */
  natInfo?: string;
  /** Remote RTP address */
  remoteRtp?: string;
  /** Warning text */
  warning?: string;
  /** Additional detail text */
  detail?: string;
  /** Entry type for styling */
  entryType: "phase" | "sip" | "media" | "nat" | "warning" | "info";
}

interface Props {
  jobId: string;
  target: string;
  progress?: FaxSendProgress;
  onCancel?: () => void;
  cancelling?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function classifyEntry(phase: string, direction?: string, warning?: string): ActivityEntry["entryType"] {
  if (warning) return "warning";
  if (phase.startsWith("sip_")) return "sip";
  if (phase === "nat_discovery") return "nat";
  if (phase === "warning") return "warning";
  if (direction === "outbound" || direction === "inbound") return "sip";
  return "phase";
}

/* ═══════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════ */

export function FaxLiveDiagnostics({ jobId: _jobId, target, progress, onCancel, cancelling }: Props) {
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const lastPhaseRef = useRef<string | null>(null);
  const lastSipMsgRef = useRef<string | null>(null);
  const prevTxRef = useRef(0);
  const prevRxRef = useRef(0);
  const prevRateTs = useRef(Date.now());
  const [txRate, setTxRate] = useState(0);
  const [rxRate, setRxRate] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const phase = progress?.phase;
  const pct = useMemo(() => phasePct(phase), [phase]);
  const label = useMemo(() => phaseLabel(phase), [phase]);
  const transport = useMemo(() => phaseTransport(phase), [phase]);
  const packetsTx = progress?.udptlPacketsSent ?? 0;
  const packetsRx = progress?.udptlPacketsReceived ?? 0;
  const elapsedSecs = progress?.elapsedSecs ?? 0;

  // Keep current packet counts in refs so the setInterval can read them
  // without being in the dependency array (avoids interval teardown/recreation).
  const currentTxRef = useRef(packetsTx);
  const currentRxRef = useRef(packetsRx);
  currentTxRef.current = packetsTx;
  currentRxRef.current = packetsRx;

  const isComplete = phase === "complete" || phase === "error";
  const isPagePhase = phase === "t38_page" || phase === "g711_page";

  /* ── Track phase changes AND SIP events → activity log ── */
  useEffect(() => {
    if (!progress) return;
    const { phase: p, sipMessage, sdpInfo, natInfo, remoteRtp, warning, detail, messageDirection } = progress;
    if (!p) return;

    // Deduplicate: For SIP events, use sipMessage as key; for phases, use phase name
    const isNewPhase = p !== lastPhaseRef.current;
    const isNewSipMsg = sipMessage && sipMessage !== lastSipMsgRef.current;

    // Only add entry if it's a new phase or a new SIP message
    if (!isNewPhase && !isNewSipMsg) return;

    if (isNewPhase) lastPhaseRef.current = p;
    if (isNewSipMsg) lastSipMsgRef.current = sipMessage!;

    const entryType = classifyEntry(p, messageDirection, warning);

    // For SIP events, use the sipMessage as label; for phases, use phaseLabel
    const entryLabel = sipMessage || phaseLabel(p);

    const entry: ActivityEntry = {
      ts: Date.now(),
      label: entryLabel,
      phase: p,
      transport: phaseTransport(p),
      direction: messageDirection,
      sipMessage,
      sdpInfo,
      natInfo,
      remoteRtp,
      warning,
      detail,
      entryType,
    };
    setActivityLog((prev) => [...prev.slice(-49), entry]);
  }, [progress?.phase, progress?.sipMessage, progress?.warning, progress?.natInfo]);

  /* ── Compute packet rate (per second) ── */
  // Stable interval — reads current values from refs, never torn down/recreated.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - prevRateTs.current) / 1000;
      if (dt > 0.5) {
        const tx = currentTxRef.current;
        const rx = currentRxRef.current;
        setTxRate(Math.round((tx - prevTxRef.current) / dt));
        setRxRate(Math.round((rx - prevRxRef.current) / dt));
        prevTxRef.current = tx;
        prevRxRef.current = rx;
        prevRateTs.current = now;
      }
    }, 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-scroll activity log ── */
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activityLog.length]);

  /* ── Phase steps for timeline ── */
  const phaseKeys = useMemo(() => Object.keys(PHASE_LABEL), []);
  const transportPrefix = phase?.startsWith("g711") ? "g711_" : "t38_";
  const relevantPhases = useMemo(
    () => phaseKeys.filter((k) =>
      k === "connecting" || k === "rtp" || k.startsWith(transportPrefix)
    ).filter((k) =>
      // Exclude diagnostic-only phases from timeline
      !k.startsWith("sip_") && k !== "nat_discovery" && k !== "warning"
    ),
    [phaseKeys, transportPrefix]
  );
  const currentIdx = relevantPhases.indexOf(phase ?? "");

  /* ── Animated flow bar width (0-100) ── */
  const txFlowPct = isPagePhase ? Math.min(100, (txRate / 50) * 100) : (packetsTx > 0 ? 15 : 0);
  const rxFlowPct = isPagePhase ? Math.min(100, (rxRate / 50) * 100) : (packetsRx > 0 ? 15 : 0);

  return (
    <div className="h-full flex flex-col gap-3 overflow-auto">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 shrink-0">
        {isComplete ? (
          <CheckCircle2 className={cn("h-4 w-4 shrink-0", phase === "complete" ? "text-success" : "text-destructive")} />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-mono font-medium text-foreground block truncate">{target}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        {onCancel && !isComplete && (
          <TooltipWrapper title="Cancel" description="Abort the current fax transmission.">
            <Button variant="destructive" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={onCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              <span className="ml-1">Cancel</span>
            </Button>
          </TooltipWrapper>
        )}
      </div>

      {/* ── Progress bar ── */}
      <div className="shrink-0 space-y-1">
        <Progress value={pct} className="h-1.5" />
        <div className="flex justify-between items-center">
          <span className="text-2xs font-mono text-muted-foreground tabular-nums">{pct}%</span>
          {transport && (
            <span className="inline-flex items-center gap-1">
              <span className={cn(
                "text-2xs font-bold px-1.5 rounded",
                transport === "T.38" ? "text-success bg-success/10" : "text-primary bg-primary/10"
              )}>{transport}</span>
              <TroubleshootLink articleId="t38-vs-passthrough" compact />
            </span>
          )}
        </div>
      </div>

      {/* ── Phase timeline ── */}
      <div className="shrink-0 flex gap-1 flex-wrap">
        {relevantPhases.map((key, i) => {
          const isCurrent = key === phase;
          const isPast = i < currentIdx;
          return (
            <span key={key} className={cn(
              "text-2xs px-1.5 py-0.5 rounded border font-medium transition-smooth",
              isCurrent ? "border-foreground/20 bg-muted/40 text-foreground" :
              isPast ? "border-success/30 bg-success/10 text-success" :
              "border-border/50 text-muted-foreground/60"
            )}>
              {PHASE_LABEL[key] ?? key}
            </span>
          );
        })}
      </div>

      {/* ── Live Packet Flow ── */}
      <div className="shrink-0 ui-panel-shell overflow-hidden">
        <div className="px-3 py-2 border-b border-border/30">
          <span className="section-label-sm">Live Packet Flow</span>
        </div>
        <div className="px-3 py-3 space-y-3">
          {/* TX flow */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 w-10 shrink-0">
              <ArrowUp className="h-3 w-3 text-success" />
              <span className="text-2xs font-bold text-success">TX</span>
            </div>
            <div className="flex-1 h-3.5 rounded-full bg-muted/30 overflow-hidden relative">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-[var(--motion-duration-attention)] [transition-timing-function:var(--motion-ease-overlay)]",
                  txFlowPct > 0 ? "bg-gradient-to-r from-success to-success" : "bg-muted/30"
                )}
                style={{ width: `${Math.max(txFlowPct, 2)}%` }}
              />
              {txFlowPct > 10 && (
                <div className="absolute inset-0 rounded-full overflow-hidden">
                  <div
                    className="h-full w-[200%] animate-[shimmer_1.5s_linear_infinite]"
                    style={{
                      background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
                    }}
                  />
                </div>
              )}
            </div>
            <span className="text-2xs font-mono tabular-nums text-muted-foreground w-12 text-right">{txRate}/s</span>
          </div>
          {/* RX flow */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 w-10 shrink-0">
              <ArrowDown className="h-3 w-3 text-primary" />
              <span className="text-2xs font-bold text-primary">RX</span>
            </div>
            <div className="flex-1 h-3.5 rounded-full bg-muted/30 overflow-hidden relative">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-[var(--motion-duration-attention)] [transition-timing-function:var(--motion-ease-overlay)]",
                  rxFlowPct > 0 ? "bg-gradient-to-r from-primary to-primary" : "bg-muted/30"
                )}
                style={{ width: `${Math.max(rxFlowPct, 2)}%` }}
              />
              {rxFlowPct > 10 && (
                <div className="absolute inset-0 rounded-full overflow-hidden">
                  <div
                    className="h-full w-[200%] animate-[shimmer_1.5s_linear_infinite]"
                    style={{
                      background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
                    }}
                  />
                </div>
              )}
            </div>
            <span className="text-2xs font-mono tabular-nums text-muted-foreground w-12 text-right">{rxRate}/s</span>
          </div>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="shrink-0 grid grid-cols-4 gap-2">
        {([
          { label: "Packets TX", value: packetsTx, color: "text-success" },
          { label: "Packets RX", value: packetsRx, color: "text-primary" },
          { label: "TX Rate", value: `${txRate}/s`, color: "text-foreground" },
          { label: "Elapsed", value: elapsedSecs > 0 ? `${elapsedSecs}s` : "–", color: "text-foreground" },
        ] as const).map((stat) => (
          <div key={stat.label} className="rounded-lg bg-muted/20 border border-border/50 px-2 py-2 text-center shadow-card">
            <span className={cn("text-sm font-bold tabular-nums block font-mono", stat.color)}>{stat.value}</span>
            <span className="text-2xs text-muted-foreground leading-none">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* ── SIP / Protocol Message Flow ── */}
      <div className="flex-1 min-h-0 ui-panel-shell overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-border/30 shrink-0 flex items-center gap-2">
          <span className="section-label-sm">Message Flow</span>
          <span className="text-3xs text-muted-foreground/60 ml-auto flex items-center gap-1.5">
            {activityLog.some((e) => e.entryType === "warning") && (
              <TroubleshootLink articleId="t38-vs-passthrough" compact />
            )}
            {activityLog.length} events
          </span>
        </div>
        <div className="flex-1 overflow-auto px-2 py-1.5 space-y-0.5">
          {activityLog.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 py-2 text-center">Waiting for activity...</p>
          ) : (
            activityLog.map((entry, i) => {
              const time = new Date(entry.ts);
              const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
              const isLast = i === activityLog.length - 1;
              return (
                <MessageFlowEntry
                  key={`${entry.ts}-${entry.phase}-${entry.sipMessage || i}`}
                  entry={entry}
                  timeStr={timeStr}
                  isLast={isLast}
                />
              );
            })
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* ── Capture link ── */}
      {progress?.captureSessionId && (
        <TooltipWrapper title="View live packet capture" description="Open the packet capture for this fax session.">
          <Button variant="link" className="shrink-0 text-xs h-auto p-0 gap-1.5"
            onClick={() => navigateTo("packet-capture", "analysis", {
              packetCaptureSessionId: progress.captureSessionId,
              viewerDetailsTab: "raw",
            })}>
            <Radio className="h-3.5 w-3.5" />View live packet capture
          </Button>
        </TooltipWrapper>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MessageFlowEntry — Single row in the SIP/RTP message flow
   ═══════════════════════════════════════════════════════════════════ */

function MessageFlowEntry({ entry, timeStr, isLast }: { entry: ActivityEntry; timeStr: string; isLast: boolean }) {
  const { direction, entryType, sipMessage, sdpInfo, natInfo, warning, detail, label } = entry;

  // Direction icon and row color
  const dirConfig = {
    outbound: {
      icon: <ArrowRight className="h-3 w-3" />,
      rowBg: "bg-success/5",
      iconColor: "text-success",
      borderColor: "border-l-success/60",
      dirLabel: "TX",
    },
    inbound: {
      icon: <ArrowLeft className="h-3 w-3" />,
      rowBg: "bg-primary/5",
      iconColor: "text-primary",
      borderColor: "border-l-primary/60",
      dirLabel: "RX",
    },
    info: {
      icon: <Info className="h-3 w-3" />,
      rowBg: "",
      iconColor: "text-muted-foreground",
      borderColor: "border-l-muted-foreground/30",
      dirLabel: "",
    },
  };

  // Warning overrides
  const isWarning = entryType === "warning";
  const config = isWarning
    ? {
        icon: <AlertTriangle className="h-3 w-3" />,
        rowBg: "bg-warning/10",
        iconColor: "text-warning",
        borderColor: "border-l-warning/60",
        dirLabel: "",
      }
    : dirConfig[direction ?? "info"];

  // NAT entries get a special icon
  const isNat = entryType === "nat";

  return (
    <div
      className={cn(
        "flex items-start gap-1.5 py-1 px-1.5 rounded border-l-2 transition-smooth",
        config.borderColor,
        config.rowBg,
        isLast && !isWarning && "ring-1 ring-foreground/20"
      )}
    >
      {/* Direction indicator */}
      <div className={cn("shrink-0 mt-0.5", config.iconColor)}>
        {isNat ? <Radio className="h-3 w-3" /> : config.icon}
      </div>

      {/* Timestamp */}
      <span className="text-3xs font-mono tabular-nums text-muted-foreground/60 shrink-0 mt-0.5 w-14">
        {timeStr}
      </span>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        {/* Primary message line */}
        <div className="flex items-center gap-1.5">
          {config.dirLabel && (
            <span className={cn(
              "text-3xs font-bold px-1 py-px rounded shrink-0",
              direction === "outbound" ? "bg-success/15 text-success" : "bg-primary/15 text-primary"
            )}>
              {config.dirLabel}
            </span>
          )}
          <span className={cn(
            "text-2xs font-mono truncate",
            isWarning ? "text-warning font-medium" :
            isLast ? "text-foreground font-medium" : "text-muted-foreground"
          )}>
            {sipMessage || label}
          </span>
          {isWarning && <TroubleshootLink articleId="t38-vs-passthrough" compact />}
        </div>

        {/* SDP info sub-line */}
        {sdpInfo && (
          <span className="text-3xs text-muted-foreground/60 font-mono block truncate mt-px">
            {sdpInfo}
          </span>
        )}

        {/* NAT info sub-line */}
        {natInfo && (
          <span className="text-3xs text-info/70 font-mono block truncate mt-px">
            {natInfo}
          </span>
        )}

        {/* Warning detail */}
        {warning && !sipMessage && (
          <span className="text-2xs text-warning/80 block truncate mt-px">
            {warning}
          </span>
        )}

        {/* Detail sub-line */}
        {detail && (
          <span className="text-3xs text-muted-foreground/60 block truncate mt-px">
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}
