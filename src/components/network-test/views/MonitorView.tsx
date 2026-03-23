import { useState, useEffect, useMemo } from "react";
import { listen } from "@/lib/tauriEvents";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { ToolViewShell } from "../components/ToolViewShell";
import { MetricCard } from "../components/MetricCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { BarChart3, Clock, Globe, Play, Square } from "@/lib/icons";
import { tooltips } from "@/lib/tooltips";
import { AppDivider } from "@/components/ui/panel-chrome";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import type { MonitorSample, MonitorStatus } from "@/types/networkTest";

const MONITOR_DURATION_OPTIONS = [
  { value: "30", label: "30 sec" },
  { value: "60", label: "1 min" },
  { value: "120", label: "2 min" },
  { value: "300", label: "5 min" },
];

const MONITOR_INTERVAL_OPTIONS = [
  { value: "250", label: "250 ms" },
  { value: "500", label: "500 ms" },
  { value: "1000", label: "1 sec" },
  { value: "2000", label: "2 sec" },
];

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter(isFiniteNumber);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function qualityScore(
  latencyMs: number | null | undefined,
  jitterMs: number | null | undefined,
  lossPct: number | null | undefined,
): number | null {
  if (!isFiniteNumber(latencyMs) && !isFiniteNumber(jitterMs) && !isFiniteNumber(lossPct)) return null;
  const latency = latencyMs ?? 999;
  const jitter = jitterMs ?? 999;
  const loss = lossPct ?? 100;

  const latencyScore =
    latency <= 35 ? 100 :
    latency <= 60 ? 90 :
    latency <= 100 ? 78 :
    latency <= 150 ? 62 :
    latency <= 220 ? 40 : 18;
  const jitterScore =
    jitter <= 4 ? 100 :
    jitter <= 8 ? 90 :
    jitter <= 15 ? 76 :
    jitter <= 25 ? 56 :
    jitter <= 40 ? 34 : 14;
  const lossScore =
    loss <= 0.1 ? 100 :
    loss <= 0.5 ? 88 :
    loss <= 1.0 ? 74 :
    loss <= 2.0 ? 54 :
    loss <= 5.0 ? 30 : 10;
  return Math.round(latencyScore * 0.45 + jitterScore * 0.35 + lossScore * 0.2);
}

function qualityLabel(score: number | null): { label: string; tone: "pass" | "warn" | "fail" | "idle" } {
  if (!isFiniteNumber(score)) return { label: "Unknown", tone: "idle" };
  if (score >= 85) return { label: "Excellent", tone: "pass" };
  if (score >= 70) return { label: "Good", tone: "pass" };
  if (score >= 55) return { label: "Fair", tone: "warn" };
  if (score >= 35) return { label: "Poor", tone: "warn" };
  return { label: "Critical", tone: "fail" };
}

function fmt2(value: number | null | undefined, suffix = ""): string {
  if (!isFiniteNumber(value)) return "--";
  return `${value.toFixed(2)}${suffix}`;
}

function metricTone(
  value: number | null | undefined,
  passMax: number,
  warnMax: number,
): "pass" | "warn" | "fail" | "idle" {
  if (!isFiniteNumber(value)) return "idle";
  if (value <= passMax) return "pass";
  if (value <= warnMax) return "warn";
  return "fail";
}

function formatElapsed(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(secs / 60);
  const rem = secs % 60;
  if (minutes <= 0) return `${rem}s`;
  return `${minutes}m ${rem}s`;
}

