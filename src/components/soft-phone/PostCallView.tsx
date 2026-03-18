import { useRef } from "react";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { navigateTo } from "@/lib/navigation";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Activity, Clock, CheckCircle, PhoneOff, ArrowRightLeft, FileText,
  AlertTriangle, Download, Mic,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/dateTime";
import { SOFTPHONE } from "./softphone-constants";
import { formatCallDuration, formatDurationMs } from "./softphone-utils";
import { SoftphoneSection } from "./SoftphoneSection";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import type { Call } from "@/lib/softphone";
import { SipFlowTimeline } from "./SipFlowTimeline";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface PostCallViewProps {
  call: Call;
  displayMetrics: {
    mos: number;
    jitter_ms: number;
    send_peak: number;
    recv_peak: number;
    loss_percent: number;
    lost_packets: number;
  } | null;
  displayMetricsHistory: { t: number; mos: number; jitter_ms: number; loss_percent: number }[];
}

interface TimelineSegment {
  type: "answer" | "talk" | "hold" | "mute";
  startMs: number;
  endMs: number;
}

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                               */
/* ------------------------------------------------------------------ */

const SEGMENT_STYLES: Record<TimelineSegment["type"], { label: string; color: string }> = {
  answer: { label: "To answer", color: "bg-warning/70" },
  talk:   { label: "Talk",      color: "bg-success/70" },
  hold:   { label: "On hold",   color: "bg-muted" },
  mute:   { label: "Muted",     color: "bg-foreground/30" },
};

const GAUGE_R = 38;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

function getScoreColor(score: number) {
  if (score >= 70) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-destructive";
}

function getScoreStroke(score: number) {
  if (score >= 70) return "hsl(var(--success))";
  if (score >= 50) return "hsl(var(--warning))";
  return "hsl(var(--destructive))";
}

function getScoreLabel(score: number) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Poor";
}

function getMosColorClass(mos: number) {
  if (mos >= 4.0) return "text-success";
  if (mos >= 3.0) return "text-warning";
  return "text-destructive";
}

function getMosBadgeClasses(mos: number) {
  if (mos >= 4.0) return "bg-success/10 text-success";
  if (mos >= 3.0) return "bg-warning/10 text-warning";
  return "bg-destructive/10 text-destructive";
}

function getJitterColorClass(jitter: number) {
  if (jitter <= 30) return "text-success";
  if (jitter <= 50) return "text-warning";
  return "text-destructive";
}

function getLossColorClass(loss: number) {
  if (loss <= 1) return "text-success";
  if (loss <= 3) return "text-warning";
  return "text-destructive";
}

function computeSegments(call: Call): TimelineSegment[] {
  const startMs = new Date(call.startTime).getTime();
  const endMs = call.endTime ? new Date(call.endTime).getTime() : startMs;
  if (endMs <= startMs) return [];

  const answerMs = call.responseTimeMs ?? 0;
  const talkStart = Math.min(startMs + answerMs, endMs);
  const segments: TimelineSegment[] = [];

  if (answerMs > 0 && talkStart > startMs) {
    segments.push({ type: "answer", startMs, endMs: talkStart });
  }

  type Evt = { at: number; kind: "hold" | "resume" | "mute" | "unmute" };
  const events: Evt[] = [];
  for (const e of call.holdEvents ?? []) {
    events.push({ at: new Date(e.at).getTime(), kind: e.type });
  }
  for (const e of call.muteEvents ?? []) {
    events.push({ at: new Date(e.at).getTime(), kind: e.type });
  }
  events.sort((a, b) => a.at - b.at);

  let cursor = talkStart;
  let onHold = false;
  let muted = false;

  for (const evt of events) {
    const t = Math.max(talkStart, Math.min(evt.at, endMs));
    if (t > cursor) {
      segments.push({
        type: onHold ? "hold" : muted ? "mute" : "talk",
        startMs: cursor,
        endMs: t,
      });
      cursor = t;
    }
    if (evt.kind === "hold") onHold = true;
    else if (evt.kind === "resume") onHold = false;
    else if (evt.kind === "mute") muted = true;
    else if (evt.kind === "unmute") muted = false;
  }

  if (cursor < endMs) {
    segments.push({
      type: onHold ? "hold" : muted ? "mute" : "talk",
      startMs: cursor,
      endMs,
    });
  }

  return segments;
}

/* ------------------------------------------------------------------ */
/*  Chart tooltip                                                     */
/* ------------------------------------------------------------------ */

