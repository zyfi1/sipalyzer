/**
 * Primary RTP stream analysis: quality metrics, issues, codec, endpoints, and troubleshooting.
 * Fills the main content area when a stream is selected in the RTP analysis view.
 */

import {
  AlertTriangle,
  Activity,
  Scan,
  Clock,
  Hash,
  ArrowRight,
  Copy,
  Check,
  TrendingUp,
  MaximizeScreen,
} from "@/lib/icons";
import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { RtpStreamInfo, RtpStreamHistory, ExpertFinding } from "@/types/packetCapture";
import { getRtpStreamHistory } from "@/api/packetCapture";
import { formatTime } from "@/lib/dateTime";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RtpAudioPlayer } from "./RtpAudioPlayer";
import { VOIP_QUALITY_THRESHOLDS } from "@/lib/voipQualityThresholds";
import {
  extractSsrcsFromFinding,
} from "@/lib/expertFindingUtils";

function formatDuration(startIso: string, endIso: string): string {
  try {
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    const sec = (e - s) / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const m = Math.floor(sec / 60);
    const r = (sec % 60).toFixed(0);
    return `${m}m ${r}s`;
  } catch {
    return "—";
  }
}

function durationSeconds(startIso: string, endIso: string): number {
  try {
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    return (e - s) / 1000;
  } catch {
    return 0;
  }
}

/** MOS interpretation for voice. */
function mosInterpretation(mos: number): string {
  if (mos >= 4.5) return "Excellent — near toll quality";
  if (mos >= 4) return "Good — acceptable for most calls";
  if (mos >= 3.5) return "Fair — some degradation noticeable";
  if (mos >= 3) return "Poor — significant quality issues";
  return "Bad — likely unintelligible";
}

/** Packet loss interpretation for voice. */
function lossInterpretation(pct: number): string {
  if (pct < 0.5) return "Negligible — no perceptible impact";
  if (pct < 1) return "Very low — excellent";
  if (pct < 3) return "Low — good for voice";
  if (pct < 5) return "Moderate — may hear occasional dropouts";
  if (pct < 10) return "High — frequent dropouts, consider codec/network";
  return "Very high — severe degradation, check path and congestion";
}

/** Jitter interpretation (ms) for voice. */
function jitterInterpretation(ms: number): string {
  if (ms < VOIP_QUALITY_THRESHOLDS.jitterMs.low) return "Low — well within typical jitter buffer";
  if (ms < VOIP_QUALITY_THRESHOLDS.jitterMs.moderate) return "Moderate — usually acceptable";
  if (ms < VOIP_QUALITY_THRESHOLDS.jitterMs.typicalBuffer) return "Noticeable — still within many endpoint jitter buffers";
  if (ms < VOIP_QUALITY_THRESHOLDS.jitterMs.warning) return "Borderline — may challenge smaller fixed jitter buffers";
  return "High — likely jitter buffer stress, check QoS and path";
}

/** Approximate expected packets per second for common codecs (for context). */
function expectedPps(codecName: string): number | null {
  const c = (codecName || "").toLowerCase();
  if (c.includes("pcmu") || c.includes("pcma") || c.includes("g.711")) return 50; // 20 ms
  if (c.includes("g.722")) return 50;
  if (c.includes("g.729")) return 50;
  if (c.includes("g.723")) return 33; // ~30 ms
  if (c.includes("ilbc")) return 50;
  return null;
}

function mosQuality(mos: number): "good" | "fair" | "poor" {
  if (mos >= VOIP_QUALITY_THRESHOLDS.mos.good) return "good";
  if (mos >= VOIP_QUALITY_THRESHOLDS.mos.fair) return "fair";
  return "poor";
}

export interface RtpStreamDetailViewProps {
  stream: RtpStreamInfo;
  sessionId: string | null;
  /** @deprecated No longer used — kept for backward compat */
  onOpenInMonitor?: () => void;
  expertFindings?: ExpertFinding[];
}

type Issue = { id: string; label: string; severity: "error" | "warning" };

