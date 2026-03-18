import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ToolViewShell } from "../components/ToolViewShell";
import { ResultSourceBadge } from "../components/ResultSourceBadge";
import { MetricCard } from "../components/MetricCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Network, Globe, Loader2, Play } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { tooltips } from "@/lib/tooltips";
import * as api from "@/api/networkTest";
import type { MtrResult, MtrHop } from "@/types/networkTest";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { dispatchMtr } from "@/lib/executionDispatch";
import { listen } from "@/lib/tauriEvents";

const MTR_ROUNDS_PREF_KEY = "network.mtr.rounds";
const MTR_CONTINUOUS_PREF_KEY = "network.mtr.continuous";

function readStoredBool(key: string, fallback = false): boolean {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const parsed = raw == null ? NaN : parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function inferDestinationReachedFromHops(
  hops: Array<{ ip?: string | null; hostname?: string | null }>,
  target: string,
  resolvedIp?: string | null,
): boolean {
  const candidates = new Set(
    [normToken(target), normToken(resolvedIp)].filter(Boolean),
  );
  if (candidates.size === 0) return false;
  return hops.some((hop) => {
    const ip = normToken(hop.ip);
    const host = normToken(hop.hostname);
    return (ip && candidates.has(ip)) || (host && candidates.has(host));
  });
}

export function MtrView() {
  const [target, setTarget] = useState("8.8.8.8");
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(() => Math.max(5, Math.min(100, readStoredNumber(MTR_ROUNDS_PREF_KEY, 20))));
  const [continuousMode, setContinuousMode] = useState(() => readStoredBool(MTR_CONTINUOUS_PREF_KEY, false));
  const [result, setResult] = useState<MtrResult | null>(null);
  const [liveRound, setLiveRound] = useState(0);
  const [liveHops, setLiveHops] = useState<MtrHop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<{ source: "local" | "remote"; agentId?: string } | null>(null);
  const stopRequestedRef = useRef(false);
  const continuousModeRef = useRef(false);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("mtr");
  const agentName = lastSource?.source === "remote" ? (resolvedAgentName("mtr") ?? undefined) : undefined;

  useEffect(() => {
    continuousModeRef.current = continuousMode;
  }, [continuousMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MTR_CONTINUOUS_PREF_KEY, String(continuousMode));
  }, [continuousMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MTR_ROUNDS_PREF_KEY, String(rounds));
  }, [rounds]);

  useEffect(() => {
    const un = listen<{ round: number; hops: MtrHop[] }>("network-mtr-progress", (e) => {
      setLiveRound(e.payload.round);
      setLiveHops(e.payload.hops);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  const displayedHops = useMemo(
    () => (running && liveHops.length > 0 ? liveHops : (result?.hops ?? [])),
    [running, liveHops, result],
  );

  const summary = useMemo(() => {
    if (displayedHops.length === 0) return null;
    const withLatency = displayedHops.filter((h) => h.avg_ms > 0);
    const avgLatency = withLatency.length
      ? withLatency.reduce((sum, h) => sum + h.avg_ms, 0) / withLatency.length
      : 0;
    const avgLoss = displayedHops.reduce((sum, h) => sum + h.loss_pct, 0) / displayedHops.length;
    const reachedByHops = inferDestinationReachedFromHops(
      displayedHops,
      target,
      result?.resolved_ip,
    );
    return {
      hops: displayedHops.length,
      avgLatency,
      avgLoss,
      rounds: running ? liveRound : (result?.rounds ?? 0),
      reached: (result?.destination_reached ?? false) || reachedByHops,
    };
  }, [displayedHops, liveRound, result?.destination_reached, result?.resolved_ip, result?.rounds, running, target]);

  const maxAvgMs = useMemo(
    () => Math.max(1, ...displayedHops.map((h) => h.avg_ms || 0)),
    [displayedHops],
  );

  const runSingleMtr = useCallback(async (host: string) => {
    setLiveRound(0);
    setLiveHops([]);
    if (ctx.type !== "local") {
      const res = await dispatchMtr(ctx, host, () => api.networkMtr(host, 30, rounds), 30, rounds);
      const mtr = res.result as MtrResult;
      setResult(mtr);
      setLastSource({ source: res.source, agentId: res.agentId });
      if (mtr.error) setError(mtr.error);
      return;
    }

    const mtr = await api.networkMtr(host, 30, rounds);
    setResult(mtr);
    setLastSource({ source: "local" });
    if (mtr.error) setError(mtr.error);
  }, [ctx, rounds]);

  const handleRun = useCallback(async () => {
    if (!target.trim() || running) return;
    setRunning(true);
    setError(null);
    stopRequestedRef.current = false;
    const host = target.trim();
    try {
      do {
        await runSingleMtr(host);
        if (!continuousModeRef.current || stopRequestedRef.current) break;
        await new Promise((resolve) => setTimeout(resolve, 900));
      } while (!stopRequestedRef.current);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }, [target, running, runSingleMtr]);

  const handleStop = useCallback(async () => {
    if (!running) return;
    stopRequestedRef.current = true;
    setRunning(false);
    await api.networkStopMtr();
  }, [running]);

  return (
    <ToolViewShell
      icon={Network}
      tint="text-primary"
      title="MTR"
      description="Continuous traceroute combining ping and route analysis"
      compact
    >
      {/* Controls */}
      <div className="ui-hero-surface app-view-surface-pad">
        <div className="flex items-center gap-3 flex-wrap">
          <TooltipWrapper
            title="Target Host"
            description="The destination host or IP to trace repeatedly."
            side="bottom"
          >
            <span><Globe className="h-4 w-4 text-muted-foreground/60 shrink-0" /></span>
          </TooltipWrapper>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Host or IP (e.g. 8.8.8.8)"
            className="h-10 flex-1 min-w-0"
            disabled={running}
            onKeyDown={(e) => e.key === "Enter" && handleRun()}
          />
          <Input
            type="number"
            value={rounds}
            onChange={(e) => setRounds(Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 20)))}
            className="h-10 w-24 font-mono"
            disabled={running}
            title="Rounds"
          />
          <TooltipWrapper
            title="Run MTR"
            description="Perform repeated traceroute rounds and compute per-hop loss, latency, and jitter statistics."
            side="bottom"
          >
            <Button className="h-10 gap-2 px-5" onClick={running ? handleStop : handleRun} disabled={!running && !target.trim()}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Stop" : "Run"}
            </Button>
          </TooltipWrapper>
          <Button
            type="button"
            variant={continuousMode ? "default" : "outline"}
            className="h-10 px-3 text-xs"
            disabled={running}
            onClick={() => setContinuousMode((v) => !v)}
          >
            Continuous
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {!result && !running && !error && (
        <EmptyState
          variant="inline"
          icon={<Network />}
          title="No MTR results yet"
          description="Run a continuous traceroute to see per-hop packet loss, latency, and jitter statistics."
          className="h-full min-h-0 p-6"
        />
      )}

      {/* Running */}
      {running && (
        <div className="ui-hero-surface app-view-surface-pad">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">
              Running MTR {liveRound > 0 ? `— round ${liveRound}/${rounds}` : "— warming up..."}
            </span>
          </div>
        </div>
      )}

      {/* Results */}
      {displayedHops.length > 0 && (
        <div className="space-y-4">
          {lastSource && (
            <ResultSourceBadge source={lastSource.source} agentName={agentName} />
          )}
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Target" value={result?.host ?? target} subtitle={result?.resolved_ip ?? ""} />
            <MetricCard label="Hops" value={summary?.hops ?? 0} />
            <MetricCard label="Rounds" value={summary?.rounds ?? 0} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Destination"
              value={summary?.reached ? "Reached" : "Unreached"}
              status={summary?.reached ? "pass" : "warn"}
            />
            <MetricCard label="Avg Hop Loss" value={summary ? `${summary.avgLoss.toFixed(1)}%` : "--"} />
            <MetricCard label="Avg Hop Latency" value={summary ? `${summary.avgLatency.toFixed(1)} ms` : "--"} />
          </div>

          {/* Hop table */}
          <div className="ui-hero-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netTraceHop}><span className="cursor-help">Hop</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netTraceHost}><span className="cursor-help">Host</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netMtrLoss}><span className="cursor-help">Loss %</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netMtrSent}><span className="cursor-help">Sent</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"><span>Last</span></th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netMtrAvg}><span className="cursor-help">Avg</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netMtrBest}><span className="cursor-help">Best</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netMtrWorst}><span className="cursor-help">Worst</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netMtrStdDev}><span className="cursor-help">StDev</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"><TooltipWrapper entry={tooltips.netMtrJitter}><span className="cursor-help">Jitter</span></TooltipWrapper></th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Graph</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedHops.map((h) => (
                    <MtrHopRow key={h.hop} hop={h} maxAvgMs={maxAvgMs} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && displayedHops.length === 0 && (
        <p className="text-xs text-destructive px-1">{error}</p>
      )}
    </ToolViewShell>
  );
}

