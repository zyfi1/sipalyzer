import { useState, useCallback, useMemo } from "react";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { ToolViewShell } from "../components/ToolViewShell";
import { ResultSourceBadge } from "../components/ResultSourceBadge";
import { MetricCard } from "../components/MetricCard";
import { TracerouteTable } from "../components/TracerouteTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Network, Globe, Loader2, Play, GitCompareArrows, ChevronDown } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { tooltips } from "@/lib/tooltips";

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

export function TracerouteView() {
  const [target, setTarget] = useState("8.8.8.8");
  const [showComparison, setShowComparison] = useState(false);

  const traceroute = useNetworkTestStore((s) => s.traceroute);
  const runTraceroute = useNetworkTestStore((s) => s.runTraceroute);
  const lastSource = useNetworkTestStore((s) => s.lastSource);

  // Route comparison
  const routeTargetA = useNetworkTestStore((s) => s.routeTargetA);
  const routeTargetB = useNetworkTestStore((s) => s.routeTargetB);
  const setRouteTargetA = useNetworkTestStore((s) => s.setRouteTargetA);
  const setRouteTargetB = useNetworkTestStore((s) => s.setRouteTargetB);
  const routeResultA = useNetworkTestStore((s) => s.routeResultA);
  const routeResultB = useNetworkTestStore((s) => s.routeResultB);
  const routeComparing = useNetworkTestStore((s) => s.routeComparing);
  const runRouteComparison = useNetworkTestStore((s) => s.runRouteComparison);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("traceroute");

  const traceRunning = traceroute.status === "running";
  const r = traceroute.result;

  const source = lastSource.traceroute;
  const agentName = source?.source === "remote" ? (resolvedAgentName("traceroute") ?? undefined) : undefined;

  const [compA, setCompA] = useState(routeTargetA || "8.8.8.8");
  const [compB, setCompB] = useState(routeTargetB || "1.1.1.1");

  const handleRun = useCallback(() => {
    if (!target.trim()) return;
    runTraceroute(target.trim(), ctx);
  }, [target, ctx, runTraceroute]);

  const handleCompare = useCallback(() => {
    setRouteTargetA(compA);
    setRouteTargetB(compB);
    useNetworkTestStore.setState({ routeTargetA: compA, routeTargetB: compB });
    runRouteComparison();
  }, [compA, compB, setRouteTargetA, setRouteTargetB, runRouteComparison]);

  const rA = routeResultA.result;
  const rB = routeResultB.result;

  const analysis = useMemo(() => {
    if (!rA || !rB) return null;
    const maxHops = Math.max(rA.hops.length, rB.hops.length);
    let divergenceHop: number | null = null;
    const commonIps = new Set<string>();
    const ipsA = new Set(rA.hops.map((h) => h.ip).filter(Boolean) as string[]);
    const ipsB = new Set(rB.hops.map((h) => h.ip).filter(Boolean) as string[]);
    ipsA.forEach((ip) => { if (ipsB.has(ip)) commonIps.add(ip); });
    for (let i = 0; i < Math.min(rA.hops.length, rB.hops.length); i++) {
      if (rA.hops[i]!.ip && rB.hops[i]!.ip && rA.hops[i]!.ip !== rB.hops[i]!.ip) {
        divergenceHop = i + 1;
        break;
      }
    }
    const lastA = rA.hops.filter((h) => h.avg_rtt_ms != null).pop();
    const lastB = rB.hops.filter((h) => h.avg_rtt_ms != null).pop();
    const latencyDelta = lastA?.avg_rtt_ms != null && lastB?.avg_rtt_ms != null
      ? (lastA.avg_rtt_ms - lastB.avg_rtt_ms) : null;
    return { maxHops, divergenceHop, commonIps, latencyDelta };
  }, [rA, rB]);

  // Summary metrics
  const totalRtt = r
    ? r.hops.filter((h) => h.avg_rtt_ms != null).reduce((sum, h) => sum + (h.avg_rtt_ms ?? 0), 0)
    : null;
  const reachedDestination = r
    ? r.reached_destination || inferDestinationReachedFromHops(r.hops, target, r.resolved_ip)
    : false;

  return (
    <ToolViewShell
      icon={Network}
      tint="text-primary"
      title="Traceroute"
      description="Network path hop-by-hop analysis with RTT visualization"
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
            disabled={traceRunning}
            onKeyDown={(e) => e.key === "Enter" && !traceRunning && target.trim() && handleRun()}
          />
          <TooltipWrapper entry={tooltips.netRunTest}>
            <Button
              className="h-10 gap-2 px-5"
              onClick={handleRun}
              disabled={traceRunning || !target.trim()}
            >
              {traceRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Trace
            </Button>
          </TooltipWrapper>
        </div>
      }
    >
      {/* Empty state */}
      {!r && !traceRunning && (
        <EmptyState
          variant="inline"
          icon={<Network />}
          title="No traceroute results yet"
          description="Enter a destination and click Trace to map the network path."
          className="h-full min-h-0 p-6"
        />
      )}

      {/* Running indicator */}
      {traceRunning && !r && (
        <div className="ui-hero-surface app-view-surface-pad">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Tracing route...</span>
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

            {/* Summary metrics */}
            <div className="grid grid-cols-3 gap-3">
              <MetricCard
                label="Hops"
                value={String(r.hops.length)}
                status={reachedDestination ? "pass" : "warn"}
              />
              <MetricCard
                label="Total RTT"
                value={totalRtt !== null ? totalRtt.toFixed(1) : "--"}
                unit="ms"
              />
              <MetricCard
                label="Destination"
                value={reachedDestination ? "Reached" : "Unreachable"}
                status={reachedDestination ? "pass" : "fail"}
                subtitle={r.resolved_ip}
              />
            </div>

            {/* Hop table */}
            {r.hops.length > 0 && (
              <div>
                <h4 className="section-label-sm mb-3">
                  Network Path
                </h4>
                <TracerouteTable hops={r.hops} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {traceroute.error && !r && (
        <p className="text-xs text-destructive px-1">{traceroute.error}</p>
      )}

      {/* Route Comparison section */}
      <div className="ui-hero-surface overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center gap-3 px-4 py-4 hover:bg-card/80 transition-smooth"
          onClick={() => setShowComparison(!showComparison)}
        >
          <div className="h-8 w-8 rounded-lg bg-primary/[0.08] flex items-center justify-center shrink-0">
            <GitCompareArrows className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <span className="text-sm font-semibold block">Route Comparison</span>
            <span className="text-2xs text-muted-foreground/60 block">Compare network paths to two targets</span>
          </div>
          {rA && rB && analysis?.divergenceHop && (
            <Badge variant="outline" className="text-2xs bg-primary/10 text-primary border-primary/30 shrink-0">
              Diverge at hop {analysis.divergenceHop}
            </Badge>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground/60 transition-transform duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
              showComparison && "rotate-180",
            )}
          />
        </button>

        {showComparison && (
          <div className="border-t border-border/20 px-4 py-4 space-y-4 animate-panel-enter">
            {/* Comparison inputs */}
            <div className="flex items-center gap-2">
              <Input
                value={compA}
                onChange={(e) => setCompA(e.target.value)}
                placeholder="Target A"
                className="h-9 text-xs flex-1"
                disabled={routeComparing}
              />
              <span className="text-xs text-muted-foreground shrink-0 font-medium">vs</span>
              <Input
                value={compB}
                onChange={(e) => setCompB(e.target.value)}
                placeholder="Target B"
                className="h-9 text-xs flex-1"
                disabled={routeComparing}
              />
              <Button
                variant="neutral"
                className="h-9 gap-2 px-4 text-xs shrink-0"
                onClick={handleCompare}
                disabled={routeComparing || !compA.trim() || !compB.trim()}
              >
                {routeComparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Compare
              </Button>
            </div>

            {/* Comparison results */}
            {rA && rB && analysis && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {analysis.divergenceHop != null && (
                    <Badge variant="outline" className="text-2xs bg-primary/10 text-primary border-primary/30">
                      Diverge at hop {analysis.divergenceHop}
                    </Badge>
                  )}
                  {analysis.commonIps.size > 0 && (
                    <Badge variant="outline" className="text-2xs bg-success/10 text-success border-success/30">
                      {analysis.commonIps.size} shared hops
                    </Badge>
                  )}
                  {analysis.latencyDelta != null && (
                    <Badge variant="outline" className="text-2xs">
                      {Math.abs(analysis.latencyDelta).toFixed(1)} ms delta
                    </Badge>
                  )}
                </div>

                {/* Comparison table */}
                <div className="ui-hero-surface overflow-hidden">
                  <div className="grid grid-cols-[36px_1fr_56px_56px_1fr] section-label-sm bg-muted/10 px-2 py-1.5">
                    <span className="text-center">Hop</span>
                    <span className="truncate font-mono">{compA}</span>
                    <span className="text-right">RTT A</span>
                    <span className="text-right">RTT B</span>
                    <span className="text-right truncate font-mono">{compB}</span>
                  </div>
                  <div className="divide-y divide-border/20 max-h-48 overflow-y-auto">
                    {Array.from({ length: analysis.maxHops }, (_, i) => {
                      const hopA = rA.hops[i];
                      const hopB = rB.hops[i];
                      const isCommon = hopA?.ip != null && hopB?.ip != null && hopA.ip === hopB.ip;
                      return (
                        <div
                          key={i}
                          className={cn(
                            "grid grid-cols-[36px_1fr_56px_56px_1fr] text-2xs px-2 py-1.5 hover:bg-muted/10 transition-smooth",
                            isCommon && "bg-success/[0.02]",
                          )}
                        >
                          <span className="text-center text-muted-foreground/60 tabular-nums">{i + 1}</span>
                          <span className="font-mono truncate text-foreground/70">
                            {hopA?.hostname ?? hopA?.ip ?? "*"}
                          </span>
                          <span className="text-right tabular-nums text-muted-foreground/60">
                            {hopA?.avg_rtt_ms != null ? `${hopA.avg_rtt_ms.toFixed(1)}` : "--"}
                          </span>
                          <span className="text-right tabular-nums text-muted-foreground/60">
                            {hopB?.avg_rtt_ms != null ? `${hopB.avg_rtt_ms.toFixed(1)}` : "--"}
                          </span>
                          <span className="font-mono truncate text-right text-foreground/70">
                            {hopB?.hostname ?? hopB?.ip ?? "*"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Comparison errors */}
            {(routeResultA.error || routeResultB.error) && (
              <p className="text-xs text-destructive">{routeResultA.error || routeResultB.error}</p>
            )}
          </div>
        )}
      </div>
    </ToolViewShell>
  );
}
