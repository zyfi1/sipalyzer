import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";
import { SpeedTestView } from "@/components/network-test/views/SpeedTestView";
import { NtpView } from "@/components/network-test/views/NtpView";
import { MonitorView } from "@/components/network-test/views/MonitorView";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { ResultSourceBadge } from "@/components/network-test/components/ResultSourceBadge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Globe, Loader2, Play } from "@/lib/icons";
import { cn } from "@/lib/utils";
import * as api from "@/api/networkTest";
import { dispatchMtr } from "@/lib/executionDispatch";
import type { MtrResult, MtrHop, TracerouteHop } from "@/types/networkTest";
import { listen } from "@/lib/tauriEvents";

const MTR_CONTINUOUS_PREF_KEY = "network.path.mtr.continuous";
const MTR_ROUNDS_PREF_KEY = "network.path.mtr.rounds";

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

function inferDestinationReachedByHops(
  hops: Array<{ ip?: string | null; hostname?: string | null }>,
  target: string,
  resolvedIp?: string | null,
): boolean {
  const targetToken = normToken(target);
  const resolvedToken = normToken(resolvedIp);
  const candidates = new Set([targetToken, resolvedToken].filter(Boolean));
  if (candidates.size === 0) return false;
  return hops.some((hop) => {
    const ip = normToken(hop.ip);
    const host = normToken(hop.hostname);
    return (ip && candidates.has(ip)) || (host && candidates.has(host));
  });
}

type NetworkSubviewProps = {
  toolId?: string;
  onExecToolIdChange?: (id: string) => void;
};

type PathToolId = "path-tools" | "monitor" | "speed" | "ntp";

const TOOL_SEQUENCE: Array<{
  id: PathToolId;
  label: string;
  subtitle: string;
  tip: string;
  tipDesc: string;
}> = [
  { id: "path-tools", label: "Reachability", subtitle: "Ping + Traceroute + MTR", tip: "Reachability", tipDesc: "Unified reachability diagnostics in one view." },
  { id: "monitor", label: "Monitor", subtitle: "Continuous latency telemetry", tip: "Monitor", tipDesc: "Track latency over time for jitter trends." },
  { id: "speed", label: "Speed", subtitle: "WAN throughput and UDP capacity", tip: "Speed", tipDesc: "Measure upload/download and throughput baseline." },
  { id: "ntp", label: "NTP", subtitle: "Clock sync and drift validation", tip: "NTP", tipDesc: "Validate time sync and drift tolerance." },
];