function MtrHopRow({ hop, maxAvgMs }: { hop: MtrHop; maxAvgMs: number }) {
  const lossColor = hop.loss_pct === 0
    ? "text-success"
    : hop.loss_pct < 5
      ? "text-warning"
      : "text-destructive";
  const latencyPct = Math.max(0, Math.min(100, (hop.avg_ms / maxAvgMs) * 100));
  const lossPct = Math.max(0, Math.min(100, hop.loss_pct));

  const hostLabel = hop.hostname || hop.ip || "*";

  return (
    <tr className="border-b border-border/20 hover:bg-muted/20 transition-smooth">
      <td className="px-3 py-1.5 font-mono text-muted-foreground">{hop.hop}</td>
      <td className="px-3 py-1.5">
        <div className="flex flex-col">
          <span className="font-medium">{hostLabel}</span>
          {hop.hostname && hop.ip && (
            <span className="text-2xs text-muted-foreground">{hop.ip}</span>
          )}
        </div>
      </td>
      <td className={cn("px-3 py-1.5 text-right font-mono", lossColor)}>
        {hop.loss_pct.toFixed(1)}%
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{hop.sent}</td>
      <td className="px-3 py-1.5 text-right font-mono">{hop.last_ms > 0 ? hop.last_ms.toFixed(1) : "--"}</td>
      <td className="px-3 py-1.5 text-right font-mono font-medium">{hop.avg_ms > 0 ? hop.avg_ms.toFixed(1) : "--"}</td>
      <td className="px-3 py-1.5 text-right font-mono">{hop.best_ms > 0 ? hop.best_ms.toFixed(1) : "--"}</td>
      <td className="px-3 py-1.5 text-right font-mono">{hop.worst_ms > 0 ? hop.worst_ms.toFixed(1) : "--"}</td>
      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{hop.stdev_ms > 0 ? hop.stdev_ms.toFixed(1) : "--"}</td>
      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{hop.jitter_ms > 0 ? hop.jitter_ms.toFixed(1) : "--"}</td>
      <td className="px-3 py-1.5">
        <div className="relative h-2 w-28 overflow-hidden rounded-full bg-muted/30">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary/60"
            style={{ width: `${latencyPct}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 rounded-full bg-destructive/55"
            style={{ width: `${lossPct}%` }}
          />
        </div>
      </td>
    </tr>
  );
}