function QualityTooltip(props: {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: number }>;
  label?: string;
  metricLabel: string;
  unit: string;
  format: (v: number) => string;
}) {
  if (!props.active || !props.payload?.length || props.payload[0]?.value == null) return null;
  return (
    <div className="rounded-md bg-card/50 border border-border/55 shadow-sm px-3 py-2 text-popover-foreground min-w-[120px]">
      <div className="text-2xs text-muted-foreground">{props.label}</div>
      <div className="text-sm font-semibold">
        {props.metricLabel}: {props.format(props.payload[0].value)}{props.unit}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PostCallView                                                      */
/* ------------------------------------------------------------------ */

export function PostCallView({ call, displayMetrics, displayMetricsHistory }: PostCallViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const isRemoteAgentCall = !!call.remoteAgentId;
  const isFailed = call.state === "failed";
  const duration = formatCallDuration(call.startTime, call.endTime);
  const segments = computeSegments(call);
  const totalMs = call.endTime
    ? new Date(call.endTime).getTime() - new Date(call.startTime).getTime()
    : 0;

  /* Quality score */
  const mos = displayMetrics?.mos ?? 0;
  const jitter = displayMetrics?.jitter_ms ?? 0;
  const loss = displayMetrics?.loss_percent ?? 0;
  const rtpScore = displayMetrics
    ? Math.max(0, Math.min(100, Math.round((mos / 4.5) * 100 - jitter * 0.4 - loss * 2.2)))
    : 0;

  /* Chart data */
  const t0 = displayMetricsHistory[0]?.t ?? 0;
  const chartData = displayMetricsHistory.map(m => ({
    time: formatDurationMs(Math.max(0, (m.t - t0) * 1000)),
    mos: m.mos,
    jitter: m.jitter_ms,
    loss: m.loss_percent,
  }));
  const maxJitter = Math.max(10, ...displayMetricsHistory.map(m => m.jitter_ms));
  const maxLoss = Math.max(1, ...displayMetricsHistory.map(m => m.loss_percent));
  const avgMos = displayMetricsHistory.length > 0
    ? displayMetricsHistory.reduce((s, m) => s + m.mos, 0) / displayMetricsHistory.length
    : 0;
  const mosChartColor = avgMos >= 3.5
    ? "hsl(var(--success))"
    : avgMos >= 2.5
      ? "hsl(var(--warning))"
      : "hsl(var(--destructive))";

  /* Handlers */
  async function exportJson() {
    const data = {
      callId: call.id,
      target: call.target,
      direction: call.isInbound ? "inbound" : "outbound",
      state: call.state,
      startTime: call.startTime,
      endTime: call.endTime,
      codec: call.negotiatedCodec,
      statusCode: call.statusCode,
      responseTimeMs: call.responseTimeMs,
      metrics: displayMetrics,
      metricsHistory: displayMetricsHistory,
      holdEvents: call.holdEvents,
      muteEvents: call.muteEvents,
      sipLog: call.sipLog,
      transcription: call.transcription,
    };
    const json = JSON.stringify(data, null, 2);
    await saveExportFile(`call-${call.id}.json`, textToBase64(json), "JSON Files", "json");
  }

  async function exportCsv() {
    const headers = ["timestamp", "mos", "jitter_ms", "loss_percent"];
    const rows = displayMetricsHistory.map(m => `${m.t},${m.mos},${m.jitter_ms},${m.loss_percent}`);
    const csv = [headers.join(","), ...rows].join("\n");
    await saveExportFile(`call-${call.id}-metrics.csv`, textToBase64(csv), "CSV Files", "csv");
  }

  function handleJumpToPacket(_searchKey: string, _cseq?: string) {
    if (call.captureSessionId) {
      navigateTo("packet-capture", "viewer", {
        packetCaptureSessionId: call.captureSessionId,
      });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Summary Header ── */}
      <div className="shrink-0 px-5 py-4 border-b border-border/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base font-semibold truncate">{call.target}</span>
            <span
              className={cn(
                "text-2xs font-medium px-1.5 py-0.5 rounded-full shrink-0",
                call.isInbound ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground",
              )}
            >
              {call.isInbound ? "In" : "Out"}
            </span>
          </div>
          <span className="text-lg font-semibold tabular-nums shrink-0 ml-3">{duration}</span>
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {call.negotiatedCodec && (
            <span className={cn(SOFTPHONE.chip, "px-2 py-0.5 text-2xs")}>{call.negotiatedCodec}</span>
          )}
          <span
            className={cn(
              SOFTPHONE.chip, "px-2 py-0.5 text-2xs",
              isFailed ? "text-destructive" : "text-success",
            )}
          >
            {isFailed ? "Failed" : "Completed"}
            {call.statusCode ? ` (${call.statusCode})` : ""}
          </span>
          {displayMetrics && (
            <span className={cn(SOFTPHONE.chip, "px-2 py-0.5 text-2xs", getMosBadgeClasses(displayMetrics.mos))}>
              MOS {displayMetrics.mos.toFixed(1)}
            </span>
          )}
          {call.responseTimeMs != null && (
            <span className="tabular-nums">{call.responseTimeMs}ms</span>
          )}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* ── Quality Dashboard ── */}
        {displayMetrics ? (
          <section className="ui-panel-shell p-4">
            <div className="grid grid-cols-[140px_1fr] gap-4">
              {/* Left: gauge + final metrics */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative" style={{ width: 96, height: 96 }}>
                  <svg viewBox="0 0 96 96" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
                    <circle
                      cx="48" cy="48" r={GAUGE_R}
                      fill="none" stroke="hsl(var(--muted))" strokeWidth="6" opacity={0.3}
                    />
                    <circle
                      cx="48" cy="48" r={GAUGE_R}
                      fill="none" stroke={getScoreStroke(rtpScore)}
                      strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${(rtpScore / 100) * GAUGE_C} ${GAUGE_C}`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-16 w-16 rounded-full bg-background/80 flex flex-col items-center justify-center">
                      <span className={cn("text-xl font-semibold", getScoreColor(rtpScore))}>{rtpScore}</span>
                      <span className="text-2xs text-muted-foreground">{getScoreLabel(rtpScore)}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 w-full">
                  <div className="text-center">
                    <div className={SOFTPHONE.metricLabel}>MOS</div>
                    <div className={cn("text-xs font-semibold tabular-nums", getMosColorClass(mos))}>
                      {mos.toFixed(1)}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className={SOFTPHONE.metricLabel}>JITTER</div>
                    <div className={cn("text-xs font-semibold tabular-nums", getJitterColorClass(jitter))}>
                      {jitter.toFixed(0)}ms
                    </div>
                  </div>
                  <div className="text-center">
                    <div className={SOFTPHONE.metricLabel}>LOSS</div>
                    <div className={cn("text-xs font-semibold tabular-nums", getLossColorClass(loss))}>
                      {loss.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-center">
                    <div className={SOFTPHONE.metricLabel}>SEND</div>
                    <div className="text-xs font-semibold tabular-nums">{displayMetrics.send_peak}</div>
                  </div>
                </div>
              </div>

              {/* Right: quality over time charts */}
              {chartData.length >= 1 ? (
                <div className="flex flex-col gap-1 min-w-0">
                  {/* MOS */}
                  <div className="h-16">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="pcv-mosGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={mosChartColor} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={mosChartColor} stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 2" className="stroke-muted/30" vertical={false} />
                        <YAxis domain={[1, 4.5]} tick={{ fontSize: 9 }} className="text-muted-foreground" />
                        <Tooltip content={<QualityTooltip metricLabel="MOS" unit="" format={v => v.toFixed(2)} />} />
                        <Area type="monotone" dataKey="mos" stroke={mosChartColor} fill="url(#pcv-mosGrad)" strokeWidth={1.5} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Jitter */}
                  <div className="h-16">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="pcv-jitterGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 2" className="stroke-muted/30" vertical={false} />
                        <YAxis domain={[0, maxJitter]} tick={{ fontSize: 9 }} className="text-muted-foreground" />
                        <Tooltip content={<QualityTooltip metricLabel="Jitter" unit="ms" format={v => v.toFixed(1)} />} />
                        <Area type="monotone" dataKey="jitter" stroke="#0ea5e9" fill="url(#pcv-jitterGrad)" strokeWidth={1.5} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Loss */}
                  <div className="h-16">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="pcv-lossGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 2" className="stroke-muted/30" vertical={false} />
                        <XAxis dataKey="time" tick={{ fontSize: 9 }} className="text-muted-foreground" />
                        <YAxis domain={[0, maxLoss]} tick={{ fontSize: 9 }} className="text-muted-foreground" />
                        <Tooltip content={<QualityTooltip metricLabel="Loss" unit="%" format={v => v.toFixed(2)} />} />
                        <Area type="monotone" dataKey="loss" stroke="hsl(var(--destructive))" fill="url(#pcv-lossGrad)" strokeWidth={1.5} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <EmptyState
                  compact
                  variant="inline"
                  title="No quality history data"
                  description="This call does not have enough samples for trend charts."
                  className="h-full"
                />
              )}
            </div>
          </section>
        ) : (
          <section className="ui-panel-shell p-4">
            <EmptyState
              compact
              variant="inline"
              title="No RTP metrics available"
              description="This call did not produce RTP metric telemetry."
            />
          </section>
        )}

        {/* ── Error Banners ── */}
        {call.errorMessage && (
          <div className="rounded-lg bg-destructive/5 border border-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{call.errorMessage}</span>
            <TroubleshootLink articleId="one-way-audio" compact />
          </div>
        )}
        {call.audioError && (
          <div className="rounded-lg bg-destructive/5 border border-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
            <Mic className="h-4 w-4 shrink-0" />
            <span className="flex-1">{call.audioError}</span>
          </div>
        )}

        {/* ── Timeline ── */}
        <SoftphoneSection title="Timeline" icon={Clock}>
          <div className="text-2xl font-semibold tabular-nums">{duration}</div>

          {segments.length > 0 && totalMs > 0 && (
            <div className="space-y-2">
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted/50">
                {segments.map((seg, i) => {
                  const pct = ((seg.endMs - seg.startMs) / totalMs) * 100;
                  const meta = SEGMENT_STYLES[seg.type];
                  const startIso = new Date(seg.startMs).toISOString();
                  const endIso = new Date(seg.endMs).toISOString();
                  return (
                    <TooltipWrapper
                      key={i}
                      title={meta.label}
                      description={`${formatTime(startIso)} – ${formatTime(endIso)} (${formatDurationMs(seg.endMs - seg.startMs)})`}
                    >
                      <div
                        className={cn(meta.color, "h-full shrink-0 transition-smooth")}
                        style={{ width: `${pct}%`, minWidth: pct > 0 ? 2 : 0 }}
                      />
                    </TooltipWrapper>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-3 text-2xs text-muted-foreground">
                {(["answer", "talk", "hold", "mute"] as const)
                  .filter(t => segments.some(s => s.type === t))
                  .map(t => (
                    <div key={t} className="flex items-center gap-1">
                      <div className={cn("h-2 w-2 rounded-full", SEGMENT_STYLES[t].color)} />
                      <span>{SEGMENT_STYLES[t].label}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className={cn("grid gap-2", call.transferredTo ? "grid-cols-4" : "grid-cols-3")}>
            <div className={cn(SOFTPHONE.chip, "px-3 py-2 flex items-center gap-2")}>
              <div className="h-7 w-7 rounded bg-muted/50 flex items-center justify-center">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <div className={SOFTPHONE.metricLabel}>Started</div>
                <div className="text-sm font-medium tabular-nums">{formatTime(call.startTime)}</div>
              </div>
            </div>

            <div className={cn(SOFTPHONE.chip, "px-3 py-2 flex items-center gap-2")}>
              <div className="h-7 w-7 rounded bg-muted/50 flex items-center justify-center">
                <CheckCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <div className={SOFTPHONE.metricLabel}>Response</div>
                <div className="text-sm font-medium tabular-nums">
                  {call.responseTimeMs != null ? `${call.responseTimeMs}ms` : "—"}
                </div>
              </div>
            </div>

            <div className={cn(SOFTPHONE.chip, "px-3 py-2 flex items-center gap-2")}>
              <div className="h-7 w-7 rounded bg-muted/50 flex items-center justify-center">
                <PhoneOff className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <div className={SOFTPHONE.metricLabel}>Ended</div>
                <div className="text-sm font-medium tabular-nums">{formatTime(call.endTime)}</div>
              </div>
            </div>

            {call.transferredTo && (
              <div className={cn(SOFTPHONE.chip, "px-3 py-2 flex items-center gap-2")}>
                <div className="h-7 w-7 rounded bg-muted/50 flex items-center justify-center">
                  <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div>
                  <div className={SOFTPHONE.metricLabel}>Transferred</div>
                  <div className="text-sm font-medium truncate">{call.transferredTo}</div>
                </div>
              </div>
            )}
          </div>
        </SoftphoneSection>

        {/* ── Call Details (single combined view) ── */}
        <div className="space-y-3">
          <SipFlowTimeline
            call={call}
            isRemoteAgentCall={isRemoteAgentCall}
            captureSessionId={call.captureSessionId}
            onJumpToPacket={handleJumpToPacket}
          />

          <section className="space-y-3">
            <button
              onClick={exportJson}
              className={cn(SOFTPHONE.cardHover, "w-full px-4 py-3 flex items-center gap-3 text-sm")}
            >
              <Download className="h-4 w-4 text-muted-foreground" />
              <span>Export Call as JSON</span>
            </button>

            <button
              onClick={exportCsv}
              className={cn(SOFTPHONE.cardHover, "w-full px-4 py-3 flex items-center gap-3 text-sm")}
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>Export Metrics as CSV</span>
            </button>

            {call.captureSessionId && (
              <button
                onClick={() =>
                  navigateTo("packet-capture", "viewer", {
                    packetCaptureSessionId: call.captureSessionId!,
                  })
                }
                className={cn(SOFTPHONE.cardHover, "w-full px-4 py-3 flex items-center gap-3 text-sm")}
              >
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span>View in Packet Capture</span>
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