function getStreamIssues(stream: RtpStreamInfo): Issue[] {
  const issues: Issue[] = [];
  if (stream.lossPercentage >= VOIP_QUALITY_THRESHOLDS.lossPct.warning) {
    issues.push({
      id: "high-loss",
      label: `High packet loss (${stream.lossPercentage.toFixed(1)}%)`,
      severity: stream.lossPercentage >= VOIP_QUALITY_THRESHOLDS.lossPct.critical ? "error" : "warning",
    });
  }
  if (stream.jitter >= VOIP_QUALITY_THRESHOLDS.jitterMs.warning) {
    issues.push({
      id: "high-jitter",
      label: `High jitter (${stream.jitter.toFixed(0)} ms)`,
      severity: stream.jitter >= VOIP_QUALITY_THRESHOLDS.jitterMs.critical ? "error" : "warning",
    });
  }
  if (stream.mosScore < VOIP_QUALITY_THRESHOLDS.mos.warning) {
    issues.push({
      id: "poor-mos",
      label: `Poor MOS (${stream.mosScore.toFixed(2)})`,
      severity: stream.mosScore < VOIP_QUALITY_THRESHOLDS.mos.critical ? "error" : "warning",
    });
  }
  if (stream.packetCount < VOIP_QUALITY_THRESHOLDS.packetCount.minimumContext) {
    issues.push({
      id: "low-packets",
      label: `Low packet count (${stream.packetCount})`,
      severity: "warning",
    });
  }
  return issues;
}

