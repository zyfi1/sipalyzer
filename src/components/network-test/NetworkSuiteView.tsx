import { useEffect, useState, useMemo, useCallback } from "react";
import { listen } from "@/lib/tauriEvents";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { CommandBar } from "./components/CommandBar";
import { TestGroup } from "./components/TestGroup";
import { TestTile } from "./components/TestTile";
import { TracerouteTable } from "./components/TracerouteTable";
import { PortTestPanel } from "./components/PortTestPanel";
// MosGauge available if needed: import { MosGauge } from "./components/MosGauge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  Globe, Activity, Network, Shield, Zap, Loader2, RefreshCw,
  Play, Search, ArrowDownToLine, ArrowUpFromLine, GitCompareArrows,
  PhoneCall, BarChart3, Square, Info,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { tooltips } from "@/lib/tooltips";
import { resolveWifiQualityPct, wifiIconFromQualityPct } from "@/lib/wifiSignal";
import type {
  MonitorSample, MonitorStatus, SpeedTestProgressEvent,
} from "@/types/networkTest";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
//  Shared helpers
// ═══════════════════════════════════════════════════════════════════

function MetricBox({ label, value, unit, color, tooltip }: {
  label: string; value: string; unit?: string; color?: "emerald" | "yellow" | "red" | "blue";
  tooltip?: { title: string; description?: string };
}) {
  const colorMap = {
    emerald: { text: "text-success", accent: "from-success/25 via-success/10 to-transparent" },
    yellow: { text: "text-warning", accent: "from-warning/25 via-warning/10 to-transparent" },
    red: { text: "text-destructive", accent: "from-destructive/25 via-destructive/10 to-transparent" },
    blue: { text: "text-primary", accent: "from-primary/25 via-primary/10 to-transparent" },
  };
  const c = color ? colorMap[color] : null;
  return (
    <div className="ui-hero-metric relative px-3.5 py-2.5 overflow-hidden">
      {c && <div className={cn("absolute inset-x-0 top-0 h-px bg-gradient-to-r", c.accent)} />}
      <div className="flex items-center gap-1 section-label-sm">
        <span>{label}</span>
        {tooltip && (
          <TooltipWrapper title={tooltip.title} description={tooltip.description} side="top" showArrow>
            <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0" />
          </TooltipWrapper>
        )}
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={cn("text-lg font-semibold tabular-nums leading-tight", c?.text ?? "text-foreground")}>{value}</span>
        {unit && <span className="text-2xs text-muted-foreground/60">{unit}</span>}
      </div>
    </div>
  );
}

