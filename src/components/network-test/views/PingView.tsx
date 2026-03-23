import { useState, useCallback } from "react";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { ToolViewShell } from "../components/ToolViewShell";
import { ResultSourceBadge } from "../components/ResultSourceBadge";
import { MetricCard } from "../components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Activity, Globe, Loader2, Play, Zap } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { tooltips } from "@/lib/tooltips";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const PROBE_COUNTS = [4, 8, 16, 32] as const;

export function PingView() {
  const [target, setTarget] = useState("8.8.8.8");
  const [count, setCount] = useState<number>(8);
  const [showMtu, setShowMtu] = useState(false);

  const ping = useNetworkTestStore((s) => s.ping);
  const mtu = useNetworkTestStore((s) => s.mtu);
  const runPing = useNetworkTestStore((s) => s.runPing);
  const runMtu = useNetworkTestStore((s) => s.runMtu);
  const lastSource = useNetworkTestStore((s) => s.lastSource);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("ping");

  const pingRunning = ping.status === "running";
  const mtuRunning = mtu.status === "running";
  const anyRunning = pingRunning || mtuRunning;
  const r = ping.result;
  const mr = mtu.result;

  const source = lastSource.ping;
  const agentName = source?.source === "remote" ? (resolvedAgentName("ping") ?? undefined) : undefined;

  const handleRun = useCallback(() => {
    if (!target.trim()) return;
    runPing(target.trim(), count, ctx);
    if (showMtu) runMtu(target.trim());
  }, [target, count, showMtu, ctx, runPing, runMtu]);

  return (
    <ToolViewShell
      icon={Activity}
      tint="text-success"
      title="Ping"
      description="ICMP echo request latency and packet loss measurement"
      compact
      controls={
        <div className="flex items-center gap-3">
          <TooltipWrapper entry={tooltips.netTargetHost} side="bottom">
            <span><Globe className="h-4 w-4 text-muted-foreground/60 shrink-0 cursor-help" /></span>
          </TooltipWrapper>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Target host or IP address"
            className="h-10 flex-1 min-w-0"
            disabled={anyRunning}
            onKeyDown={(e) => e.key === "Enter" && !anyRunning && target.trim() && handleRun()}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-2xs text-muted-foreground/60 font-medium mr-1">Probes</span>
            {PROBE_COUNTS.map((n) => (
              <TooltipWrapper key={n} entry={tooltips.netPingProbeCount}>
                <button
                  type="button"
                  onClick={() => setCount(n)}
                  disabled={anyRunning}
                  className={cn(
                    "h-8 w-9 rounded-lg text-xs font-mono tabular-nums transition-smooth",
                    count === n
                      ? "bg-primary/15 text-primary font-medium ring-1 ring-primary/20"
                      : "bg-muted/10 text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              </TooltipWrapper>
            ))}
          </div>
          <AppDivider orientation="vertical" size="lg" className="mx-0" />
          <div className="flex items-center gap-1.5">
            <Switch checked={showMtu} onCheckedChange={setShowMtu} className="scale-75" />
            <TooltipWrapper entry={tooltips.netPingMtu}>
              <span className="text-2xs text-muted-foreground/60 font-medium cursor-help">MTU</span>
            </TooltipWrapper>
          </div>
          <TooltipWrapper entry={tooltips.netRunTest}>
            <Button
              className="h-10 gap-2 px-5"
              onClick={handleRun}
              disabled={anyRunning || !target.trim()}
            >
              {anyRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run
            </Button>
          </TooltipWrapper>
        </div>
      }
    >
      {/* Empty state */}
      {!r && !mr && !anyRunning && (
        <EmptyState
          variant="inline"
          icon={<Activity />}
          title="No ping results yet"
          description="Enter a target host and click Run to measure latency and packet loss."
          className="h-full min-h-0 p-6"
        />
      )}

      {/* Running indicator */}
      {anyRunning && !r && (
        <div className="ui-hero-surface app-view-surface-pad">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-success" />
            <span className="text-sm text-muted-foreground">
              {pingRunning ? "Running ping probes..." : "Discovering MTU..."}
            </span>
          </div>
        </div>
      )}

      {/* Results */}
      {r && (
        <div className="ui-hero-surface overflow-hidden">
          <div className="app-view-surface-pad space-y-4">
            {/* Source badge */}
            {source && (
              <ResultSourceBadge source={source.source} agentName={agentName} />
            )}

            {/* Metric grid */}
            <div className="grid grid-cols-5 gap-3">
              <MetricCard
                label="Avg"
                value={r.avg_ms.toFixed(1)}
                unit="ms"
                status={r.avg_ms < 50 ? "pass" : r.avg_ms < 150 ? "warn" : "fail"}
              />
              <MetricCard label="Min" value={r.min_ms.toFixed(1)} unit="ms" />
              <MetricCard label="Max" value={r.max_ms.toFixed(1)} unit="ms" />
              <MetricCard
                label="Loss"
                value={r.packet_loss_pct.toFixed(1)}
                unit="%"
                status={r.packet_loss_pct < 1 ? "pass" : r.packet_loss_pct < 5 ? "warn" : "fail"}
              />
              <MetricCard label="Std Dev" value={`\u00B1${r.stddev_ms.toFixed(1)}`} unit="ms" />
            </div>

            {/* Probe chart */}
            {r.probes.length > 1 && (
              <div className="ui-hero-surface p-4">
                <h4 className="section-label-sm mb-3">
                  RTT per Probe
                </h4>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={r.probes.map((p) => ({ seq: p.seq, rtt: p.rtt_ms }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.15)" />
                      <XAxis
                        dataKey="seq"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }}
                        width={36}
                        tickFormatter={(v) => `${v}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "12px",
                          boxShadow: "var(--shadow-card)",
                        }}
                        formatter={(val: unknown) => [
                          `${typeof val === "number" ? val.toFixed(1) : "--"} ms`,
                          "RTT",
                        ]}
                      />
                      <Line type="monotone" dataKey="rtt" stroke="#34d399" dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Resolved IP */}
            <p className="text-xs text-muted-foreground/60 font-mono">{r.resolved_ip}</p>
          </div>

          {/* MTU section */}
          {showMtu && (mr || mtuRunning) && (
            <div className="border-t border-border/20 px-4 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-4 w-4 text-warning" />
                <h4 className="section-label-sm">
                  Path MTU Discovery
                </h4>
              </div>
              {mtuRunning && !mr && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Discovering MTU...</span>
                </div>
              )}
              {mr && (
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums">{mr.path_mtu}</span>
                    <span className="text-xs text-muted-foreground">bytes</span>
                    <span
                      className={cn(
                        "text-xs font-medium ml-auto",
                        mr.path_mtu >= 1400 ? "text-success" : mr.path_mtu >= 576 ? "text-warning" : "text-destructive",
                      )}
                    >
                      {mr.path_mtu >= 1400 ? "Standard" : mr.path_mtu >= 576 ? "Reduced" : "Very Low"}
                    </span>
                  </div>
                  <div className="relative h-1.5 rounded-full overflow-hidden bg-muted/10">
                    <div
                      className={cn(
                        "h-full rounded-full transition-smooth",
                        mr.path_mtu >= 1400
                          ? "bg-gradient-to-r from-success to-success"
                          : mr.path_mtu >= 576
                            ? "bg-gradient-to-r from-warning to-warning"
                            : "bg-gradient-to-r from-destructive to-destructive",
                      )}
                      style={{ width: `${Math.min(100, (mr.path_mtu / 1500) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-3xs text-muted-foreground/60 tabular-nums">
                    <span>0</span><span>576</span><span>1400</span><span>1500</span>
                  </div>
                </div>
              )}
              {mtu.error && <p className="text-xs text-destructive mt-2">{mtu.error}</p>}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {ping.error && !r && (
        <p className="text-xs text-destructive px-1">{ping.error}</p>
      )}
    </ToolViewShell>
  );
}