function MetricCard({
  label,
  value,
  sub,
  barPct,
  barColor,
}: {
  label: string;
  value: string;
  sub?: string;
  barPct?: number;
  barColor?: "good" | "warn" | "bad";
}) {
  const colorClass =
    barColor === "good"
      ? "bg-success"
      : barColor === "warn"
        ? "bg-warning"
        : barColor === "bad"
          ? "bg-destructive"
          : "bg-muted";
  return (
    <div className="surface-flat p-4">
      <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-2xl font-bold font-mono text-foreground">{value}</p>
      {sub != null && sub !== "" && (
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      )}
      {barPct != null && (
        <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full min-w-[4px] transition-smooth ${colorClass}`}
            style={{ width: `${Math.min(100, Math.max(0, barPct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Custom tooltip for quality charts. */
function QualityChartTooltip({
  active,
  payload,
  label,
  metricLabel,
  unit,
  format,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  metricLabel: string;
  unit: string;
  format: (v: number) => string;
}) {
  const firstValue = payload?.[0]?.value;
  if (!active || firstValue == null) return null;
  return (
    <div className="ui-control-shell rounded-md px-3 py-2 text-xs">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">
        {metricLabel}: {format(firstValue)}{unit}
      </p>
    </div>
  );
}

export function RtpStreamDetailView({ stream, sessionId, expertFindings }: RtpStreamDetailViewProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [history, setHistory] = useState<RtpStreamHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedChart, setExpandedChart] = useState<"mos" | "jitter" | "loss" | null>(null);

  // Fetch time-series history when stream or session changes
  useEffect(() => {
    if (!sessionId) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    getRtpStreamHistory(sessionId, stream.ssrc)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId, stream.ssrc]);

  const quality = mosQuality(stream.mosScore);
  const qualityLabel = quality === "good" ? "Good" : quality === "fair" ? "Fair" : "Poor";
  const durationStr = formatDuration(stream.firstPacketTime, stream.lastPacketTime);
  const durationSec = durationSeconds(stream.firstPacketTime, stream.lastPacketTime);
  const packetsPerSec = durationSec > 0 ? stream.packetCount / durationSec : 0;
  const expectedPpsValue = expectedPps(stream.codecName);
  const issues = getStreamIssues(stream);
  const streamKey = `${stream.srcIp}:${stream.srcPort}->${stream.dstIp}:${stream.dstPort}`;
  const primaryExpertIssue = (expertFindings ?? [])
    .filter((finding) => finding.category === "media")
    .map((finding) => {
      const evidenceValues = finding.evidence.map((e) => e.value);
      const hasExactStreamEvidence = finding.evidence.some(
        (e) => e.evidenceType === "rtpStream" && e.value === streamKey,
      );
      const hasSsrcMatch =
        extractSsrcsFromFinding(finding).includes(stream.ssrc) || finding.id.includes(`-${stream.ssrc}-`);
      const hasDirectionalKeyText = [
        finding.title,
        finding.description,
        finding.detail ?? "",
        ...evidenceValues,
      ].some((value) => value.includes(streamKey));

      let score = 0;
      if (hasExactStreamEvidence) score += 120;
      if (hasSsrcMatch) score += 100;
      if (hasDirectionalKeyText) score += 80;
      if (score === 0) return { finding, score: -1, severityRank: 0 };

      const severityRank =
        finding.severity === "critical" ? 3 : finding.severity === "warning" ? 2 : 1;
      return { finding, score, severityRank };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.severityRank - a.severityRank)[0]?.finding;
  const primaryIssuePacketIndices = Array.from(
    new Set(primaryExpertIssue?.evidence.flatMap((e) => e.packetIndices) ?? []),
  ).slice(0, 5);

  const mosPct = Math.min(100, Math.max(0, (stream.mosScore / 5) * 100));
  const lossPct = Math.min(100, stream.lossPercentage);
  const jitterNorm = Math.min(100, (stream.jitter / 100) * 100);

  const mosText = mosInterpretation(stream.mosScore);
  const lossText = lossInterpretation(stream.lossPercentage);
  const jitterText = jitterInterpretation(stream.jitter);

  const copyEndpoint = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      {/* Header actions */}
      {copied && (
        <div className="flex items-center gap-1 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> Copied
        </div>
      )}

      {/* Issues + recommendations */}
      {issues.length > 0 && (
        <div className={cn(
          "rounded-md border p-4 space-y-3",
          issues.some((i) => i.severity === "error")
            ? "border-destructive/40 bg-destructive/5"
            : "border-warning/40 bg-warning/5"
        )}>
          <h3 className={cn(
            "text-sm font-semibold flex items-center gap-2",
            issues.some((i) => i.severity === "error") ? "text-destructive" : "text-warning"
          )}>
            <AlertTriangle className="h-4 w-4" />
            Issues detected
          </h3>
          <ul className="flex flex-wrap gap-2">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className={`text-sm font-medium px-3 py-1.5 rounded-md ${
                  issue.severity === "error"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-warning/15 text-warning"
                }`}
              >
                {issue.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quality metrics — primary focus */}
      <section>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4" /> Quality metrics
        </h3>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <MetricCard
            label="MOS (1–5)"
            value={stream.mosScore.toFixed(2)}
            sub={qualityLabel + " — " + mosText}
            barPct={mosPct}
            barColor={quality === "good" ? "good" : quality === "fair" ? "warn" : "bad"}
          />
          <MetricCard
            label="Packet loss"
            value={`${stream.lossPercentage.toFixed(2)}%`}
            sub={`${stream.lostPackets} lost of ${stream.packetCount} — ${lossText}`}
            barPct={lossPct}
            barColor={
              stream.lossPercentage >= VOIP_QUALITY_THRESHOLDS.lossPct.critical
                ? "bad"
                : stream.lossPercentage >= VOIP_QUALITY_THRESHOLDS.lossPct.warning
                  ? "warn"
                  : "good"
            }
          />
          <MetricCard
            label="Jitter"
            value={`${stream.jitter.toFixed(1)} ms`}
            sub={jitterText}
            barPct={jitterNorm}
            barColor={
              stream.jitter >= VOIP_QUALITY_THRESHOLDS.jitterMs.critical
                ? "bad"
                : stream.jitter >= VOIP_QUALITY_THRESHOLDS.jitterMs.warning
                  ? "warn"
                  : "good"
            }
          />
        </div>
      </section>

      {/* Quality over time — time-series charts */}
      {sessionId && (
        <section>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4" /> Quality over time
          </h3>
          {historyLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Loading history...
            </div>
          ) : history && history.buckets.length > 1 ? (
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
              {/* MOS Chart */}
              <div className="surface-flat p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                    MOS over time
                  </p>
                  <TooltipWrapper title="Expand chart">
                    <button
                      type="button"
                      onClick={() => setExpandedChart("mos")}
                      className="ui-control-shell relative h-8 w-8 p-0 text-muted-foreground hover:text-foreground transition-smooth"
                    >
                      <MaximizeScreen className="absolute inset-0 m-auto h-4 w-4 shrink-0" />
                    </button>
                  </TooltipWrapper>
                </div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={history.buckets}
                      margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="mosGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 2" className="stroke-muted/40" vertical />
                      <XAxis
                        dataKey="timestamp"
                        tick={{ fontSize: 9 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(t) => {
                          try {
                            return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                          } catch {
                            return "";
                          }
                        }}
                        interval="preserveStartEnd"
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[1, 4.5]}
                        width={28}
                        tick={{ fontSize: 9 }}
                        stroke="hsl(var(--muted-foreground))"
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        content={(p) => (
                          <QualityChartTooltip
                            active={p.active}
                            payload={p.payload as { value: number }[] | undefined}
                            label={p.label != null ? String(p.label) : undefined}
                            metricLabel="MOS"
                            unit=""
                            format={(v) => v.toFixed(2)}
                          />
                        )}
                      />
                      <ReferenceLine y={4} stroke="hsl(var(--success))" strokeDasharray="3 3" strokeOpacity={0.6} />
                      <ReferenceLine y={2.5} stroke="hsl(var(--warning))" strokeDasharray="3 3" strokeOpacity={0.6} />
                      <Area
                        type="monotone"
                        dataKey="mos"
                        stroke="hsl(var(--success))"
                        strokeWidth={2.5}
                        fill="url(#mosGradient)"
                        dot={{ r: 2, fill: "hsl(var(--success))", strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Jitter Chart */}
              <div className="surface-flat p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                    Jitter over time (ms)
                  </p>
                  <TooltipWrapper title="Expand chart">
                    <button
                      type="button"
                      onClick={() => setExpandedChart("jitter")}
                      className="ui-control-shell relative h-8 w-8 p-0 text-muted-foreground hover:text-foreground transition-smooth"
                    >
                      <MaximizeScreen className="absolute inset-0 m-auto h-4 w-4 shrink-0" />
                    </button>
                  </TooltipWrapper>
                </div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={history.buckets}
                      margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="jitterGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 2" className="stroke-muted/40" vertical />
                      <XAxis
                        dataKey="timestamp"
                        tick={{ fontSize: 9 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(t) => {
                          try {
                            return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                          } catch {
                            return "";
                          }
                        }}
                        interval="preserveStartEnd"
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, "auto"]}
                        width={28}
                        tick={{ fontSize: 9 }}
                        stroke="hsl(var(--muted-foreground))"
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        content={(p) => (
                          <QualityChartTooltip
                            active={p.active}
                            payload={p.payload as { value: number }[] | undefined}
                            label={p.label != null ? String(p.label) : undefined}
                            metricLabel="Jitter"
                            unit=" ms"
                            format={(v) => v.toFixed(1)}
                          />
                        )}
                      />
                      <ReferenceLine y={20} stroke="hsl(var(--warning))" strokeDasharray="3 3" strokeOpacity={0.6} />
                      <ReferenceLine y={50} stroke="hsl(var(--destructive))" strokeDasharray="3 3" strokeOpacity={0.6} />
                      <Area
                        type="monotone"
                        dataKey="jitter"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2.5}
                        fill="url(#jitterGradient)"
                        dot={{ r: 2, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Packet Loss Chart */}
              <div className="surface-flat p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                    Packet loss over time (%)
                  </p>
                  <TooltipWrapper title="Expand chart">
                    <button
                      type="button"
                      onClick={() => setExpandedChart("loss")}
                      className="ui-control-shell relative h-8 w-8 p-0 text-muted-foreground hover:text-foreground transition-smooth"
                    >
                      <MaximizeScreen className="absolute inset-0 m-auto h-4 w-4 shrink-0" />
                    </button>
                  </TooltipWrapper>
                </div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={history.buckets}
                      margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 2" className="stroke-muted/40" vertical />
                      <XAxis
                        dataKey="timestamp"
                        tick={{ fontSize: 9 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(t) => {
                          try {
                            return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                          } catch {
                            return "";
                          }
                        }}
                        interval="preserveStartEnd"
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, "auto"]}
                        width={28}
                        tick={{ fontSize: 9 }}
                        stroke="hsl(var(--muted-foreground))"
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${Number(v)}%`}
                      />
                      <Tooltip
                        content={(p) => (
                          <QualityChartTooltip
                            active={p.active}
                            payload={p.payload as { value: number }[] | undefined}
                            label={p.label != null ? String(p.label) : undefined}
                            metricLabel="Loss"
                            unit="%"
                            format={(v) => v.toFixed(2)}
                          />
                        )}
                      />
                      <ReferenceLine y={1} stroke="hsl(var(--warning))" strokeDasharray="3 3" strokeOpacity={0.6} />
                      <ReferenceLine y={5} stroke="hsl(var(--destructive))" strokeDasharray="3 3" strokeOpacity={0.6} />
                      <Area
                        type="monotone"
                        dataKey="lossPercent"
                        stroke="hsl(var(--destructive))"
                        strokeWidth={2.5}
                        fill="url(#lossGradient)"
                        dot={{ r: 2, fill: "hsl(var(--destructive))", strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {history && history.buckets.length <= 1
                ? "Not enough data points for time-series graphs (need at least 2 seconds of data)."
                : "No time-series data available."}
            </div>
          )}
        </section>
      )}

      {/* Expand chart dialog */}
      <Dialog open={expandedChart != null} onOpenChange={(open) => !open && setExpandedChart(null)}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {expandedChart === "mos" && "MOS over time"}
              {expandedChart === "jitter" && "Jitter over time (ms)"}
              {expandedChart === "loss" && "Packet loss over time (%)"}
            </DialogTitle>
          </DialogHeader>
          {history && expandedChart && (
            <div className="flex-1 min-h-[320px] mt-2">
              <ResponsiveContainer width="100%" height={320}>
                {expandedChart === "mos" ? (
                  <AreaChart data={history.buckets} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <defs>
                      <linearGradient id="mosGradientExp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 2" className="stroke-muted/40" vertical />
                    <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(t) => { try { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; } }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                    <YAxis domain={[1, 4.5]} width={36} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
                    <Tooltip content={(p) => <QualityChartTooltip active={p.active} payload={p.payload as { value: number }[] | undefined} label={p.label != null ? String(p.label) : undefined} metricLabel="MOS" unit="" format={(v) => v.toFixed(2)} />} />
                    <ReferenceLine y={4} stroke="hsl(var(--success))" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <ReferenceLine y={2.5} stroke="hsl(var(--warning))" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <Area type="monotone" dataKey="mos" stroke="hsl(var(--success))" strokeWidth={2.5} fill="url(#mosGradientExp)" dot={{ r: 2.5, fill: "hsl(var(--success))", strokeWidth: 0 }} />
                  </AreaChart>
                ) : expandedChart === "jitter" ? (
                  <AreaChart data={history.buckets} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <defs>
                      <linearGradient id="jitterGradientExp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 2" className="stroke-muted/40" vertical />
                    <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(t) => { try { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; } }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                    <YAxis domain={[0, "auto"]} width={36} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
                    <Tooltip content={(p) => <QualityChartTooltip active={p.active} payload={p.payload as { value: number }[] | undefined} label={p.label != null ? String(p.label) : undefined} metricLabel="Jitter" unit=" ms" format={(v) => v.toFixed(1)} />} />
                    <ReferenceLine y={20} stroke="hsl(var(--warning))" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <ReferenceLine y={50} stroke="hsl(var(--destructive))" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <Area type="monotone" dataKey="jitter" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#jitterGradientExp)" dot={{ r: 2.5, fill: "hsl(var(--primary))", strokeWidth: 0 }} />
                  </AreaChart>
                ) : expandedChart === "loss" ? (
                  <AreaChart data={history.buckets} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <defs>
                      <linearGradient id="lossGradientExp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 2" className="stroke-muted/40" vertical />
                    <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(t) => { try { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; } }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                    <YAxis domain={[0, "auto"]} width={36} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} tickFormatter={(v) => `${Number(v)}%`} />
                    <Tooltip content={(p) => <QualityChartTooltip active={p.active} payload={p.payload as { value: number }[] | undefined} label={p.label != null ? String(p.label) : undefined} metricLabel="Loss" unit="%" format={(v) => v.toFixed(2)} />} />
                    <ReferenceLine y={1} stroke="hsl(var(--warning))" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <ReferenceLine y={5} stroke="hsl(var(--destructive))" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <Area type="monotone" dataKey="lossPercent" stroke="hsl(var(--destructive))" strokeWidth={2.5} fill="url(#lossGradientExp)" dot={{ r: 2.5, fill: "hsl(var(--destructive))", strokeWidth: 0 }} />
                  </AreaChart>
                ) : null}
              </ResponsiveContainer>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Combined brief + analysis context */}
      <section className="surface-flat p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Summary & Analysis Context</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p><strong className="text-foreground">MOS:</strong> {mosText}</p>
          <p><strong className="text-foreground">Packet loss:</strong> {lossText}</p>
          <p><strong className="text-foreground">Jitter:</strong> {jitterText}</p>
          {primaryExpertIssue && (
            <>
              <p><strong className="text-foreground">Summary:</strong> {primaryExpertIssue.explanationSummary ?? primaryExpertIssue.description}</p>
              <p><strong className="text-foreground">Impact:</strong> {primaryExpertIssue.explanationImpact ?? "Media quality may be affected during this stream interval."}</p>
              <p><strong className="text-foreground">Why:</strong> {primaryExpertIssue.explanationWhy ?? "Rule-based evidence correlation matched this stream profile."}</p>
              <div>
                <p><strong className="text-foreground">What this means in practice:</strong></p>
                <p className="mt-1">
                  We can see media quality degradation on traffic from {stream.srcIp}:{stream.srcPort} to{" "}
                  {stream.dstIp}:{stream.dstPort} during {formatTime(stream.firstPacketTime)} to{" "}
                  {formatTime(stream.lastPacketTime)}. You can review this selected stream in{" "}
                  <span className="text-foreground">Quality over time</span> and inspect packet details
                  {primaryIssuePacketIndices.length > 0
                    ? ` around packet ${primaryIssuePacketIndices.map((idx) => `#${idx}`).join(", ")}.`
                    : " in the capture evidence for this call window."}
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Derived stats: duration, rate, expected vs observed */}
      <section className="surface-flat p-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4" /> Derived stats
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="font-mono font-medium">{durationStr} ({durationSec.toFixed(2)} s)</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Observed rate</dt>
            <dd className="font-mono font-medium">{packetsPerSec.toFixed(1)} packets/s</dd>
          </div>
          {expectedPpsValue != null && (
            <div>
              <dt className="text-muted-foreground">Typical rate ({stream.codecName})</dt>
              <dd className="font-mono font-medium">~{expectedPpsValue} packets/s</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Lost vs total</dt>
            <dd className="font-mono font-medium">{stream.lostPackets} / {stream.packetCount} ({stream.lossPercentage.toFixed(2)}%)</dd>
          </div>
        </dl>
        {expectedPpsValue != null && durationSec > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Expected packets for {durationSec.toFixed(1)} s at ~{expectedPpsValue} pps: ~{Math.round(expectedPpsValue * durationSec)}.
            Observed: {stream.packetCount}. {stream.packetCount < expectedPpsValue * durationSec * 0.9 ? "Lower than expected may indicate capture gaps or early termination." : "In line with expected rate."}
          </p>
        )}
      </section>

      {/* Codec & RTP details */}
      <section className="surface-flat p-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
          <Hash className="h-4 w-4" /> Codec & RTP
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Codec</dt>
            <dd className="font-mono font-medium">{stream.codecName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Payload type</dt>
            <dd className="font-mono font-medium">{stream.payloadType}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">SSRC</dt>
            <dd className="font-mono font-medium">{stream.ssrc}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Packets</dt>
            <dd className="font-mono font-medium">{stream.packetCount} total, {stream.lostPackets} lost</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="font-mono font-medium">{durationStr}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Time range</dt>
            <dd className="font-mono font-medium text-xs">
              {formatTime(stream.firstPacketTime)} – {formatTime(stream.lastPacketTime)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Endpoints */}
      <section className="surface-flat p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-foreground">Endpoints</h3>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
              quality === "good"
                ? "bg-success/15 text-success"
                : quality === "fair"
                  ? "bg-warning/15 text-warning"
                  : "bg-destructive/15 text-destructive"
            }`}
          >
            <Scan className="h-3.5 w-3.5" />
            {qualityLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TooltipWrapper title="Copy source endpoint" description="Copy source IP:port to clipboard.">
            <button
              type="button"
              onClick={() => copyEndpoint(`${stream.srcIp}:${stream.srcPort}`)}
              className="ui-control-shell flex items-center gap-2 px-3 py-2 text-left"
            >
              <span className="font-mono text-sm">{stream.srcIp}:{stream.srcPort}</span>
              <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          </TooltipWrapper>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <TooltipWrapper title="Copy destination endpoint" description="Copy destination IP:port to clipboard.">
            <button
              type="button"
              onClick={() => copyEndpoint(`${stream.dstIp}:${stream.dstPort}`)}
              className="ui-control-shell flex items-center gap-2 px-3 py-2 text-left"
            >
              <span className="font-mono text-sm">{stream.dstIp}:{stream.dstPort}</span>
              <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          </TooltipWrapper>
        </div>
      </section>

      {/* Timeline bar */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-4 w-4 shrink-0" />
        <span className="font-mono">{formatTime(stream.firstPacketTime)}</span>
        <TooltipWrapper title="Stream duration" description={`${durationStr} active`}>
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="bg-foreground/60 h-full rounded-full min-w-[4px]"
              style={{ width: "100%" }}
            />
          </div>
        </TooltipWrapper>
        <span className="font-mono">{formatTime(stream.lastPacketTime)}</span>
      </div>

      {/* Audio playback (Feature 7) */}
      {sessionId && (
        <RtpAudioPlayer
          sessionId={sessionId}
          ssrc={stream.ssrc}
          codecName={stream.codecName}
        />
      )}

      {/* Audio issues - silence/clipping detection (Feature 8) */}
      {stream.audioIssues && stream.audioIssues.length > 0 && (
        <div className={cn(
          "rounded-md border p-3 space-y-2",
          stream.audioIssues.some((i) => i.severity === "error")
            ? "border-destructive/40 bg-destructive/5"
            : "border-warning/40 bg-warning/5"
        )}>
          <h3 className="text-xs font-semibold flex items-center gap-2 text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            Audio issues detected
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {stream.audioIssues.map((issue, i) => (
              <span
                key={i}
                className={cn(
                  "text-2xs font-medium px-2 py-1 rounded-md",
                  issue.severity === "error"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-warning/15 text-warning"
                )}
              >
                {issue.type === "silence"
                  ? `Silence detected (${(issue.durationMs / 1000).toFixed(1)}s at ${issue.startTimeSec.toFixed(0)}s)`
                  : issue.type === "clipping"
                    ? `Clipping detected (${(issue.durationMs / 1000).toFixed(1)}s at ${issue.startTimeSec.toFixed(0)}s)`
                    : `One-way audio (${(issue.durationMs / 1000).toFixed(1)}s at ${issue.startTimeSec.toFixed(0)}s)`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