function LoadingPulse() {
  return (
    <div className="space-y-2.5">
      <div className="h-5 w-20 rounded-lg skeleton" />
      <div className="h-3 w-28 rounded-lg skeleton" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Main View
// ═══════════════════════════════════════════════════════════════════

export function NetworkSuiteView() {
  const [target, setTarget] = useState(() => useNetworkTestStore.getState().voipTarget || "8.8.8.8");
  const DEFAULT_EXPANDED = ["ping", "jitter", "packet-loss", "mtu", "dns", "speed", "monitor"] as const;
  const [expanded, setExpanded] = useState<Set<string>>(new Set(DEFAULT_EXPANDED));

  // Store selectors — bulk
  const bulkRunning = useNetworkTestStore((s) => s.bulkRunning);
  const bulkProgress = useNetworkTestStore((s) => s.bulkProgress);
  const runAllTests = useNetworkTestStore((s) => s.runAllTests);
  const runGroup = useNetworkTestStore((s) => s.runGroup);
  const abortBulkTestSuite = useNetworkTestStore((s) => s.abortBulkTestSuite);
  const stopDiagnosticGroup = useNetworkTestStore((s) => s.stopDiagnosticGroup);

  // Status selectors for group running indicators
  const ping = useNetworkTestStore((s) => s.ping);
  const jitterTest = useNetworkTestStore((s) => s.jitterTest);
  const packetLossTest = useNetworkTestStore((s) => s.packetLossTest);
  const mtu = useNetworkTestStore((s) => s.mtu);
  const traceroute = useNetworkTestStore((s) => s.traceroute);
  const dns = useNetworkTestStore((s) => s.dns);
  const speedTest = useNetworkTestStore((s) => s.speedTest);
  const bandwidthTest = useNetworkTestStore((s) => s.bandwidthTest);
  const healthCheck = useNetworkTestStore((s) => s.healthCheck);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  // Set voipTarget when main target changes (so VoIP actions that rely on it work)
  const setVoipTarget = useNetworkTestStore((s) => s.setVoipTarget);
  useEffect(() => { setVoipTarget(target); }, [target, setVoipTarget]);

  const latencyRunning = ping.status === "running" || jitterTest.status === "running" || packetLossTest.status === "running" || mtu.status === "running";
  const routingRunning = traceroute.status === "running" || dns.status === "running";
  const perfRunning = speedTest.status === "running" || bandwidthTest.status === "running";
  const envRunning = healthCheck.status === "running";

  const categories = [
    { id: "environment", label: "Environment", running: envRunning, onRun: () => runGroup("environment", target) },
    { id: "latency", label: "Latency & Quality", running: latencyRunning, onRun: () => runGroup("latency", target) },
    { id: "routing", label: "Routing & DNS", running: routingRunning, onRun: () => runGroup("routing", target) },
    { id: "performance", label: "Performance", running: perfRunning, onRun: () => runGroup("performance", target) },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-4 pb-10">
        <CommandBar
          target={target}
          onTargetChange={setTarget}
          onRunAll={() => runAllTests(target)}
          onStopBulk={abortBulkTestSuite}
          bulkRunning={bulkRunning}
          bulkProgress={bulkProgress}
          categories={categories}
        />

        {/* ── Environment Strip ─────────────────────────────── */}
        <EnvironmentStrip />

        {/* ── Performance — single merged speed/throughput card ── */}
        <TestGroup
          title="Performance"
          icon={Zap}
          onRunAll={() => runGroup("performance", target)}
          onStopAll={() => stopDiagnosticGroup("performance")}
          running={perfRunning}
        >
          <SpeedThroughputTile target={target} expanded={isExpanded("speed")} onToggle={() => toggle("speed")} />
        </TestGroup>

        {/* ── Latency & Quality (2x2) + Routing & DNS & Port Analysis (side by side) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TestGroup
            title="Latency & Quality"
            icon={Activity}
            onRunAll={() => runGroup("latency", target)}
            onStopAll={() => stopDiagnosticGroup("latency")}
            running={latencyRunning}
            gridCols="2"
          >
            <PingTile target={target} expanded={isExpanded("ping")} onToggle={() => toggle("ping")} />
            <JitterTile target={target} expanded={isExpanded("jitter")} onToggle={() => toggle("jitter")} />
            <PacketLossTile target={target} expanded={isExpanded("packet-loss")} onToggle={() => toggle("packet-loss")} />
            <MtuTile target={target} expanded={isExpanded("mtu")} onToggle={() => toggle("mtu")} />
          </TestGroup>

          <div className="space-y-4">
            <TestGroup
              title="Routing & DNS"
              icon={Network}
              onRunAll={() => runGroup("routing", target)}
              onStopAll={() => stopDiagnosticGroup("routing")}
              running={routingRunning}
              gridCols="2"
            >
              <TracerouteTile target={target} expanded={isExpanded("traceroute")} onToggle={() => toggle("traceroute")} />
              <DnsTile target={target} expanded={isExpanded("dns")} onToggle={() => toggle("dns")} />
              <RouteComparisonTile expanded={isExpanded("route-compare")} onToggle={() => toggle("route-compare")} fullWidth />
            </TestGroup>
            <TestGroup title="Port Analysis" icon={Shield}>
              <PortScanTile expanded={isExpanded("port-scan")} onToggle={() => toggle("port-scan")} />
            </TestGroup>
          </div>
        </div>

        {/* ── Monitoring ───────────────────────────────────── */}
        <TestGroup title="Monitoring" icon={BarChart3}>
          <MonitorTile target={target} expanded={isExpanded("monitor")} onToggle={() => toggle("monitor")} />
        </TestGroup>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Environment Strip — auto-runs, compact 4-column status
// ═══════════════════════════════════════════════════════════════════

function EnvironmentStrip() {
  const healthCheck = useNetworkTestStore((s) => s.healthCheck);
  const runHealthCheck = useNetworkTestStore((s) => s.runHealthCheck);
  const wifi = useNetworkTestStore((s) => s.wifi);
  const fetchWifi = useNetworkTestStore((s) => s.fetchWifi);
  const netInfo = useNetworkTestStore((s) => s.netInfo);
  const fetchNetInfo = useNetworkTestStore((s) => s.fetchNetInfo);
  const stun = useNetworkTestStore((s) => s.stun);
  const runStun = useNetworkTestStore((s) => s.runStun);

  useEffect(() => {
    if (healthCheck.status === "idle") runHealthCheck();
    if (wifi.status === "idle") fetchWifi();
    if (netInfo.status === "idle") fetchNetInfo();
    if (stun.status === "idle") runStun();
  }, []);

  const internetOk = healthCheck.result?.internet_reachable;
  const avgLat = healthCheck.result?.avg_latency_ms;
  const pktLoss = healthCheck.result?.packet_loss_pct;

  const rawSsid = wifi.result?.ssid;
  const wifiSsid = rawSsid && !/restricted|unavailable/i.test(rawSsid) ? rawSsid : null;
  const wifiSignal = wifi.result?.rssi_dbm;
  const wifiQuality = wifi.result?.signal_quality_pct;
  const wifiQualityPct = resolveWifiQualityPct(wifiQuality, wifiSignal);
  const wifiChannel = wifi.result?.channel;
  const wifiRate = wifi.result?.tx_rate_mbps;
  const WifiQualityIcon = wifiIconFromQualityPct(wifiQualityPct);

  const localIp = netInfo.result?.local_ip;
  const defaultIface = netInfo.result?.interfaces?.find((i) => i.is_default);
  const gatewayIp = netInfo.result?.default_gateway;
  const vpnIface = defaultIface?.interface_type === "VPN/Tunnel" ? defaultIface
    : netInfo.result?.interfaces?.find((i) => i.interface_type === "VPN/Tunnel" && i.ipv4.length > 0 && i.gateway != null) ?? null;

  const publicIp = stun.result?.public_ip;
  const natType = stun.result?.nat_type;

  const anyLoading = healthCheck.status === "running" || wifi.status === "running"
    || netInfo.status === "running" || stun.status === "running";

  type S = "idle" | "loading" | "ok" | "warn" | "error";
  const dot = (s: S) => s === "ok" ? "bg-success" : s === "warn" ? "bg-warning"
    : s === "error" ? "bg-destructive" : s === "loading" ? "bg-muted-foreground animate-live-breathe motion-reduce:animate-none" : "bg-muted-foreground/30";

  const internetS: S = healthCheck.status === "running" ? "loading" : internetOk ? "ok" : healthCheck.result ? "error" : "idle";
  const wifiS: S = wifi.status === "running" ? "loading" : (wifiSignal != null || wifiQualityPct != null) ? "ok" : wifi.result ? "warn" : "idle";
  const localS: S = (healthCheck.status === "running" || netInfo.status === "running") ? "loading"
    : vpnIface ? "ok" : healthCheck.result?.gateway_reachable ? "ok" : healthCheck.result?.gateway_reachable === false ? "error" : "idle";
  const publicS: S = stun.status === "running" ? "loading" : publicIp ? "ok" : stun.result ? "warn" : "idle";

  return (
    <section className="ui-hero-surface p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="surface-subtle h-7 w-7 rounded-lg flex items-center justify-center shrink-0">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <h2 className="section-label flex-1 truncate">Environment</h2>
        <TooltipWrapper title="Refresh environment">
          <button
            onClick={() => { runHealthCheck(); fetchWifi(); fetchNetInfo(); runStun(); }}
            className="text-muted-foreground/60 hover:text-foreground transition-smooth p-1.5 rounded-lg hover:bg-muted/20"
            disabled={anyLoading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", anyLoading && "animate-spin motion-reduce:animate-none")} />
          </button>
        </TooltipWrapper>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-4 gap-3">
        {/* Internet */}
        <div className="ui-hero-metric relative p-4">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-success/30 to-transparent" />
          <div className="flex items-center gap-2 mb-2.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground/60" />
            <TooltipWrapper entry={tooltips.netEnvInternet}>
              <span className="section-label-sm cursor-help">Internet</span>
            </TooltipWrapper>
            <span className={cn("h-1.5 w-1.5 rounded-full ml-auto", dot(internetS))} />
          </div>
          {internetS === "loading" ? <LoadingPulse /> : (
            <>
              <p className={cn("text-lg font-semibold leading-tight", internetOk ? "text-success" : healthCheck.result ? "text-destructive" : "text-muted-foreground/60")}>
                {internetOk ? "Connected" : healthCheck.result ? "Offline" : "--"}
              </p>
              {avgLat != null && <p className="text-xs text-muted-foreground/60 mt-1.5 tabular-nums">{avgLat.toFixed(1)} ms avg</p>}
              {pktLoss != null && pktLoss > 0 && <p className="text-xs text-warning/80 mt-0.5 tabular-nums">{pktLoss.toFixed(1)}% loss</p>}
            </>
          )}
        </div>

        {/* Wi-Fi */}
        <div className="ui-hero-metric relative p-4">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          <div className="flex items-center gap-2 mb-2.5">
            <WifiQualityIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
            <TooltipWrapper entry={tooltips.netEnvWifi}>
              <span className="section-label-sm cursor-help">Wi-Fi</span>
            </TooltipWrapper>
            <span className={cn("h-1.5 w-1.5 rounded-full ml-auto", dot(wifiS))} />
          </div>
          {wifiS === "loading" ? <LoadingPulse /> : (
            <>
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold truncate leading-tight">{wifiSsid ?? (wifiSignal != null ? "Connected" : "--")}</p>
                {(wifiSignal != null || wifiQualityPct != null) && (
                  <WifiQualityIcon className="h-3.5 w-3.5 text-foreground/70 shrink-0" />
                )}
              </div>
              {wifiSignal != null && <p className="text-xs text-muted-foreground/60 mt-1.5 tabular-nums">{wifiSignal} dBm{wifiQualityPct != null && ` · ${wifiQualityPct}%`}</p>}
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-2xs text-muted-foreground/60">
                {wifiChannel != null && <span>Ch {wifiChannel}</span>}
                {wifiRate != null && <span>{wifiRate} Mbps</span>}
              </div>
            </>
          )}
        </div>

        {/* Local */}
        <div className="ui-hero-metric relative p-4">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          <div className="flex items-center gap-2 mb-2.5">
            <Network className="h-3.5 w-3.5 text-muted-foreground/60" />
            <TooltipWrapper entry={tooltips.netEnvLocal}>
              <span className="section-label-sm cursor-help">{vpnIface ? "VPN" : "Local"}</span>
            </TooltipWrapper>
            {vpnIface && <span className="text-3xs font-semibold text-success bg-success/10 rounded-lg px-1.5 py-0.5">VPN</span>}
            <span className={cn("h-1.5 w-1.5 rounded-full ml-auto", dot(localS))} />
          </div>
          {localS === "loading" ? <LoadingPulse /> : (
            <>
              <p className="text-lg font-semibold font-mono truncate leading-tight">{vpnIface ? (vpnIface.ipv4[0] ?? "--") : localIp ?? "--"}</p>
              <p className="text-xs text-muted-foreground/60 mt-1.5 truncate">
                {vpnIface ? (vpnIface.friendly_name ?? vpnIface.name ?? "VPN Tunnel")
                  : [defaultIface?.interface_type, gatewayIp ? `gw ${gatewayIp}` : null].filter(Boolean).join(" · ") || "--"}
              </p>
            </>
          )}
        </div>

        {/* Public IP */}
        <div className="ui-hero-metric relative p-4">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-warning/30 to-transparent" />
          <div className="flex items-center gap-2 mb-2.5">
            <Shield className="h-3.5 w-3.5 text-muted-foreground/60" />
            <TooltipWrapper entry={tooltips.netEnvPublic}>
              <span className="section-label-sm cursor-help">Public IP</span>
            </TooltipWrapper>
            <span className={cn("h-1.5 w-1.5 rounded-full ml-auto", dot(publicS))} />
          </div>
          {publicS === "loading" ? <LoadingPulse /> : (
            <>
              <p className="text-lg font-semibold font-mono truncate leading-tight">{publicIp ?? "--"}</p>
              {natType && <p className="text-xs text-muted-foreground/60 mt-1.5">{natType}</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Latency & Quality Tiles
// ═══════════════════════════════════════════════════════════════════

function PingTile({ target, expanded, onToggle }: { target: string; expanded: boolean; onToggle: () => void }) {
  const ping = useNetworkTestStore((s) => s.ping);
  const runPing = useNetworkTestStore((s) => s.runPing);
  const requestStopPing = useNetworkTestStore((s) => s.requestStopPing);
  const [count, setCount] = useState("10");
  const r = ping.result;

  return (
    <TestTile
      icon={Activity} tint="text-success" title="Ping"
      subtitle="ICMP latency & loss"
      status={ping.status} onRun={() => runPing(target, parseInt(count) || 10)}
      onStop={() => void requestStopPing()}
      summary={r ? `${r.avg_ms.toFixed(1)} ms` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      {/* Config */}
      <div className="flex items-center gap-2">
        <span className="text-2xs text-muted-foreground shrink-0">Count</span>
        <Input value={count} onChange={(e) => setCount(e.target.value)} className="h-7 w-16 text-xs text-center" type="number" />
      </div>
      {/* Results */}
      {r && (
        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-1.5">
            <MetricBox label="Avg" value={r.avg_ms.toFixed(1)} unit="ms" color={r.avg_ms < 50 ? "emerald" : r.avg_ms < 150 ? "yellow" : "red"} />
            <MetricBox label="Min" value={r.min_ms.toFixed(1)} unit="ms" />
            <MetricBox label="Max" value={r.max_ms.toFixed(1)} unit="ms" />
            <MetricBox label="Loss" value={r.packet_loss_pct.toFixed(1)} unit="%" color={r.packet_loss_pct < 1 ? "emerald" : r.packet_loss_pct < 5 ? "yellow" : "red"} />
            <MetricBox label="StdDev" value={`±${r.stddev_ms.toFixed(1)}`} unit="ms" />
          </div>
          {r.probes.length > 1 && (
            <div className="min-h-[180px] ui-hero-surface p-3">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={r.probes.map((p) => ({ seq: p.seq, rtt: p.rtt_ms }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.15)" />
                  <XAxis dataKey="seq" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }} width={40} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }} width={36} tickFormatter={(v) => `${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "none", borderRadius: "8px", fontSize: "12px", boxShadow: "var(--shadow-card)" }}
                    formatter={(val: unknown) => [`${typeof val === "number" ? val.toFixed(1) : "--"} ms`, "RTT"]}
                  />
                  <Line type="monotone" dataKey="rtt" stroke="#34d399" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-sm text-muted-foreground font-mono">{r.resolved_ip}</p>
        </div>
      )}
    </TestTile>
  );
}

function JitterTile({ target, expanded, onToggle }: { target: string; expanded: boolean; onToggle: () => void }) {
  const jitterTest = useNetworkTestStore((s) => s.jitterTest);
  const runJitterTest = useNetworkTestStore((s) => s.runJitterTest);
  const dismissJitterTest = useNetworkTestStore((s) => s.dismissJitterTest);
  const [port, setPort] = useState("");
  const [count, setCount] = useState("50");
  const [interval, setInterval_] = useState("20");
  const r = jitterTest.result;

  return (
    <TestTile
      icon={Activity} tint="text-primary" title="Jitter"
      subtitle="UDP jitter measurement"
      status={jitterTest.status} onRun={() => runJitterTest(target, port ? parseInt(port) : undefined, parseInt(count) || 50, parseInt(interval) || 20)}
      onStop={dismissJitterTest}
      summary={r ? `${r.avg_jitter_ms.toFixed(1)} ms` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-2xs text-muted-foreground shrink-0">Port</span>
        <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="auto" className="h-7 w-16 text-xs text-center" type="number" />
        <span className="text-2xs text-muted-foreground shrink-0">Count</span>
        <Input value={count} onChange={(e) => setCount(e.target.value)} className="h-7 w-14 text-xs text-center" type="number" />
        <span className="text-2xs text-muted-foreground shrink-0">Interval</span>
        <Input value={interval} onChange={(e) => setInterval_(e.target.value)} className="h-7 w-14 text-xs text-center" type="number" />
        <span className="text-2xs text-muted-foreground">ms</span>
      </div>
      {r && (
        <div className="grid grid-cols-4 gap-1.5">
          <MetricBox label="Avg" value={r.avg_jitter_ms.toFixed(1)} unit="ms" color={r.avg_jitter_ms < 10 ? "emerald" : r.avg_jitter_ms < 30 ? "yellow" : "red"} />
          <MetricBox label="Max" value={r.max_jitter_ms.toFixed(1)} unit="ms" />
          <MetricBox label="Min" value={r.min_jitter_ms.toFixed(1)} unit="ms" />
          <MetricBox label="Loss" value={r.packet_loss_pct.toFixed(1)} unit="%" color={r.packet_loss_pct < 1 ? "emerald" : "red"} />
        </div>
      )}
      {jitterTest.error && <p className="text-xs text-destructive">{jitterTest.error}</p>}
    </TestTile>
  );
}

function PacketLossTile({ target, expanded, onToggle }: { target: string; expanded: boolean; onToggle: () => void }) {
  const packetLossTest = useNetworkTestStore((s) => s.packetLossTest);
  const runPacketLossTest = useNetworkTestStore((s) => s.runPacketLossTest);
  const dismissPacketLossTest = useNetworkTestStore((s) => s.dismissPacketLossTest);
  const [port, setPort] = useState("");
  const [burst, setBurst] = useState("100");
  const r = packetLossTest.result;

  return (
    <TestTile
      icon={Activity} tint="text-warning" title="Packet Loss"
      subtitle="UDP burst loss measurement"
      status={packetLossTest.status} onRun={() => runPacketLossTest(target, port ? parseInt(port) : undefined, parseInt(burst) || 100)}
      onStop={dismissPacketLossTest}
      summary={r ? `${r.loss_pct.toFixed(1)}%` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xs text-muted-foreground shrink-0">Port</span>
        <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="auto" className="h-7 w-16 text-xs text-center" type="number" />
        <span className="text-2xs text-muted-foreground shrink-0">Burst</span>
        <Input value={burst} onChange={(e) => setBurst(e.target.value)} className="h-7 w-16 text-xs text-center" type="number" />
      </div>
      {r && (
        <div className="grid grid-cols-3 gap-1.5">
          <MetricBox label="Sent" value={String(r.packets_sent)} />
          <MetricBox label="Received" value={String(r.packets_received)} />
          <MetricBox label="Loss" value={r.loss_pct.toFixed(1)} unit="%" color={r.loss_pct < 1 ? "emerald" : r.loss_pct < 3 ? "yellow" : "red"} />
        </div>
      )}
      {packetLossTest.error && <p className="text-xs text-destructive">{packetLossTest.error}</p>}
    </TestTile>
  );
}

function MtuTile({ target, expanded, onToggle }: { target: string; expanded: boolean; onToggle: () => void }) {
  const mtu = useNetworkTestStore((s) => s.mtu);
  const runMtu = useNetworkTestStore((s) => s.runMtu);
  const dismissMtu = useNetworkTestStore((s) => s.dismissMtu);
  const r = mtu.result;

  return (
    <TestTile
      icon={Zap} tint="text-warning" title="MTU Discovery"
      subtitle="Path maximum transmission unit"
      status={mtu.status} onRun={() => runMtu(target)}
      onStop={dismissMtu}
      summary={r ? `${r.path_mtu} bytes` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      {r && (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{r.path_mtu}</span>
            <span className="text-xs text-muted-foreground">bytes</span>
            <span className={cn("text-xs font-medium ml-auto",
              r.path_mtu >= 1400 ? "text-success" : r.path_mtu >= 576 ? "text-warning" : "text-destructive"
            )}>
              {r.path_mtu >= 1400 ? "Standard" : r.path_mtu >= 576 ? "Reduced" : "Very Low"}
            </span>
          </div>
          <div className="relative h-1.5 rounded-full overflow-hidden bg-muted/10">
            <div className={cn("h-full rounded-full transition-smooth",
              r.path_mtu >= 1400 ? "bg-gradient-to-r from-success to-success" : r.path_mtu >= 576 ? "bg-gradient-to-r from-warning to-warning" : "bg-gradient-to-r from-destructive to-destructive"
            )} style={{ width: `${Math.min(100, (r.path_mtu / 1500) * 100)}%` }} />
          </div>
          <div className="flex justify-between text-3xs text-muted-foreground/60 tabular-nums">
            <span>0</span><span>576</span><span>1400</span><span>1500</span>
          </div>
        </div>
      )}
      {mtu.error && <p className="text-xs text-destructive">{mtu.error}</p>}
    </TestTile>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Routing & DNS Tiles
// ═══════════════════════════════════════════════════════════════════

function TracerouteTile({ target, expanded, onToggle }: { target: string; expanded: boolean; onToggle: () => void }) {
  const traceroute = useNetworkTestStore((s) => s.traceroute);
  const runTraceroute = useNetworkTestStore((s) => s.runTraceroute);
  const requestStopTraceroute = useNetworkTestStore((s) => s.requestStopTraceroute);
  const r = traceroute.result;

  return (
    <TestTile
      icon={Network} tint="text-primary" title="Traceroute"
      subtitle="Network path hop-by-hop"
      status={traceroute.status} onRun={() => runTraceroute(target)}
      onStop={() => void requestStopTraceroute()}
      summary={r ? `${r.hops.length} hops` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      {r && r.hops.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-2xs text-muted-foreground">
              {r.hops.length} hops to <span className="font-mono">{r.resolved_ip}</span>
            </p>
            {r.reached_destination && (
              <Badge variant="secondary" className="text-2xs bg-success/10 text-success border-success/30">Reached</Badge>
            )}
          </div>
          <TracerouteTable hops={r.hops} />
        </div>
      )}
      {traceroute.error && <p className="text-xs text-destructive">{traceroute.error}</p>}
    </TestTile>
  );
}

function DnsTile({ target, expanded, onToggle }: { target: string; expanded: boolean; onToggle: () => void }) {
  const dns = useNetworkTestStore((s) => s.dns);
  const runDns = useNetworkTestStore((s) => s.runDns);
  const dismissNetworkDns = useNetworkTestStore((s) => s.dismissNetworkDns);
  const r = dns.result;

  return (
    <TestTile
      icon={Search} tint="text-info" title="DNS Lookup"
      subtitle="A, AAAA, SRV & NAPTR records"
      status={dns.status} onRun={() => runDns(target)}
      onStop={dismissNetworkDns}
      summary={r ? `${r.a_records.length + r.srv_records.length} records` : undefined}
      expanded={expanded} onToggle={onToggle}
    >
      {r && (
        <div className="space-y-2.5">
          {(r.a_records.length > 0 || r.aaaa_records.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {r.a_records.map((ip, i) => (
                <span key={`a-${i}`} className="inline-flex items-center gap-1.5 text-xs font-mono bg-muted/10 rounded-lg px-2 py-0.5">
                  <span className="text-3xs text-muted-foreground/60 font-sans uppercase">A</span> <span className="text-foreground/80">{ip}</span>
                </span>
              ))}
              {r.aaaa_records.map((ip, i) => (
                <span key={`aaaa-${i}`} className="inline-flex items-center gap-1.5 text-xs font-mono bg-muted/10 rounded-lg px-2 py-0.5">
                  <span className="text-3xs text-muted-foreground/60 font-sans uppercase">AAAA</span> <span className="text-foreground/80">{ip}</span>
                </span>
              ))}
            </div>
          )}
          {r.srv_records.length > 0 && (
            <div className="ui-hero-surface overflow-hidden">
              <div className="divide-y divide-border/20">
                {r.srv_records.map((s, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs font-mono hover:bg-muted/10 transition-smooth">
                    <span className="text-muted-foreground/60">{s.service}</span> <span className="text-muted-foreground/60">→</span> <span className="text-foreground/80">{s.target}:{s.port}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {r.naptr_records.length > 0 && (
            <div className="ui-hero-surface overflow-hidden">
              <div className="divide-y divide-border/20">
                {r.naptr_records.map((n, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs font-mono truncate hover:bg-muted/10 transition-smooth">
                    <span className="text-muted-foreground/60">{n.service}</span> <span className="text-muted-foreground/60">→</span> <span className="text-foreground/80">{n.replacement}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-2xs text-muted-foreground/60 tabular-nums">Resolved in {r.resolution_ms.toFixed(0)} ms</p>
        </div>
      )}
      {dns.error && <p className="text-xs text-destructive">{dns.error}</p>}
    </TestTile>
  );
}

function RouteComparisonTile({ expanded, onToggle, fullWidth }: { expanded: boolean; onToggle: () => void; fullWidth?: boolean }) {
  const routeTargetA = useNetworkTestStore((s) => s.routeTargetA);
  const routeTargetB = useNetworkTestStore((s) => s.routeTargetB);
  const setRouteTargetA = useNetworkTestStore((s) => s.setRouteTargetA);
  const setRouteTargetB = useNetworkTestStore((s) => s.setRouteTargetB);
  const routeResultA = useNetworkTestStore((s) => s.routeResultA);
  const routeResultB = useNetworkTestStore((s) => s.routeResultB);
  const routeComparing = useNetworkTestStore((s) => s.routeComparing);
  const runRouteComparison = useNetworkTestStore((s) => s.runRouteComparison);
  const stopRouteComparison = useNetworkTestStore((s) => s.stopRouteComparison);

  const [targetA, setA] = useState(routeTargetA || "8.8.8.8");
  const [targetB, setB] = useState(routeTargetB || "1.1.1.1");

  const handleRun = () => {
    setRouteTargetA(targetA);
    setRouteTargetB(targetB);
    useNetworkTestStore.setState({ routeTargetA: targetA, routeTargetB: targetB });
    runRouteComparison();
  };

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
      if (rA.hops[i]!.ip && rB.hops[i]!.ip && rA.hops[i]!.ip !== rB.hops[i]!.ip) { divergenceHop = i + 1; break; }
    }
    const lastA = rA.hops.filter((h) => h.avg_rtt_ms != null).pop();
    const lastB = rB.hops.filter((h) => h.avg_rtt_ms != null).pop();
    const latencyDelta = lastA && lastB ? (lastA.avg_rtt_ms! - lastB.avg_rtt_ms!) : null;
    return { maxHops, divergenceHop, commonIps, latencyDelta };
  }, [rA, rB]);

  const status = routeComparing ? "running" as const : rA && rB ? "done" as const : "idle" as const;

  return (
    <TestTile
      icon={GitCompareArrows} tint="text-primary" title="Route Comparison"
      subtitle="Compare paths to two targets"
      status={status} onRun={handleRun}
      onStop={routeComparing ? stopRouteComparison : undefined}
      summary={rA && rB && analysis?.divergenceHop ? `diverge hop ${analysis.divergenceHop}` : undefined}
      expanded={expanded} onToggle={onToggle} fullWidth={fullWidth}
    >
      <div className="flex items-center gap-2">
        <Input value={targetA} onChange={(e) => setA(e.target.value)} placeholder="Target A" className="h-7 text-xs flex-1" disabled={routeComparing} />
        <span className="text-xs text-muted-foreground shrink-0">vs</span>
        <Input value={targetB} onChange={(e) => setB(e.target.value)} placeholder="Target B" className="h-7 text-xs flex-1" disabled={routeComparing} />
      </div>
      {rA && rB && analysis && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {analysis.divergenceHop != null && (
              <Badge variant="secondary" className="text-2xs bg-primary/10 text-primary border-primary/30">Diverge at hop {analysis.divergenceHop}</Badge>
            )}
            {analysis.commonIps.size > 0 && (
              <Badge variant="secondary" className="text-2xs bg-success/10 text-success border-success/30">{analysis.commonIps.size} shared</Badge>
            )}
            {analysis.latencyDelta != null && (
              <Badge variant="secondary" className="text-2xs">{Math.abs(analysis.latencyDelta).toFixed(1)} ms delta</Badge>
            )}
          </div>
          <div className="ui-hero-surface overflow-hidden">
            <div className="grid grid-cols-[36px_1fr_56px_56px_1fr] text-3xs font-medium text-muted-foreground/60 uppercase tracking-wider bg-muted/10 px-2 py-1.5">
              <span className="text-center">Hop</span>
              <span className="truncate font-mono">{targetA}</span>
              <span className="text-right">RTT A</span>
              <span className="text-right">RTT B</span>
              <span className="text-right truncate font-mono">{targetB}</span>
            </div>
            <div className="divide-y divide-border/20 max-h-48 overflow-y-auto">
              {Array.from({ length: analysis.maxHops }, (_, i) => {
                const hopA = rA.hops[i]; const hopB = rB.hops[i];
                const isCommon = hopA?.ip != null && hopB?.ip != null && hopA.ip === hopB.ip;
                return (
                  <div key={i} className={cn("grid grid-cols-[36px_1fr_56px_56px_1fr] text-2xs px-2 py-1.5 hover:bg-muted/10 transition-smooth", isCommon && "bg-success/[0.02]")}>
                    <span className="text-center text-muted-foreground/60 tabular-nums">{i + 1}</span>
                    <span className="font-mono truncate text-foreground/70">{hopA?.hostname ?? hopA?.ip ?? "*"}</span>
                    <span className="text-right tabular-nums text-muted-foreground/60">{hopA?.avg_rtt_ms != null ? `${hopA.avg_rtt_ms.toFixed(1)}` : "--"}</span>
                    <span className="text-right tabular-nums text-muted-foreground/60">{hopB?.avg_rtt_ms != null ? `${hopB.avg_rtt_ms.toFixed(1)}` : "--"}</span>
                    <span className="font-mono truncate text-right text-foreground/70">{hopB?.hostname ?? hopB?.ip ?? "*"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {(routeResultA.error || routeResultB.error) && <p className="text-xs text-destructive">{routeResultA.error || routeResultB.error}</p>}
    </TestTile>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Port Analysis Tile
// ═══════════════════════════════════════════════════════════════════

function PortScanTile({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const portScan = useNetworkTestStore((s) => s.portScan);
  const r = portScan.result;
  const passCount = r ? r.results.filter((p) => p.status === "open" || p.status === "open_filtered").length : 0;

  return (
    <TestTile
      icon={Shield} tint="text-destructive" title="Port Scan"
      subtitle="TCP/UDP connectivity tester"
      status={portScan.status} onRun={() => {/* handled internally by PortTestPanel */}}
      summary={r ? `${passCount}/${r.results.length} pass` : undefined}
      expanded={expanded} onToggle={onToggle} fullWidth
    >
      <PortTestPanel borderless />
    </TestTile>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Performance Tiles
// ═══════════════════════════════════════════════════════════════════

function SpeedThroughputTile({ target, expanded, onToggle }: { target: string; expanded: boolean; onToggle: () => void }) {
  // Internet speed (Cloudflare HTTP)
  const speedTest = useNetworkTestStore((s) => s.speedTest);
  const progress = useNetworkTestStore((s) => s.speedTestProgress);
  const setProgress = useNetworkTestStore((s) => s.setSpeedTestProgress);
  const runSpeedTest = useNetworkTestStore((s) => s.runSpeedTest);
  const dismissSpeedTest = useNetworkTestStore((s) => s.dismissSpeedTest);
  // Host throughput (UDP)
  const bandwidthTest = useNetworkTestStore((s) => s.bandwidthTest);
  const runBandwidthTest = useNetworkTestStore((s) => s.runBandwidthTest);
  const dismissBandwidthTest = useNetworkTestStore((s) => s.dismissBandwidthTest);
  const [bwPort, setBwPort] = useState("");
  const [bwDuration, setBwDuration] = useState("5");

  const speedRunning = speedTest.status === "running";
  const bwRunning = bandwidthTest.status === "running";
  const anyRunning = speedRunning || bwRunning;
  const sr = speedTest.result;
  const br = bandwidthTest.result;

  useEffect(() => {
    const unsub = listen<SpeedTestProgressEvent>("speed-test-progress", (e) => setProgress(e.payload));
    return () => { unsub.then((fn) => fn()); };
  }, [setProgress]);

  const phaseLabel = progress?.phase === "latency" ? "Measuring latency"
    : progress?.phase === "download" ? "Downloading" : progress?.phase === "upload" ? "Uploading" : null;

  // Combined status
  const status = anyRunning ? "running" as const : (sr || br) ? "done" as const : "idle" as const;

  // Combined summary for collapsed view
  const summaryParts: string[] = [];
  if (sr) summaryParts.push(`↓${sr.download_mbps.toFixed(0)} ↑${sr.upload_mbps.toFixed(0)} Mbps`);
  if (br) summaryParts.push(`UDP ↓${(br.download_kbps / 1000).toFixed(1)} ↑${(br.upload_kbps / 1000).toFixed(1)}`);
  const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : undefined;

  const handleRunBoth = () => {
    runSpeedTest();
    runBandwidthTest(target, bwPort ? parseInt(bwPort) : undefined, parseInt(bwDuration) || 5);
  };

  const handleStopBoth = () => {
    if (speedRunning) dismissSpeedTest();
    if (bwRunning) dismissBandwidthTest();
  };

  return (
    <TestTile
      icon={Zap} tint="text-warning" title="Speed & Throughput"
      subtitle="Internet speed + host UDP throughput"
      status={status} onRun={handleRunBoth}
      onStop={anyRunning ? handleStopBoth : undefined}
      summary={summary}
      expanded={expanded} onToggle={onToggle} fullWidth
    >
      {/* Action buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="neutral" size="sm"
            className="h-8 gap-2 text-xs px-4"
            onClick={() => runSpeedTest(true)} disabled={speedRunning}
          >
            {speedRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Zap className="h-3.5 w-3.5" />}
            Internet Speed
          </Button>
          <Button
            variant="neutral" size="sm"
            className="h-8 gap-2 text-xs px-4"
            onClick={() => runBandwidthTest(target, bwPort ? parseInt(bwPort) : undefined, parseInt(bwDuration) || 5)}
            disabled={bwRunning}
          >
            {bwRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <BarChart3 className="h-3.5 w-3.5" />}
            Host Throughput
          </Button>
          <Button
            size="sm" className="h-8 gap-2 text-xs px-4"
            onClick={handleRunBoth} disabled={anyRunning}
          >
            <Play className="h-3.5 w-3.5" />
            Run Both
          </Button>
        </div>

        {/* UDP config inline */}
        <div className="ui-hero-metric flex items-center gap-2 ml-auto px-3 py-1.5">
          <span className="text-2xs text-muted-foreground/60 whitespace-nowrap">UDP Port</span>
          <Input value={bwPort} onChange={(e) => setBwPort(e.target.value)} placeholder="auto" className="h-7 w-20 text-xs text-center" type="number" disabled={bwRunning} />
          <AppDivider orientation="vertical" size="md" className="mx-0" />
          <span className="text-2xs text-muted-foreground/60 whitespace-nowrap">Duration</span>
          <Input value={bwDuration} onChange={(e) => setBwDuration(e.target.value)} className="h-7 w-16 text-xs text-center" type="number" disabled={bwRunning} />
          <span className="text-2xs text-muted-foreground/60">sec</span>
        </div>
      </div>

      {/* Speed test progress */}
      {speedRunning && progress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground/60">{phaseLabel}</span>
            <span className="tabular-nums text-muted-foreground/60 text-2xs">{progress.progress_pct.toFixed(0)}%</span>
          </div>
          <div className="h-1 rounded-full bg-muted/10 overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
              progress.phase === "download" ? "bg-gradient-to-r from-success to-success" : progress.phase === "upload" ? "bg-gradient-to-r from-primary to-primary" : "bg-gradient-to-r from-warning to-warning"
            )} style={{ width: `${Math.min(100, progress.progress_pct)}%` }} />
          </div>
          {progress.current_mbps > 0 && (
            <p className="text-center text-xl font-bold tabular-nums leading-tight">{progress.current_mbps.toFixed(1)} <span className="text-2xs font-normal text-muted-foreground/60">Mbps</span></p>
          )}
        </div>
      )}

      {/* Combined results */}
      {(sr || br) && !anyRunning && (
        <div className="space-y-3">
          {/* "Why different?" callout when both results are present */}
          {sr && br && (
            <div className="ui-hero-surface flex items-center gap-2 px-3 py-2">
              <TooltipWrapper title={tooltips.netSpeedVsBandwidth.title} description={tooltips.netSpeedVsBandwidth.description} side="bottom">
                <Info className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0" />
              </TooltipWrapper>
              <span className="text-2xs text-muted-foreground/60">
                Internet Speed and Host Throughput use different protocols and paths —
                <TooltipWrapper title={tooltips.netSpeedVsBandwidth.title} description={tooltips.netSpeedVsBandwidth.description} side="bottom">
                  <span className="text-muted-foreground/60 underline decoration-dotted underline-offset-2 cursor-help ml-0.5">differences are expected</span>
                </TooltipWrapper>
              </span>
            </div>
          )}

          {/* Internet speed results */}
          {sr && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <h4 className="section-label-sm">Internet Speed</h4>
                <TooltipWrapper title={tooltips.netSpeedInternetSection.title} description={tooltips.netSpeedInternetSection.description} side="right">
                  <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0" />
                </TooltipWrapper>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <TooltipWrapper title={tooltips.netSpeedDownload.title} description={tooltips.netSpeedDownload.description} side="bottom">
                  <div className="ui-hero-metric relative bg-success/[0.05] px-3 py-2.5 text-center cursor-help overflow-hidden">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-success/30 to-transparent" />
                    <ArrowDownToLine className="h-3.5 w-3.5 mx-auto mb-1 text-success/70" />
                    <p className="text-2xl font-bold tabular-nums text-success leading-tight">{sr.download_mbps.toFixed(1)}</p>
                    <p className="text-3xs text-success/60 uppercase tracking-wider mt-0.5">Mbps Down</p>
                  </div>
                </TooltipWrapper>
                <TooltipWrapper title={tooltips.netSpeedUpload.title} description={tooltips.netSpeedUpload.description} side="bottom">
                  <div className="ui-hero-metric relative bg-primary/[0.05] px-3 py-2.5 text-center cursor-help overflow-hidden">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                    <ArrowUpFromLine className="h-3.5 w-3.5 mx-auto mb-1 text-primary/70" />
                    <p className="text-2xl font-bold tabular-nums text-primary leading-tight">{sr.upload_mbps.toFixed(1)}</p>
                    <p className="text-3xs text-primary/70 uppercase tracking-wider mt-0.5">Mbps Up</p>
                  </div>
                </TooltipWrapper>
                <MetricBox label="Latency" value={sr.latency_ms.toFixed(0)} unit="ms" tooltip={tooltips.netSpeedLatency} />
                <MetricBox label="Jitter" value={sr.jitter_ms.toFixed(1)} unit="ms" tooltip={tooltips.netSpeedJitter} />
              </div>
            </div>
          )}

          {/* Host UDP throughput results */}
          {br && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <h4 className="section-label-sm">Host UDP Throughput</h4>
                <TooltipWrapper title={tooltips.netBandwidthSection.title} description={tooltips.netBandwidthSection.description} side="right">
                  <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-smooth cursor-help shrink-0" />
                </TooltipWrapper>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <MetricBox label="Download" value={(br.download_kbps / 1000).toFixed(1)} unit="Mbps" color="emerald" tooltip={tooltips.netBandwidthDownload} />
                <MetricBox label="Upload" value={(br.upload_kbps / 1000).toFixed(1)} unit="Mbps" color="blue" tooltip={tooltips.netBandwidthUpload} />
                <MetricBox label="Bytes" value={`${((br.bytes_sent + br.bytes_received) / 1024).toFixed(0)}`} unit="KB" tooltip={tooltips.netBandwidthBytes} />
                <MetricBox label="Duration" value={(br.duration_ms / 1000).toFixed(1)} unit="sec" tooltip={tooltips.netBandwidthDuration} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Errors */}
      {speedTest.error && !speedRunning && <p className="text-xs text-destructive">{speedTest.error}</p>}
      {bandwidthTest.error && !bwRunning && <p className="text-xs text-destructive">{bandwidthTest.error}</p>}
    </TestTile>
  );
}

export function RtpSimTile({ target, expanded, onToggle, fullWidth }: { target: string; expanded: boolean; onToggle: () => void; fullWidth?: boolean }) {
  const rtpSim = useNetworkTestStore((s) => s.rtpSim);
  const runRtpSim = useNetworkTestStore((s) => s.runRtpSim);
  const dismissRtpSim = useNetworkTestStore((s) => s.dismissRtpSim);
  const [port, setPort] = useState("");
  const [codec, setCodec] = useState("g711");
  const [ptime, setPtime] = useState("20");
  const [duration, setDuration] = useState("10");
  const r = rtpSim.result;

  return (
    <TestTile
      icon={PhoneCall} tint="text-info" title="RTP Simulation"
      subtitle="Simulated voice stream test"
      status={rtpSim.status} onRun={() => runRtpSim(target, port ? parseInt(port) : undefined, parseInt(ptime) || 20, parseInt(duration) || 10, codec)}
      onStop={dismissRtpSim}
      summary={r ? `MOS ${r.mos_estimate.toFixed(2)}` : undefined}
      expanded={expanded} onToggle={onToggle} fullWidth={fullWidth}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-2xs text-muted-foreground shrink-0">Port</span>
        <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="auto" className="h-7 w-16 text-xs text-center" type="number" />
        <span className="text-2xs text-muted-foreground shrink-0">Codec</span>
        <select value={codec} onChange={(e) => setCodec(e.target.value)} className="ui-control-shell h-7 text-xs rounded-lg px-2">
          <option value="g711">G.711</option>
          <option value="g729">G.729</option>
        </select>
        <span className="text-2xs text-muted-foreground shrink-0">ptime</span>
        <Input value={ptime} onChange={(e) => setPtime(e.target.value)} className="h-7 w-12 text-xs text-center" type="number" />
        <span className="text-2xs text-muted-foreground shrink-0">Dur</span>
        <Input value={duration} onChange={(e) => setDuration(e.target.value)} className="h-7 w-12 text-xs text-center" type="number" />
        <span className="text-2xs text-muted-foreground">sec</span>
      </div>
      {r && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            <MetricBox label="MOS" value={r.mos_estimate.toFixed(2)} color={r.mos_estimate >= 4.0 ? "emerald" : r.mos_estimate >= 3.6 ? "yellow" : "red"} />
            <MetricBox label="Jitter" value={r.avg_jitter_ms.toFixed(1)} unit="ms" color={r.avg_jitter_ms < 10 ? "emerald" : "yellow"} />
            <MetricBox label="Loss" value={r.packet_loss_pct.toFixed(1)} unit="%" color={r.packet_loss_pct < 1 ? "emerald" : "red"} />
            <MetricBox label="Latency" value={r.avg_latency_ms.toFixed(1)} unit="ms" />
          </div>
          <p className="text-2xs text-muted-foreground">{r.codec} · {r.packets_received}/{r.packets_sent} packets · {(r.duration_ms / 1000).toFixed(1)}s</p>
        </div>
      )}
      {rtpSim.error && <p className="text-xs text-destructive">{rtpSim.error}</p>}
    </TestTile>
  );
}

// VoIP & SIP tiles live in the separate VoIP tab (VoipView.tsx)

// ═══════════════════════════════════════════════════════════════════
//  Monitoring Tile
// ═══════════════════════════════════════════════════════════════════

function MonitorTile({ target, expanded, onToggle }: { target: string; expanded: boolean; onToggle: () => void }) {
  const monitorRunning = useNetworkTestStore((s) => s.monitorRunning);
  const monitorSamples = useNetworkTestStore((s) => s.monitorSamples);
  const monitorTarget = useNetworkTestStore((s) => s.monitorTarget);
  const setMonitorTarget = useNetworkTestStore((s) => s.setMonitorTarget);
  const startMonitor = useNetworkTestStore((s) => s.startMonitor);
  const stopMonitor = useNetworkTestStore((s) => s.stopMonitor);
  const addMonitorSample = useNetworkTestStore((s) => s.addMonitorSample);
  const setMonitorRunning = useNetworkTestStore((s) => s.setMonitorRunning);
  const clearMonitorSamples = useNetworkTestStore((s) => s.clearMonitorSamples);

  const [monTarget, setMonTarget] = useState(monitorTarget || target);
  const [duration, setDuration] = useState("60");
  const [interval, setInterval_] = useState("1000");

  useEffect(() => {
    const unSample = listen<MonitorSample>("network-monitor-sample", (e) => addMonitorSample(e.payload));
    const unStatus = listen<MonitorStatus>("network-monitor-status", (e) => setMonitorRunning(e.payload.running));
    return () => { unSample.then((fn) => fn()); unStatus.then((fn) => fn()); };
  }, [addMonitorSample, setMonitorRunning]);

  const latest = monitorSamples.length > 0 ? monitorSamples[monitorSamples.length - 1] : null;
  const chartData = monitorSamples.slice(-120).map((s) => ({
    time: (s.timestamp_ms / 1000).toFixed(0), latency: s.latency_ms, jitter: s.jitter_ms,
  }));

  return (
    <TestTile
      icon={Activity} tint="text-warning" title="Continuous Monitor"
      subtitle="Real-time latency & jitter over time"
      status={monitorRunning ? "running" : monitorSamples.length > 0 ? "done" : "idle"}
      onRun={() => {
        setMonitorTarget(monTarget); clearMonitorSamples();
        startMonitor(monTarget, parseInt(duration), parseInt(interval));
      }}
      onStop={stopMonitor}
      running={monitorRunning}
      summary={monitorSamples.length > 0 ? `${monitorSamples.length} samples` : undefined}
      expanded={expanded} onToggle={onToggle} fullWidth
    >
      {/* Config */}
      <div className="flex items-center gap-2">
        <Input value={monTarget} onChange={(e) => setMonTarget(e.target.value)} placeholder="8.8.8.8"
          className="h-7 text-xs flex-1 min-w-0" disabled={monitorRunning} />
        <TooltipWrapper title="Duration (seconds)">
          <Input value={duration} onChange={(e) => setDuration(e.target.value)}
            className="h-7 w-14 text-xs text-center" type="number" disabled={monitorRunning} />
        </TooltipWrapper>
        <TooltipWrapper title="Interval (ms)">
          <Input value={interval} onChange={(e) => setInterval_(e.target.value)}
            className="h-7 w-16 text-xs text-center" type="number" disabled={monitorRunning} />
        </TooltipWrapper>
        {monitorRunning && (
          <Button variant="destructive" size="sm" className="h-7 gap-1 px-3 text-xs shrink-0" onClick={stopMonitor}>
            <Square className="h-3 w-3" /> Stop
          </Button>
        )}
      </div>

      {/* Live badge */}
      {monitorRunning && (
        <Badge variant="secondary" className="text-2xs bg-success/10 text-success border-success/30 w-fit">
          <span className="h-1.5 w-1.5 rounded-full bg-success status-online mr-1 inline-block" />Live
        </Badge>
      )}

      {/* Results */}
      {(monitorRunning || monitorSamples.length > 0) && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            <MetricBox label="Latency" value={latest?.latency_ms != null ? latest.latency_ms.toFixed(1) : "--"} unit="ms"
              color={latest ? ((latest.latency_ms ?? 0) < 50 ? "emerald" : "yellow") : undefined} />
            <MetricBox label="Jitter" value={latest?.jitter_ms != null ? latest.jitter_ms.toFixed(1) : "--"} unit="ms"
              color={latest ? ((latest.jitter_ms ?? 0) < 10 ? "emerald" : "yellow") : undefined} />
            <MetricBox label="Loss" value={latest?.packet_loss_pct != null ? latest.packet_loss_pct.toFixed(1) : "--"} unit="%"
              color={latest ? ((latest.packet_loss_pct ?? 0) < 1 ? "emerald" : "red") : undefined} />
            <MetricBox label="Samples" value={String(monitorSamples.length)} />
          </div>

          {chartData.length > 1 && (
            <div className="min-h-[200px] ui-hero-surface p-3">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.15)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }} width={40} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground)/0.5)" }} width={36} tickFormatter={(v) => `${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "none", borderRadius: "8px", fontSize: "12px", boxShadow: "var(--shadow-card)" }}
                  />
                  <Line type="monotone" dataKey="latency" stroke="#34d399" dot={false} strokeWidth={1.5} name="Latency (ms)" />
                  <Line type="monotone" dataKey="jitter" stroke="#facc15" dot={false} strokeWidth={1.5} name="Jitter (ms)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </TestTile>
  );
}