export function MonitorView() {
  const monitorRunning = useNetworkTestStore((s) => s.monitorRunning);
  const monitorSamples = useNetworkTestStore((s) => s.monitorSamples);
  const monitorTarget = useNetworkTestStore((s) => s.monitorTarget);
  const setMonitorTarget = useNetworkTestStore((s) => s.setMonitorTarget);
  const startMonitor = useNetworkTestStore((s) => s.startMonitor);
  const stopMonitor = useNetworkTestStore((s) => s.stopMonitor);
  const addMonitorSample = useNetworkTestStore((s) => s.addMonitorSample);
  const setMonitorRunning = useNetworkTestStore((s) => s.setMonitorRunning);
  const clearMonitorSamples = useNetworkTestStore((s) => s.clearMonitorSamples);

  const [target, setTarget] = useState(monitorTarget || "8.8.8.8");
  const [duration, setDuration] = useState("60");
  const [interval, setInterval_] = useState("1000");
  const [chartWindowSec, setChartWindowSec] = useState<15 | 30 | 60>(30);
  const [showLatency, setShowLatency] = useState(true);
  const [showJitter, setShowJitter] = useState(true);
  const [showLoss, setShowLoss] = useState(true);
  const [showQuality, setShowQuality] = useState(true);

  useEffect(() => {
    const unSample = listen<MonitorSample>("network-monitor-sample", (e) => addMonitorSample(e.payload));
    const unStatus = listen<MonitorStatus>("network-monitor-status", (e) => setMonitorRunning(e.payload.running));
    return () => { unSample.then((fn) => fn()); unStatus.then((fn) => fn()); };
  }, [addMonitorSample, setMonitorRunning]);

  const handleStart = () => {
    const safeDuration = Math.max(10, Math.min(3600, parseInt(duration, 10) || 60));
    const safeInterval = Math.max(250, Math.min(10000, parseInt(interval, 10) || 1000));
    setMonitorTarget(target);
    clearMonitorSamples();
    setDuration(String(safeDuration));
    setInterval_(String(safeInterval));
    startMonitor(target, safeDuration, safeInterval);
  };

  const latest = monitorSamples.length > 0 ? monitorSamples[monitorSamples.length - 1] : null;
  const recentSamples = useMemo(() => monitorSamples.slice(-60), [monitorSamples]);
  const chartData = useMemo(() => {
    if (monitorSamples.length === 0) return [];
    const lastTs = monitorSamples[monitorSamples.length - 1]?.timestamp_ms ?? Date.now();
    const cutoff = lastTs - chartWindowSec * 1000;
    const windowed = monitorSamples.filter((s) => s.timestamp_ms >= cutoff);
    return windowed.map((s, idx) => ({
      idx,
      time: new Date(s.timestamp_ms).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
      latency: s.latency_ms ?? null,
      jitter: s.jitter_ms ?? null,
      loss: s.packet_loss_pct ?? null,
      quality: qualityScore(s.latency_ms, s.jitter_ms, s.packet_loss_pct),
    }));
  }, [monitorSamples, chartWindowSec]);

  const avgLatency = useMemo(() => avg(recentSamples.map((s) => s.latency_ms)), [recentSamples]);
  const avgJitter = useMemo(() => avg(recentSamples.map((s) => s.jitter_ms)), [recentSamples]);
  const avgLoss = useMemo(() => avg(recentSamples.map((s) => s.packet_loss_pct)), [recentSamples]);

  const latencyValues = useMemo(() => recentSamples.map((s) => s.latency_ms).filter(isFiniteNumber), [recentSamples]);
  const minLatency = latencyValues.length > 0 ? Math.min(...latencyValues) : null;
  const maxLatency = latencyValues.length > 0 ? Math.max(...latencyValues) : null;
  const p95Latency =
    latencyValues.length > 0
      ? [...latencyValues].sort((a, b) => a - b)[Math.max(0, Math.min(latencyValues.length - 1, Math.floor(latencyValues.length * 0.95) - 1))]
      : null;

  const latestQuality = qualityScore(latest?.latency_ms, latest?.jitter_ms, latest?.packet_loss_pct);
  const quality = qualityLabel(latestQuality);

  const goodSamples = recentSamples.filter((s) =>
    isFiniteNumber(s.latency_ms) &&
    isFiniteNumber(s.jitter_ms) &&
    isFiniteNumber(s.packet_loss_pct) &&
    s.latency_ms <= 150 &&
    s.jitter_ms <= 20 &&
    s.packet_loss_pct <= 1,
  ).length;
  const compliancePct = recentSamples.length > 0 ? (goodSamples / recentSamples.length) * 100 : null;
  const anomalyCount = recentSamples.filter((s) =>
    (isFiniteNumber(s.latency_ms) && s.latency_ms > 150) ||
    (isFiniteNumber(s.jitter_ms) && s.jitter_ms > 20) ||
    (isFiniteNumber(s.packet_loss_pct) && s.packet_loss_pct > 1),
  ).length;
  const firstSampleTs = monitorSamples.length > 0 ? monitorSamples[0]?.timestamp_ms ?? null : null;
  const lastSampleTs = monitorSamples.length > 0 ? monitorSamples[monitorSamples.length - 1]?.timestamp_ms ?? null : null;
  const elapsedSeconds = firstSampleTs && lastSampleTs ? (lastSampleTs - firstSampleTs) / 1000 : 0;
  const sampleRate = elapsedSeconds > 0 ? monitorSamples.length / elapsedSeconds : null;

  return (
    <ToolViewShell
      icon={BarChart3}
      tint="text-warning"
      title="Continuous Monitor"
      description="Real-time latency and jitter monitoring over time"
      compact
      controls={
        <div className="flex items-center gap-3">
          <TooltipWrapper entry={tooltips.netMonitorTarget} side="bottom">
            <span><Globe className="h-4 w-4 text-muted-foreground/60 shrink-0 cursor-help" /></span>
          </TooltipWrapper>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Target host or IP address"
            className="h-10 flex-1 min-w-0"
            disabled={monitorRunning}
          />
          <div className="inline-flex h-10 items-center gap-2 rounded-md border border-border/45 bg-card/65 px-2.5">
            <TooltipWrapper entry={tooltips.netMonitorDuration}>
              <span className="text-2xs text-muted-foreground/80 whitespace-nowrap cursor-help">Duration</span>
            </TooltipWrapper>
            <AppDropdown
              value={duration}
              onValueChange={setDuration}
              options={MONITOR_DURATION_OPTIONS}
              className="h-8 w-[98px] text-xs"
              disabled={monitorRunning}
            />
            <AppDivider orientation="vertical" size="md" className="mx-0.5" />
            <TooltipWrapper entry={tooltips.netMonitorInterval}>
              <span className="text-2xs text-muted-foreground/80 whitespace-nowrap cursor-help">Interval</span>
            </TooltipWrapper>
            <AppDropdown
              value={interval}
              onValueChange={setInterval_}
              options={MONITOR_INTERVAL_OPTIONS}
              className="h-8 w-[108px] text-xs"
              disabled={monitorRunning}
            />
          </div>
          {monitorRunning ? (
            <TooltipWrapper entry={tooltips.netStopTest}>
              <Button variant="destructive" className="h-10 gap-1.5 px-4 text-xs" onClick={stopMonitor}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </TooltipWrapper>
          ) : (
            <TooltipWrapper entry={tooltips.netRunTest}>
              <Button
                className="h-10 gap-1.5 px-4 text-xs"
                onClick={handleStart}
                disabled={!target.trim()}
              >
                <Play className="h-4 w-4" />
                Start
              </Button>
            </TooltipWrapper>
          )}
        </div>
      }
    >
      {/* Empty state */}
      {!monitorRunning && monitorSamples.length === 0 && (
        <div className="ui-hero-surface overflow-hidden">
          <div className="app-view-surface-pad">
            <EmptyState
              variant="card"
              icon={<BarChart3 />}
              title="Monitor is ready"
              description="Start a session to track latency stability, jitter drift, packet loss spikes, and overall quality over time."
              action={(
                <Button
                  className="h-10 gap-1.5 px-4 text-xs"
                  onClick={handleStart}
                  disabled={!target.trim()}
                >
                  <Play className="h-4 w-4" />
                  Start monitor
                </Button>
              )}
              className="min-h-[280px]"
            />
          </div>
        </div>
      )}

      {/* Results */}
      {(monitorRunning || monitorSamples.length > 0) && (
        <div className="ui-hero-surface overflow-hidden">
          <div className="app-view-surface-pad space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-md border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="section-label-sm mb-1">Target</div>
                <div className="text-xs text-muted-foreground truncate">{monitorTarget || target}</div>
              </div>
              <div className="rounded-md border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="section-label-sm mb-1">Elapsed</div>
                <div className="text-xs text-muted-foreground">{formatElapsed(elapsedSeconds)}</div>
              </div>
              <div className="rounded-md border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="section-label-sm mb-1">Sample Interval</div>
                <div className="text-xs text-muted-foreground">{interval} ms</div>
              </div>
              <div className="rounded-md border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="section-label-sm mb-1">Sample Rate</div>
                <div className="text-xs text-muted-foreground">{sampleRate != null ? `${sampleRate.toFixed(2)}/s` : "--"}</div>
              </div>
              <div className="rounded-md border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="section-label-sm mb-1">Samples</div>
                <div className="text-xs text-muted-foreground">{monitorSamples.length}</div>
              </div>
            </div>

            {/* Metric grid */}
            <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
              <MetricCard
                label="Link Quality"
                value={latestQuality != null ? latestQuality.toFixed(0) : "--"}
                unit="/100"
                subtitle={quality.label}
                status={quality.tone}
                className="h-full"
                tooltip={{
                  title: "Composite quality score",
                  description: "Weighted score from latency, jitter, and packet loss over recent samples.",
                }}
              />
              <MetricCard
                label="Latency"
                value={fmt2(latest?.latency_ms)}
                unit="ms"
                subtitle={avgLatency != null ? `avg ${avgLatency.toFixed(2)} ms` : undefined}
                status={metricTone(latest?.latency_ms, 50, 150)}
                className="h-full"
                tooltip={{
                  title: "Round-trip latency",
                  description: "Current round-trip time to target. Lower is better for call responsiveness.",
                }}
              />
              <MetricCard
                label="Jitter"
                value={fmt2(latest?.jitter_ms)}
                unit="ms"
                subtitle={avgJitter != null ? `avg ${avgJitter.toFixed(2)} ms` : undefined}
                status={metricTone(latest?.jitter_ms, 8, 20)}
                className="h-full"
                tooltip={{
                  title: "Packet delay variation",
                  description: "Variation in packet arrival timing. Lower jitter improves voice stability.",
                }}
              />
              <MetricCard
                label="Packet Loss"
                value={fmt2(latest?.packet_loss_pct)}
                unit="%"
                subtitle={avgLoss != null ? `avg ${avgLoss.toFixed(2)}%` : undefined}
                status={metricTone(latest?.packet_loss_pct, 1, 5)}
                className="h-full"
                tooltip={{
                  title: "Packet loss rate",
                  description: "Dropped packets as a percentage of sent samples. Loss above 1% can impact call quality.",
                }}
              />
              <MetricCard
                label="Latency p95"
                value={fmt2(p95Latency)}
                unit="ms"
                subtitle={minLatency != null && maxLatency != null ? `${minLatency.toFixed(2)}–${maxLatency.toFixed(2)} ms` : undefined}
                status={p95Latency != null ? (p95Latency < 100 ? "pass" : p95Latency < 180 ? "warn" : "fail") : "idle"}
                className="h-full"
                tooltip={{
                  title: "95th percentile latency",
                  description: "Latency value that 95% of samples are below. Highlights tail-latency spikes.",
                }}
              />
              <MetricCard
                label="Anomalies"
                value={anomalyCount.toString()}
                subtitle="last 60 samples"
                status={anomalyCount === 0 ? "pass" : anomalyCount < 5 ? "warn" : "fail"}
                className="h-full"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="rounded-md border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="section-label-sm mb-1">Latency Envelope</div>
                <div className="text-xs text-muted-foreground">
                  {minLatency != null && maxLatency != null
                    ? `${minLatency.toFixed(2)}–${maxLatency.toFixed(2)} ms`
                    : "No samples"}
                  {p95Latency != null ? ` · p95 ${p95Latency.toFixed(2)} ms` : ""}
                </div>
              </div>
              <div className="rounded-md border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="section-label-sm mb-1">SLO Compliance</div>
                <div className="text-xs text-muted-foreground">
                  {compliancePct != null
                    ? `${compliancePct.toFixed(0)}% of recent samples meet VoIP targets`
                    : "No samples"}
                </div>
              </div>
              <div className="rounded-md border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="section-label-sm mb-1">Targets</div>
                <div className="text-xs text-muted-foreground">Latency &lt; 150 ms · Jitter &lt; 20 ms · Loss &lt; 1%</div>
              </div>
            </div>

            {/* Live chart */}
            {chartData.length > 1 ? (
              <div className="rounded-md border border-border/35 bg-background/45 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="section-label-sm">Live Quality Timeline</h4>
                  <div className="subview-tabs-compact">
                    <TooltipWrapper title="Show last 15 seconds" description="Focus on immediate behavior and short spike detection.">
                      <button
                        type="button"
                        data-state={chartWindowSec === 15 ? "active" : "inactive"}
                        className="subview-tab-compact ui-hover-press motion-reduce:transform-none focus-visible:shadow-focus"
                        onClick={() => setChartWindowSec(15)}
                      >
                        15s
                      </button>
                    </TooltipWrapper>
                    <TooltipWrapper title="Show last 30 seconds" description="Balanced window for trend analysis and near-term detail.">
                      <button
                        type="button"
                        data-state={chartWindowSec === 30 ? "active" : "inactive"}
                        className="subview-tab-compact ui-hover-press motion-reduce:transform-none focus-visible:shadow-focus"
                        onClick={() => setChartWindowSec(30)}
                      >
                        30s
                      </button>
                    </TooltipWrapper>
                    <TooltipWrapper title="Show last 60 seconds" description="Longer horizon to surface drift and recurring stability issues.">
                      <button
                        type="button"
                        data-state={chartWindowSec === 60 ? "active" : "inactive"}
                        className="subview-tab-compact ui-hover-press motion-reduce:transform-none focus-visible:shadow-focus"
                        onClick={() => setChartWindowSec(60)}
                      >
                        60s
                      </button>
                    </TooltipWrapper>
                    <AppDivider orientation="vertical" size="md" className="mx-1" />
                    <TooltipWrapper title="Latency (ms)" description="Round-trip delay to the target. Lower and flatter is better for call quality.">
                      <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-background/55 px-2 text-2xs text-muted-foreground cursor-pointer">
                        <Checkbox checked={showLatency} onCheckedChange={(checked) => setShowLatency(Boolean(checked))} className="size-3.5" />
                        Latency
                      </label>
                    </TooltipWrapper>
                    <TooltipWrapper title="Jitter (ms)" description="Packet-to-packet latency variation. Spikes can cause robotic audio and choppy playback.">
                      <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-background/55 px-2 text-2xs text-muted-foreground cursor-pointer">
                        <Checkbox checked={showJitter} onCheckedChange={(checked) => setShowJitter(Boolean(checked))} className="size-3.5" />
                        Jitter
                      </label>
                    </TooltipWrapper>
                    <TooltipWrapper title="Loss (%)" description="Percentage of packets that never arrive. Persistent loss quickly degrades voice quality.">
                      <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-background/55 px-2 text-2xs text-muted-foreground cursor-pointer">
                        <Checkbox checked={showLoss} onCheckedChange={(checked) => setShowLoss(Boolean(checked))} className="size-3.5" />
                        Loss
                      </label>
                    </TooltipWrapper>
                    <TooltipWrapper title="Quality (/100)" description="Composite score derived from latency, jitter, and loss. Higher scores indicate better real-time performance.">
                      <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-background/55 px-2 text-2xs text-muted-foreground cursor-pointer">
                        <Checkbox checked={showQuality} onCheckedChange={(checked) => setShowQuality(Boolean(checked))} className="size-3.5" />
                        Quality
                      </label>
                    </TooltipWrapper>
                  </div>
                </div>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.15)" />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }}
                      />
                      <YAxis
                        yAxisId="ms"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }}
                        width={36}
                        tickFormatter={(v) => `${v}`}
                      />
                      <YAxis
                        yAxisId="pct"
                        orientation="right"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }}
                        width={34}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        labelFormatter={(label) => `Time ${label}`}
                        formatter={(value: number | string | undefined, name: string | undefined) => {
                          const seriesName = name ?? "Value";
                          if (typeof value === "number") {
                            const unit = seriesName.includes("%") || seriesName.includes("Quality") ? "" : " ms";
                            return [`${value.toFixed(2)}${unit}`, seriesName];
                          }
                          if (typeof value === "string") {
                            return [value, seriesName];
                          }
                          return ["--", seriesName];
                        }}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "12px",
                          boxShadow: "var(--shadow-card)",
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "10px" }}
                      />
                      <ReferenceLine yAxisId="ms" y={150} stroke="#f59e0b" strokeDasharray="4 4" ifOverflow="extendDomain" />
                      <ReferenceLine yAxisId="pct" y={1} stroke="#ef4444" strokeDasharray="4 4" ifOverflow="extendDomain" />
                      {showLatency && <Line yAxisId="ms" type="monotone" dataKey="latency" stroke="#34d399" dot={false} strokeWidth={1.6} name="Latency (ms)" />}
                      {showJitter && <Line yAxisId="ms" type="monotone" dataKey="jitter" stroke="#facc15" dot={false} strokeWidth={1.6} name="Jitter (ms)" />}
                      {showLoss && <Line yAxisId="pct" type="monotone" dataKey="loss" stroke="#f87171" dot={false} strokeWidth={1.4} name="Loss (%)" strokeDasharray="4 2" />}
                      {showQuality && <Line yAxisId="pct" type="monotone" dataKey="quality" stroke="#60a5fa" dot={false} strokeWidth={1.2} name="Quality (/100)" />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <EmptyState
                variant="inline"
                compact
                icon={<Clock />}
                title={monitorRunning ? "Waiting for chart data" : "Not enough chart data"}
                description={monitorRunning ? "Samples are being collected. The timeline appears after at least two points." : "Run or continue a session to build enough datapoints for the timeline."}
                className="rounded-md border border-border/35 bg-background/45"
              />
            )}
          </div>
        </div>
      )}
    </ToolViewShell>
  );
}