export function PathReachabilityView({ toolId, onExecToolIdChange }: NetworkSubviewProps) {
  const [activeTool, setActiveTool] = useState<PathToolId>("path-tools");

  useEffect(() => {
    onExecToolIdChange?.(activeTool === "path-tools" ? "ping" : activeTool);
  }, [activeTool, onExecToolIdChange]);

  const renderActiveTool = () => {
    switch (activeTool) {
      case "path-tools":
        return <PathToolkitView />;
      case "monitor":
        return <MonitorView />;
      case "speed":
        return <SpeedTestView />;
      case "ntp":
        return <NtpView />;
      default:
        return <PathToolkitView />;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ToolSubTabs
        tabs={TOOL_SEQUENCE}
        activeTab={activeTool}
        onTabChange={setActiveTool}
        toolId={toolId}
      />
      {renderActiveTool()}
    </div>
  );
}

function PathToolkitView() {
  const [target, setTarget] = useState("8.8.8.8");
  const [pingCount, setPingCount] = useState(8);
  const [mtrRounds, setMtrRounds] = useState(() => Math.max(5, Math.min(100, readStoredNumber(MTR_ROUNDS_PREF_KEY, 20))));
  const [mtrContinuous, setMtrContinuous] = useState(() => readStoredBool(MTR_CONTINUOUS_PREF_KEY, false));
  const [activePanel, setActivePanel] = useState<"ping" | "trace" | "mtr">("ping");

  const [mtrRunning, setMtrRunning] = useState(false);
  const [mtrResult, setMtrResult] = useState<MtrResult | null>(null);
  const [mtrError, setMtrError] = useState<string | null>(null);
  const [mtrSource, setMtrSource] = useState<{ source: "local" | "remote"; agentId?: string } | null>(null);
  const [liveTraceHops, setLiveTraceHops] = useState<TracerouteHop[]>([]);
  const [liveMtrHops, setLiveMtrHops] = useState<MtrHop[]>([]);
  const [liveMtrRound, setLiveMtrRound] = useState(0);
  const mtrStopRequestedRef = useRef(false);

  const ping = useNetworkTestStore((s) => s.ping);
  const traceroute = useNetworkTestStore((s) => s.traceroute);
  const runPing = useNetworkTestStore((s) => s.runPing);
  const runTraceroute = useNetworkTestStore((s) => s.runTraceroute);
  const lastSource = useNetworkTestStore((s) => s.lastSource);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const pingCtx = resolvedContext("ping");
  const traceCtx = resolvedContext("traceroute");
  const mtrCtx = resolvedContext("mtr");

  const pingRunning = ping.status === "running";
  const traceRunning = traceroute.status === "running";
  const anyRunning = pingRunning || traceRunning || mtrRunning;

  useEffect(() => {
    const unTrace = listen<TracerouteHop>("network-traceroute-hop", (e) => {
      const incoming = e.payload;
      setLiveTraceHops((prev) => {
        const next = [...prev];
        const idx = next.findIndex((hop) => hop.hop === incoming.hop);
        if (idx >= 0) {
          next[idx] = incoming;
        } else {
          next.push(incoming);
          next.sort((a, b) => a.hop - b.hop);
        }
        return next;
      });
    });

    const unMtr = listen<{ round: number; hops: MtrHop[] }>("network-mtr-progress", (e) => {
      setLiveMtrRound(e.payload.round);
      setLiveMtrHops(e.payload.hops);
    });

    return () => {
      unTrace.then((fn) => fn());
      unMtr.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MTR_CONTINUOUS_PREF_KEY, String(mtrContinuous));
  }, [mtrContinuous]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MTR_ROUNDS_PREF_KEY, String(mtrRounds));
  }, [mtrRounds]);

  const runMtrOnce = useCallback(async () => {
    const host = target.trim();
    if (!host) return;
    setLiveMtrRound(0);
    setLiveMtrHops([]);
    if (mtrCtx.type !== "local") {
      const dispatched = await dispatchMtr(
        mtrCtx,
        host,
        () => api.networkMtr(host, 30, mtrRounds),
        30,
        mtrRounds,
      );
      const result = dispatched.result as MtrResult;
      setMtrResult(result);
      setMtrSource({ source: dispatched.source, agentId: dispatched.agentId });
      if (result.error) setMtrError(result.error);
      return;
    }

    const result = await api.networkMtr(host, 30, mtrRounds);
    setMtrResult(result);
    setMtrSource({ source: "local" });
    if (result.error) setMtrError(result.error);
  }, [target, mtrCtx, mtrRounds]);

  const runMtr = useCallback(async () => {
    if (!target.trim() || mtrRunning) return;
    setMtrRunning(true);
    setMtrError(null);
    mtrStopRequestedRef.current = false;
    try {
      do {
        await runMtrOnce();
        if (!mtrContinuous || mtrStopRequestedRef.current) break;
        await new Promise((resolve) => setTimeout(resolve, 900));
      } while (!mtrStopRequestedRef.current);
    } catch (error) {
      setMtrError(error instanceof Error ? error.message : String(error));
    } finally {
      setMtrRunning(false);
    }
  }, [target, mtrRunning, runMtrOnce, mtrContinuous]);

  const handleRunPing = useCallback(() => {
    if (!target.trim()) return;
    runPing(target.trim(), pingCount, pingCtx);
  }, [target, pingCount, pingCtx, runPing]);

  const handleRunTraceroute = useCallback(() => {
    if (!target.trim()) return;
    setLiveTraceHops([]);
    runTraceroute(target.trim(), traceCtx);
  }, [target, traceCtx, runTraceroute]);

  const handleRunActive = useCallback(() => {
    if (activePanel === "ping") return handleRunPing();
    if (activePanel === "trace") return handleRunTraceroute();
    return runMtr();
  }, [activePanel, handleRunPing, handleRunTraceroute, runMtr]);

  const handleRunAll = useCallback(async () => {
    if (!target.trim() || anyRunning) return;
    setLiveTraceHops([]);
    setLiveMtrRound(0);
    setLiveMtrHops([]);
    await Promise.allSettled([
      runPing(target.trim(), pingCount, pingCtx),
      runTraceroute(target.trim(), traceCtx),
      runMtrOnce(),
    ]);
  }, [target, anyRunning, runPing, pingCount, pingCtx, runTraceroute, traceCtx, runMtrOnce]);

  const activePanelRunning =
    (activePanel === "ping" && pingRunning) ||
    (activePanel === "trace" && traceRunning) ||
    (activePanel === "mtr" && mtrRunning);

  const handleStopActive = useCallback(async () => {
    if (activePanel === "ping" && pingRunning) {
      await api.networkStopPing();
      return;
    }
    if (activePanel === "trace" && traceRunning) {
      await api.networkStopTraceroute();
      return;
    }
    if (activePanel === "mtr" && mtrRunning) {
      mtrStopRequestedRef.current = true;
      setMtrRunning(false);
      await api.networkStopMtr();
    }
  }, [activePanel, mtrRunning, pingRunning, traceRunning]);

  const handleStopRunning = useCallback(async () => {
    const stops: Array<Promise<unknown>> = [];
    if (pingRunning) {
      stops.push(api.networkStopPing());
    }
    if (traceRunning) {
      stops.push(api.networkStopTraceroute());
    }
    if (mtrRunning) {
      mtrStopRequestedRef.current = true;
      stops.push(api.networkStopMtr());
    }
    setMtrRunning(false);
    await Promise.allSettled(stops);
  }, [mtrRunning, pingRunning, traceRunning]);

  const pingSource = lastSource.ping;
  const traceSource = lastSource.traceroute;
  const pingAgent = pingSource?.source === "remote" ? (resolvedAgentName("ping") ?? undefined) : undefined;
  const traceAgent = traceSource?.source === "remote" ? (resolvedAgentName("traceroute") ?? undefined) : undefined;
  const mtrAgent = mtrSource?.source === "remote" ? (resolvedAgentName("mtr") ?? undefined) : undefined;

  const pingSummary = useMemo(() => {
    if (!ping.result) return null;
    return {
      avg: ping.result.avg_ms,
      loss: ping.result.packet_loss_pct,
      min: ping.result.min_ms,
      max: ping.result.max_ms,
      probes: ping.result.probes.length,
    };
  }, [ping.result]);

  const traceDisplayHops = useMemo(() => {
    if (traceRunning && liveTraceHops.length > 0) return liveTraceHops;
    return traceroute.result?.hops ?? [];
  }, [traceRunning, liveTraceHops, traceroute.result]);

  const traceSummary = useMemo(() => {
    if (traceDisplayHops.length === 0) return null;
    const totalRtt = traceDisplayHops
      .filter((hop) => hop.avg_rtt_ms != null)
      .reduce((sum, hop) => sum + (hop.avg_rtt_ms ?? 0), 0);
    const reachedByHops = inferDestinationReachedByHops(
      traceDisplayHops,
      target,
      traceroute.result?.resolved_ip,
    );
    return {
      hops: traceDisplayHops.length,
      reached: (traceroute.result?.reached_destination ?? false) || reachedByHops,
      totalRtt,
    };
  }, [traceDisplayHops, traceroute.result?.reached_destination, traceroute.result?.resolved_ip, target]);

  const mtrDisplayHops = useMemo(() => {
    if (mtrRunning && liveMtrHops.length > 0) return liveMtrHops;
    return mtrResult?.hops ?? [];
  }, [mtrRunning, liveMtrHops, mtrResult]);

  const mtrSummary = useMemo(() => {
    if (mtrDisplayHops.length === 0) return null;
    const validHops = mtrDisplayHops.filter((hop) => hop.avg_ms > 0);
    const avgLoss = mtrDisplayHops.length
      ? mtrDisplayHops.reduce((sum, hop) => sum + hop.loss_pct, 0) / mtrDisplayHops.length
      : 0;
    const avgLatency = validHops.length
      ? validHops.reduce((sum, hop) => sum + hop.avg_ms, 0) / validHops.length
      : 0;
    const reachedByHops = inferDestinationReachedByHops(
      mtrDisplayHops,
      target,
      mtrResult?.resolved_ip,
    );
    return {
      hops: mtrDisplayHops.length,
      rounds: mtrRunning && liveMtrRound > 0 ? liveMtrRound : (mtrResult?.rounds ?? 0),
      reached: (mtrResult?.destination_reached ?? false) || reachedByHops,
      avgLoss,
      avgLatency,
    };
  }, [mtrDisplayHops, mtrRunning, liveMtrRound, mtrResult, target]);
  const mtrMaxAvg = useMemo(
    () => Math.max(1, ...mtrDisplayHops.map((hop) => hop.avg_ms || 0)),
    [mtrDisplayHops],
  );

  const pingState = getStateTone(pingRunning, !!ping.error, !!pingSummary);
  const traceState = getStateTone(traceRunning, !!traceroute.error, !!traceSummary);
  const mtrState = getStateTone(mtrRunning, !!mtrError, !!mtrSummary);
  const runActiveLabel = activePanelRunning
    ? (activePanel === "ping" ? "Stop Ping" : activePanel === "trace" ? "Stop TR" : "Stop MTR")
    : (activePanel === "ping" ? "Run Ping" : activePanel === "trace" ? "Run TR" : "Run MTR");
  const traceStateText = traceRunning
    ? (traceDisplayHops.length > 0 ? `RUN ${traceDisplayHops.length}H` : "RUN")
    : stateLabel(traceState);
  const mtrStateText = mtrRunning
    ? (liveMtrRound > 0 ? `RUN R${liveMtrRound}` : "RUN")
    : stateLabel(mtrState);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="ui-hero-surface px-3 py-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="subview-tabs-compact shrink-0">
              <button
                type="button"
                data-state={activePanel === "ping" ? "active" : "inactive"}
                onClick={() => setActivePanel("ping")}
                className="subview-tab-compact !h-8 !px-3 text-xs"
              >
                Ping
              </button>
              <button
                type="button"
                data-state={activePanel === "trace" ? "active" : "inactive"}
                onClick={() => setActivePanel("trace")}
                className="subview-tab-compact !h-8 !px-3 text-xs"
              >
                Traceroute
              </button>
              <button
                type="button"
                data-state={activePanel === "mtr" ? "active" : "inactive"}
                onClick={() => setActivePanel("mtr")}
                className="subview-tab-compact !h-8 !px-3 text-xs"
              >
                MTR
              </button>
            </div>
            <div className="relative min-w-[360px] flex-1">
              <Globe className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/65" />
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Target host or IP"
                className="h-8 w-full rounded-md border border-border/40 bg-background/60 pl-7 pr-2 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/40"
                onKeyDown={(e) => e.key === "Enter" && (activePanelRunning ? handleStopActive() : handleRunActive())}
              />
            </div>
            <Button
              size="sm"
              variant={activePanelRunning ? "outline" : "neutral"}
              className="h-8 px-3 text-xs whitespace-nowrap"
              onClick={activePanelRunning ? handleStopActive : handleRunActive}
              disabled={!activePanelRunning && !target.trim()}
            >
              {runActiveLabel}
            </Button>
            <TooltipWrapper title="Run all reachability checks" description="Runs Ping, Traceroute, and MTR in parallel.">
              <span>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 px-3 text-xs whitespace-nowrap"
                  variant={anyRunning ? "outline" : undefined}
                  onClick={anyRunning ? handleStopRunning : handleRunAll}
                  disabled={!anyRunning && !target.trim()}
                  aria-label="Run all reachability checks"
                >
                  {anyRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {anyRunning ? "Stop All" : "Run All"}
                </Button>
              </span>
            </TooltipWrapper>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <TooltipWrapper title="Ping probes" description="Number of ICMP probes">
                <div className="inline-flex items-center gap-1.5 shrink-0">
                  <span className="text-2xs text-muted-foreground/75">Probes</span>
                  <Input
                    type="number"
                    min={3}
                    max={64}
                    value={pingCount}
                    onChange={(e) => setPingCount(Math.max(3, Math.min(64, parseInt(e.target.value, 10) || 8)))}
                    className="h-7 w-[78px] rounded-md border border-border/35 bg-muted/10 px-2 text-center text-xs shadow-none focus-visible:ring-1 focus-visible:ring-primary/35"
                    title="Ping probes"
                  />
                </div>
              </TooltipWrapper>
              <TooltipWrapper title="MTR rounds" description="Sampling rounds for MTR">
                <div className="inline-flex items-center gap-1.5 shrink-0">
                  <span className="text-2xs text-muted-foreground/75">Rounds</span>
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    value={mtrRounds}
                    onChange={(e) => setMtrRounds(Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 20)))}
                    className="h-7 w-[82px] rounded-md border border-border/35 bg-muted/10 px-2 text-center text-xs shadow-none focus-visible:ring-1 focus-visible:ring-primary/35"
                    title="MTR rounds"
                  />
                </div>
              </TooltipWrapper>
              <Button
                type="button"
                size="sm"
                variant={mtrContinuous ? "default" : "outline"}
                className="h-7 px-2.5 text-2xs"
                disabled={mtrRunning}
                onClick={() => setMtrContinuous((v) => !v)}
              >
                Continuous
              </Button>
            </div>
            <div className="inline-flex h-8 items-center text-2xs text-muted-foreground whitespace-nowrap">
              <span className={cn("mr-1.5", stateToneClass(pingState))}>Ping {stateLabel(pingState)}</span>
              <span className="mr-1.5 text-border">/</span>
              <span className={cn("mr-1.5", stateToneClass(traceState))}>Trace {traceStateText}</span>
              <span className="mr-1.5 text-border">/</span>
              <span className={stateToneClass(mtrState)}>MTR {mtrStateText}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="ui-hero-surface shadow-none flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="ui-section-header-sm border-b border-border/35">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                {activePanel === "ping" ? "Ping Results" : activePanel === "trace" ? "Traceroute Results" : "MTR Results"}
              </span>
              {activePanel === "ping" && pingSource && <ResultSourceBadge source={pingSource.source} agentName={pingAgent} />}
              {activePanel === "trace" && traceSource && <ResultSourceBadge source={traceSource.source} agentName={traceAgent} />}
              {activePanel === "mtr" && mtrSource && <ResultSourceBadge source={mtrSource.source} agentName={mtrAgent} />}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto p-3">
            {activePanel === "ping" && (
              pingSummary ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <MetricMini label="Avg RTT" value={`${pingSummary.avg.toFixed(1)} ms`} />
                    <MetricMini label="Loss" value={`${pingSummary.loss.toFixed(1)}%`} tone={pingSummary.loss < 1 ? "success" : pingSummary.loss < 5 ? "warning" : "danger"} />
                    <MetricMini label="Min" value={`${pingSummary.min.toFixed(1)} ms`} />
                    <MetricMini label="Max" value={`${pingSummary.max.toFixed(1)} ms`} />
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border/35">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30">
                        <tr className="border-b border-border/35">
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Seq</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">RTT</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Success</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ping.result?.probes.map((probe) => (
                          <tr key={probe.seq} className="border-b border-border/20 last:border-b-0 hover:bg-muted/15">
                            <td className="px-2 py-1.5 font-mono text-muted-foreground">{probe.seq}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{probe.rtt_ms != null ? `${probe.rtt_ms.toFixed(1)} ms` : "--"}</td>
                            <td className={cn("px-2 py-1.5 text-right font-medium", probe.success ? "text-success" : "text-destructive")}>
                              {probe.success ? "OK" : "Fail"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : ping.error ? (
                <p className="text-xs text-destructive">{ping.error}</p>
              ) : (
                <EmptyState variant="inline" title="No ping data" className="h-full min-h-0 p-6" />
              )
            )}

            {activePanel === "trace" && (
              traceSummary ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <MetricMini label="Hops" value={String(traceSummary.hops)} />
                    <MetricMini label="Total RTT" value={`${traceSummary.totalRtt.toFixed(1)} ms`} />
                    <MetricMini label="Destination" value={traceSummary.reached ? "Reached" : "Unreached"} tone={traceSummary.reached ? "success" : "warning"} />
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border/35">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30">
                        <tr className="border-b border-border/35">
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Hop</th>
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Host</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Avg RTT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traceDisplayHops.map((hop) => (
                          <tr key={`${hop.hop}-${hop.ip ?? "unknown"}`} className="border-b border-border/20 last:border-b-0 hover:bg-muted/15">
                            <td className="px-2 py-1.5 font-mono text-muted-foreground">{hop.hop}</td>
                            <td className="px-2 py-1.5">
                              <div className="min-w-0">
                                <p className="truncate">{hop.hostname || hop.ip || "*"}</p>
                                {hop.hostname && hop.ip && <p className="truncate text-2xs text-muted-foreground">{hop.ip}</p>}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">{hop.avg_rtt_ms != null ? `${hop.avg_rtt_ms.toFixed(1)} ms` : "--"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : traceroute.error ? (
                <p className="text-xs text-destructive">{traceroute.error}</p>
              ) : (
                <EmptyState variant="inline" title="No traceroute data" className="h-full min-h-0 p-6" />
              )
            )}

            {activePanel === "mtr" && (
              mtrSummary ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                    <MetricMini label="Hops" value={String(mtrSummary.hops)} />
                    <MetricMini label="Rounds" value={String(mtrSummary.rounds)} />
                    <MetricMini label="Destination" value={mtrSummary.reached ? "Reached" : "Unreached"} tone={mtrSummary.reached ? "success" : "warning"} />
                    <MetricMini label="Avg loss" value={`${mtrSummary.avgLoss.toFixed(1)}%`} tone={mtrSummary.avgLoss < 1 ? "success" : mtrSummary.avgLoss < 5 ? "warning" : "danger"} />
                    <MetricMini label="Avg latency" value={`${mtrSummary.avgLatency.toFixed(1)} ms`} />
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border/35">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30">
                        <tr className="border-b border-border/35">
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Hop</th>
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Host</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Loss%</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Sent</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Last</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Avg</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Best</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Worst</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">StDev</th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Jitter</th>
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Graph</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mtrDisplayHops.map((hop) => (
                          <MtrGridRow
                            key={`${hop.hop}-${hop.ip || "unknown"}`}
                            hop={hop}
                            maxAvgMs={mtrMaxAvg}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : mtrError ? (
                <p className="text-xs text-destructive">{mtrError}</p>
              ) : (
                <EmptyState variant="inline" title="No MTR data" className="h-full min-h-0 p-6" />
              )
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricMini({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="rounded-md bg-muted/12 px-2.5 py-2 min-w-[96px]">
      <p className="text-2xs text-muted-foreground truncate">{label}</p>
      <p className={cn(
        "text-xs font-semibold tabular-nums",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-destructive",
      )}>
        {value}
      </p>
    </div>
  );
}

function getStateTone(running: boolean, hasError: boolean, hasResult: boolean): "idle" | "running" | "ok" | "error" {
  if (running) return "running";
  if (hasError) return "error";
  if (hasResult) return "ok";
  return "idle";
}

function stateLabel(state: "idle" | "running" | "ok" | "error"): string {
  if (state === "running") return "RUN";
  if (state === "ok") return "OK";
  if (state === "error") return "ERR";
  return "IDLE";
}

function stateToneClass(state: "idle" | "running" | "ok" | "error"): string {
  if (state === "running") return "text-primary";
  if (state === "ok") return "text-success";
  if (state === "error") return "text-destructive";
  return "text-muted-foreground";
}

function MtrGridRow({ hop, maxAvgMs }: { hop: MtrHop; maxAvgMs: number }) {
  const hostLabel = hop.hostname || hop.ip || "*";
  const latencyPct = Math.max(0, Math.min(100, (hop.avg_ms / Math.max(1, maxAvgMs)) * 100));
  const lossPct = Math.max(0, Math.min(100, hop.loss_pct));

  return (
    <tr className="border-b border-border/20 last:border-b-0 hover:bg-muted/15">
      <td className="px-2 py-1.5 font-mono text-muted-foreground">{hop.hop}</td>
      <td className="px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate">{hostLabel}</p>
          {hop.hostname && hop.ip && <p className="truncate text-2xs text-muted-foreground">{hop.ip}</p>}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right font-mono">{hop.loss_pct.toFixed(1)}%</td>
      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{hop.sent}</td>
      <td className="px-2 py-1.5 text-right font-mono">{hop.last_ms > 0 ? hop.last_ms.toFixed(1) : "--"}</td>
      <td className="px-2 py-1.5 text-right font-mono">{hop.avg_ms > 0 ? hop.avg_ms.toFixed(1) : "--"}</td>
      <td className="px-2 py-1.5 text-right font-mono">{hop.best_ms > 0 ? hop.best_ms.toFixed(1) : "--"}</td>
      <td className="px-2 py-1.5 text-right font-mono">{hop.worst_ms > 0 ? hop.worst_ms.toFixed(1) : "--"}</td>
      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{hop.stdev_ms > 0 ? hop.stdev_ms.toFixed(1) : "--"}</td>
      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{hop.jitter_ms > 0 ? hop.jitter_ms.toFixed(1) : "--"}</td>
      <td className="px-2 py-1.5">
        <div className="relative h-2 w-24 overflow-hidden rounded-full bg-muted/30">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary/60" style={{ width: `${latencyPct}%` }} />
          <div className="absolute inset-y-0 right-0 rounded-full bg-destructive/55" style={{ width: `${lossPct}%` }} />
        </div>
      </td>
    </tr>
  );
}
