import { useEffect, useState, useMemo } from "react";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { TracerouteTable } from "./components/TracerouteTable";
import { PortTestPanel } from "./components/PortTestPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Globe, Activity, Network, Shield, Zap, Loader2, RefreshCw,
  Play, Square, Search, ArrowDownToLine, ArrowUpFromLine, GitCompareArrows,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { listen } from "@/lib/tauriEvents";
import { resolveWifiQualityPct, wifiIconFromQualityPct } from "@/lib/wifiSignal";
import type { MonitorSample, MonitorStatus, SpeedTestProgressEvent } from "@/types/networkTest";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
//  NetworkView — flowing modern layout
// ═══════════════════════════════════════════════════════════════════

export function NetworkView() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2 pb-8">
        <StatusHero />
        <SpeedTestSection />
        <PingSection />
        <TracerouteSection />
        <DnsSection />
        <MtuSection />
        <StunSection />
        <PortScanSection />
        <RouteComparisonSection />
        <MonitorSection />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Glass surface — subtle section wrapper
// ═══════════════════════════════════════════════════════════════════

function Surface({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(
      "ui-hero-surface px-5 py-4 transition-smooth",
      className,
    )}>
      {children}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Metric box — small result display cell
// ═══════════════════════════════════════════════════════════════════

function MetricBox({ label, value, unit, color }: {
  label: string; value: string; unit?: string; color?: "emerald" | "yellow" | "red" | "blue";
}) {
  const c = color === "emerald" ? "text-success" : color === "yellow" ? "text-warning"
    : color === "red" ? "text-destructive" : color === "blue" ? "text-info" : "text-foreground";
  return (
    <div className="ui-hero-metric px-3 py-2">
      <div className="text-2xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={cn("text-sm font-semibold tabular-nums", c)}>{value}</span>
        {unit && <span className="text-2xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Status Hero — 4-column overview
// ═══════════════════════════════════════════════════════════════════

function StatusHero() {
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
  const bestLat = healthCheck.result?.best_latency_ms;
  const pktLoss = healthCheck.result?.packet_loss_pct;

  const rawSsid = wifi.result?.ssid;
  const wifiSsid = rawSsid && !/restricted|unavailable/i.test(rawSsid) ? rawSsid : null;
  const wifiSignal = wifi.result?.rssi_dbm;
  const wifiQuality = wifi.result?.signal_quality_pct;
  const wifiChannel = wifi.result?.channel;
  const wifiRate = wifi.result?.tx_rate_mbps;
  const wifiNoise = wifi.result?.noise_dbm;
  const wifiSecurity = wifi.result?.security;
  const wifiQualityPct = resolveWifiQualityPct(wifiQuality, wifiSignal);
  const WifiQualityIcon = wifiIconFromQualityPct(wifiQualityPct);

  const localIp = netInfo.result?.local_ip;
  const defaultIface = netInfo.result?.interfaces?.find((i) => i.is_default);
  const ifaceType = defaultIface?.interface_type;
  const ifaceName = defaultIface?.friendly_name ?? defaultIface?.name;
  const macAddr = defaultIface?.mac_address;
  const gatewayIp = netInfo.result?.default_gateway;
  const gatewayOk = healthCheck.result?.gateway_reachable;
  const vpnIface =
    defaultIface?.interface_type === "VPN/Tunnel"
      ? defaultIface
      : netInfo.result?.interfaces?.find(
          (i) => i.interface_type === "VPN/Tunnel" && i.ipv4.length > 0 && i.gateway != null
        ) ?? null;

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
    : vpnIface ? "ok" : gatewayOk ? "ok" : gatewayOk === false ? "error" : "idle";
  const publicS: S = stun.status === "running" ? "loading" : publicIp ? "ok" : stun.result ? "warn" : "idle";

  return (
    <div className="ui-hero-surface p-5 relative group">
      <div className="grid grid-cols-4 gap-6">
        {/* Internet */}
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Internet</span>
            <span className={cn("h-1.5 w-1.5 rounded-full ml-auto shrink-0", dot(internetS))} />
          </div>
          {internetS === "loading" ? <LoadingPulse /> : (
            <>
              <p className={cn("text-sm font-semibold", internetOk ? "text-success" : healthCheck.result ? "text-destructive" : "text-muted-foreground")}>
                {internetOk ? "Connected" : healthCheck.result ? "Offline" : "--"}
              </p>
              {avgLat != null && (
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {avgLat.toFixed(1)} ms avg{bestLat != null && ` · ${bestLat.toFixed(1)} ms best`}
                </p>
              )}
              {pktLoss != null && pktLoss > 0 && (
                <p className="text-xs text-warning mt-0.5 tabular-nums">{pktLoss.toFixed(1)}% loss</p>
              )}
            </>
          )}
        </div>

        {/* Wi-Fi */}
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <WifiQualityIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Wi-Fi</span>
            <span className={cn("h-1.5 w-1.5 rounded-full ml-auto shrink-0", dot(wifiS))} />
          </div>
          {wifiS === "loading" ? <LoadingPulse /> : (
            <>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold truncate">{wifiSsid ?? (wifiSignal != null ? "Connected" : "--")}</p>
                {(wifiSignal != null || wifiQualityPct != null) && (
                  <WifiQualityIcon className="h-3.5 w-3.5 text-foreground/70 shrink-0" />
                )}
              </div>
              {wifiSignal != null && (
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {wifiSignal} dBm{wifiQualityPct != null && ` · ${wifiQualityPct}%`}
                </p>
              )}
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-2xs text-muted-foreground">
                {wifiChannel != null && <span>Ch {wifiChannel}</span>}
                {wifiRate != null && <span>{wifiRate} Mbps</span>}
                {wifiSecurity && <span>{wifiSecurity}</span>}
                {wifiNoise != null && <span>{wifiNoise} dBm noise</span>}
              </div>
            </>
          )}
        </div>

        {/* Local */}
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Network className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{vpnIface ? "VPN" : "Local"}</span>
            {vpnIface && <span className="text-3xs font-semibold text-info bg-info/10 rounded px-1 py-0.5">ACTIVE</span>}
            <span className={cn("h-1.5 w-1.5 rounded-full ml-auto shrink-0", dot(localS))} />
          </div>
          {localS === "loading" ? <LoadingPulse /> : (
            <>
              <p className="text-sm font-semibold font-mono truncate">
                {vpnIface ? (vpnIface.ipv4[0] ?? "--") : localIp ?? "--"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {vpnIface ? (vpnIface.friendly_name ?? vpnIface.name ?? "VPN Tunnel")
                  : [ifaceType, gatewayIp ? `gw ${gatewayIp}` : null].filter(Boolean).join(" · ") || "--"}
              </p>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-2xs text-muted-foreground">
                {ifaceName && !vpnIface && <span>{ifaceName}</span>}
                {macAddr && <span className="font-mono">{macAddr}</span>}
              </div>
            </>
          )}
        </div>

        {/* Public */}
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Public IP</span>
            <span className={cn("h-1.5 w-1.5 rounded-full ml-auto shrink-0", dot(publicS))} />
          </div>
          {publicS === "loading" ? <LoadingPulse /> : (
            <>
              <p className="text-sm font-semibold font-mono truncate">{publicIp ?? "--"}</p>
              {natType && <p className="text-xs text-muted-foreground mt-1">{natType}</p>}
            </>
          )}
        </div>
      </div>

      {/* Refresh button */}
      <TooltipWrapper title="Refresh all">
        <button
          onClick={() => { runHealthCheck(); fetchWifi(); fetchNetInfo(); runStun(); }}
          className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted/30"
          disabled={anyLoading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", anyLoading && "animate-spin motion-reduce:animate-none")} />
        </button>
      </TooltipWrapper>
    </div>
  );
}

function LoadingPulse() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-20 rounded skeleton" />
      <div className="h-3 w-28 rounded skeleton" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SPEED TEST — prominent first
// ═══════════════════════════════════════════════════════════════════

function SpeedTestSection() {
  const speedTest = useNetworkTestStore((s) => s.speedTest);
  const progress = useNetworkTestStore((s) => s.speedTestProgress);
  const setProgress = useNetworkTestStore((s) => s.setSpeedTestProgress);
  const runSpeedTest = useNetworkTestStore((s) => s.runSpeedTest);
  const dismissSpeedTest = useNetworkTestStore((s) => s.dismissSpeedTest);
  const running = speedTest.status === "running";

  useEffect(() => {
    const unsub = listen<SpeedTestProgressEvent>("speed-test-progress", (e) => setProgress(e.payload));
    return () => { unsub.then((fn) => fn()); };
  }, [setProgress]);

  const r = speedTest.result;
  const phaseLabel = progress?.phase === "latency" ? "Measuring latency"
    : progress?.phase === "download" ? "Downloading" : progress?.phase === "upload" ? "Uploading" : null;

  return (
    <Surface>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Zap className="h-4 w-4 text-warning" />
          <div>
            <h3 className="text-sm font-medium">Speed Test</h3>
            <p className="text-xs text-muted-foreground">Download & upload via Cloudflare</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-xs" onClick={dismissSpeedTest}>
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runSpeedTest(true)} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "Testing..." : "Run Test"}
          </Button>
        </div>
      </div>

      {/* Progress */}
      {running && progress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{phaseLabel}</span>
            <span className="tabular-nums text-muted-foreground">{progress.progress_pct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/20 overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
              progress.phase === "download" ? "bg-success" : progress.phase === "upload" ? "bg-info" : "bg-warning"
            )} style={{ width: `${Math.min(100, progress.progress_pct)}%` }} />
          </div>
          {progress.current_mbps > 0 && (
            <p className="text-center text-lg font-bold tabular-nums text-foreground/80">{progress.current_mbps.toFixed(1)} <span className="text-xs font-normal text-muted-foreground">Mbps</span></p>
          )}
        </div>
      )}

      {/* Results */}
      {r && !running && (
          <div className="grid grid-cols-4 gap-3">
            <div className="ui-hero-metric bg-success/[0.06] px-4 py-3 text-center">
            <ArrowDownToLine className="h-4 w-4 mx-auto mb-1 text-success/70" />
            <p className="text-2xl font-bold tabular-nums text-success">{r.download_mbps.toFixed(1)}</p>
            <p className="text-2xs text-success/60 uppercase tracking-wider mt-0.5">Mbps Down</p>
          </div>
            <div className="ui-hero-metric bg-info/[0.06] px-4 py-3 text-center">
            <ArrowUpFromLine className="h-4 w-4 mx-auto mb-1 text-info/70" />
            <p className="text-2xl font-bold tabular-nums text-info">{r.upload_mbps.toFixed(1)}</p>
            <p className="text-2xs text-info/60 uppercase tracking-wider mt-0.5">Mbps Up</p>
          </div>
            <div className="ui-hero-metric px-4 py-3 text-center">
            <p className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">Latency</p>
            <p className="text-xl font-bold tabular-nums">{r.latency_ms.toFixed(0)}</p>
            <p className="text-2xs text-muted-foreground mt-0.5">ms</p>
          </div>
            <div className="ui-hero-metric px-4 py-3 text-center">
            <p className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">Jitter</p>
            <p className="text-xl font-bold tabular-nums">{r.jitter_ms.toFixed(1)}</p>
            <p className="text-2xs text-muted-foreground mt-0.5">ms</p>
          </div>
        </div>
      )}

      {/* Idle */}
      {!r && !running && (
        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground">Measure your download speed, upload speed, latency and jitter</p>
        </div>
      )}

      {speedTest.error && !running && <p className="text-xs text-destructive mt-2">{speedTest.error}</p>}
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PING
// ═══════════════════════════════════════════════════════════════════

function PingSection() {
  const ping = useNetworkTestStore((s) => s.ping);
  const runPing = useNetworkTestStore((s) => s.runPing);
  const requestStopPing = useNetworkTestStore((s) => s.requestStopPing);
  const [target, setTarget] = useState("8.8.8.8");
  const [count, setCount] = useState("10");
  const running = ping.status === "running";

  return (
    <Surface>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-success" />
          <div>
            <h3 className="text-sm font-medium">Ping</h3>
            <p className="text-xs text-muted-foreground">ICMP latency, jitter & packet loss</p>
          </div>
        </div>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none text-muted-foreground" />}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-3">
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="8.8.8.8 or google.com"
          className="h-8 text-xs flex-1 min-w-0" disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && runPing(target, parseInt(count) || 10)}
        />
        <TooltipWrapper title="Packet count">
          <Input value={count} onChange={(e) => setCount(e.target.value)} className="h-8 w-16 text-xs text-center" type="number" disabled={running} />
        </TooltipWrapper>
        {running && (
          <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-xs" onClick={() => void requestStopPing()}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runPing(target, parseInt(count) || 10)} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Play className="h-3.5 w-3.5" />} Run
        </Button>
      </div>

      {/* Results */}
      {ping.result && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2">
            <MetricBox label="Avg" value={ping.result.avg_ms.toFixed(1)} unit="ms"
              color={ping.result.avg_ms < 50 ? "emerald" : ping.result.avg_ms < 150 ? "yellow" : "red"} />
            <MetricBox label="Min" value={ping.result.min_ms.toFixed(1)} unit="ms" />
            <MetricBox label="Max" value={ping.result.max_ms.toFixed(1)} unit="ms" />
            <MetricBox label="Loss" value={ping.result.packet_loss_pct.toFixed(1)} unit="%"
              color={ping.result.packet_loss_pct < 1 ? "emerald" : ping.result.packet_loss_pct < 5 ? "yellow" : "red"} />
            <MetricBox label="Jitter" value={`±${ping.result.stddev_ms.toFixed(1)}`} unit="ms" />
          </div>

          {ping.result.probes.length > 1 && (
            <div className="h-28 rounded-lg bg-background/30 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ping.result.probes.map((p) => ({ seq: p.seq, rtt: p.rtt_ms }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.2)" />
                  <XAxis dataKey="seq" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={30} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(val: unknown) => [`${typeof val === "number" ? val.toFixed(1) : "--"} ms`, "RTT"]} />
                  <Line type="monotone" dataKey="rtt" stroke="#34d399" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <p className="text-xs text-muted-foreground font-mono">{ping.result.resolved_ip}</p>
        </div>
      )}
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  TRACEROUTE
// ═══════════════════════════════════════════════════════════════════

function TracerouteSection() {
  const traceroute = useNetworkTestStore((s) => s.traceroute);
  const runTraceroute = useNetworkTestStore((s) => s.runTraceroute);
  const requestStopTraceroute = useNetworkTestStore((s) => s.requestStopTraceroute);
  const [target, setTarget] = useState("google.com");
  const running = traceroute.status === "running";

  return (
    <Surface>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Network className="h-4 w-4 text-info" />
          <div>
            <h3 className="text-sm font-medium">Traceroute</h3>
            <p className="text-xs text-muted-foreground">Map the network path hop-by-hop</p>
          </div>
          {traceroute.result?.reached_destination && (
            <Badge variant="secondary" className="text-2xs bg-success/10 text-success border-success/30 ml-2">Reached</Badge>
          )}
        </div>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none text-muted-foreground" />}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="google.com"
          className="h-8 text-xs flex-1 min-w-0" disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && runTraceroute(target)}
        />
        {running && (
          <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-xs" onClick={() => void requestStopTraceroute()}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runTraceroute(target)} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Play className="h-3.5 w-3.5" />} Trace
        </Button>
      </div>

      {traceroute.result && traceroute.result.hops.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {traceroute.result.hops.length} hops to <span className="font-mono">{traceroute.result.resolved_ip}</span>
          </p>
          <TracerouteTable hops={traceroute.result.hops} />
        </div>
      )}
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  DNS LOOKUP
// ═══════════════════════════════════════════════════════════════════

function DnsSection() {
  const dns = useNetworkTestStore((s) => s.dns);
  const runDns = useNetworkTestStore((s) => s.runDns);
  const dismissNetworkDns = useNetworkTestStore((s) => s.dismissNetworkDns);
  const [target, setTarget] = useState("google.com");
  const running = dns.status === "running";

  return (
    <Surface>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Search className="h-4 w-4 text-info" />
          <div>
            <h3 className="text-sm font-medium">DNS Lookup</h3>
            <p className="text-xs text-muted-foreground">Resolve A, AAAA, SRV & NAPTR records</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="example.com"
          className="h-8 text-xs flex-1 min-w-0" disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && runDns(target)}
        />
        {running && (
          <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-xs" onClick={dismissNetworkDns}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runDns(target)} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Search className="h-3.5 w-3.5" />} Lookup
        </Button>
      </div>

      {dns.result && (
        <div className="space-y-2.5">
          {(dns.result.a_records.length > 0 || dns.result.aaaa_records.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {dns.result.a_records.map((ip, i) => (
                <span key={`a-${i}`} className="inline-flex items-center gap-1.5 text-xs font-mono bg-muted/20 rounded-lg px-2.5 py-1">
                  <span className="text-3xs text-muted-foreground font-sans uppercase">A</span> {ip}
                </span>
              ))}
              {dns.result.aaaa_records.map((ip, i) => (
                <span key={`aaaa-${i}`} className="inline-flex items-center gap-1.5 text-xs font-mono bg-muted/20 rounded-lg px-2.5 py-1">
                  <span className="text-3xs text-muted-foreground font-sans uppercase">AAAA</span> {ip}
                </span>
              ))}
            </div>
          )}
          {dns.result.srv_records.length > 0 && (
            <div className="ui-hero-metric divide-y divide-border/20 overflow-hidden">
              {dns.result.srv_records.map((r, i) => (
                <div key={i} className="px-3 py-1.5 text-xs font-mono">
                  <span className="text-muted-foreground">{r.service}</span> → {r.target}:{r.port}
                  <span className="text-muted-foreground/60 ml-2">(pri {r.priority})</span>
                </div>
              ))}
            </div>
          )}
          {dns.result.naptr_records.length > 0 && (
            <div className="ui-hero-metric divide-y divide-border/20 overflow-hidden">
              {dns.result.naptr_records.map((r, i) => (
                <div key={i} className="px-3 py-1.5 text-xs font-mono">
                  <span className="text-muted-foreground">{r.service}</span> → {r.replacement}
                </div>
              ))}
            </div>
          )}
          <p className="text-2xs text-muted-foreground tabular-nums">Resolved in {dns.result.resolution_ms.toFixed(0)} ms</p>
        </div>
      )}
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MTU DISCOVERY
// ═══════════════════════════════════════════════════════════════════

function MtuSection() {
  const mtu = useNetworkTestStore((s) => s.mtu);
  const runMtu = useNetworkTestStore((s) => s.runMtu);
  const dismissMtu = useNetworkTestStore((s) => s.dismissMtu);
  const [target, setTarget] = useState("google.com");
  const running = mtu.status === "running";

  return (
    <Surface>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Zap className="h-4 w-4 text-warning" />
          <div>
            <h3 className="text-sm font-medium">MTU Discovery</h3>
            <p className="text-xs text-muted-foreground">Path maximum transmission unit</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="google.com"
          className="h-8 text-xs flex-1 min-w-0" disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && runMtu(target)}
        />
        {running && (
          <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-xs" onClick={dismissMtu}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runMtu(target)} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Play className="h-3.5 w-3.5" />} Run
        </Button>
      </div>

      {mtu.result && (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{mtu.result.path_mtu}</span>
            <span className="text-xs text-muted-foreground">bytes</span>
            <span className={cn("text-xs font-medium ml-auto",
              mtu.result.path_mtu >= 1400 ? "text-success" : mtu.result.path_mtu >= 576 ? "text-warning" : "text-destructive"
            )}>
              {mtu.result.path_mtu >= 1400 ? "Standard" : mtu.result.path_mtu >= 576 ? "Reduced" : "Very Low"}
            </span>
          </div>
          <div className="relative h-2 rounded-full overflow-hidden bg-muted/20">
            <div className={cn("h-full rounded-full transition-smooth",
              mtu.result.path_mtu >= 1400 ? "bg-success" : mtu.result.path_mtu >= 576 ? "bg-warning" : "bg-destructive"
            )} style={{ width: `${Math.min(100, (mtu.result.path_mtu / 1500) * 100)}%` }} />
          </div>
          <div className="flex justify-between text-2xs text-muted-foreground">
            <span>0</span><span>576</span><span>1400</span><span>1500</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {mtu.result.path_mtu >= 1400 ? "No fragmentation expected" :
             mtu.result.path_mtu >= 576 ? "May cause fragmentation for VoIP packets" : "Very low — likely tunneled or VPN connection"}
          </p>
        </div>
      )}
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  STUN / NAT
// ═══════════════════════════════════════════════════════════════════

function StunSection() {
  const stun = useNetworkTestStore((s) => s.stun);
  const runStun = useNetworkTestStore((s) => s.runStun);
  const dismissStun = useNetworkTestStore((s) => s.dismissStun);
  const [target, setTarget] = useState("stun.l.google.com");
  const running = stun.status === "running";

  return (
    <Surface>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Shield className="h-4 w-4 text-info" />
          <div>
            <h3 className="text-sm font-medium">STUN / NAT</h3>
            <p className="text-xs text-muted-foreground">Detect NAT type & public mapping</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="stun.l.google.com"
          className="h-8 text-xs flex-1 min-w-0" disabled={running}
          onKeyDown={(e) => e.key === "Enter" && !running && runStun(target || undefined)}
        />
        {running && (
          <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-xs" onClick={dismissStun}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs" onClick={() => runStun(target || undefined)} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Search className="h-3.5 w-3.5" />} Detect
        </Button>
      </div>

      {stun.result && (
        <div className="grid grid-cols-4 gap-2">
          <MetricBox label="Public IP" value={stun.result.public_ip ?? "--"} />
          <MetricBox label="Public Port" value={stun.result.public_port?.toString() ?? "--"} />
          <MetricBox label="Local IP" value={stun.result.local_ip ?? "--"} />
          <MetricBox label="NAT Type" value={stun.result.nat_type}
            color={stun.result.nat_type === "Symmetric" ? "red" : stun.result.nat_type === "No NAT" || stun.result.nat_type === "Full Cone" ? "emerald" : "yellow"} />
        </div>
      )}
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PORT SCAN
// ═══════════════════════════════════════════════════════════════════

function PortScanSection() {
  return (
    <Surface>
      <PortTestPanel borderless />
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  ROUTE COMPARISON
// ═══════════════════════════════════════════════════════════════════

function RouteComparisonSection() {
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
  const canRun = targetA.trim().length > 0 && targetB.trim().length > 0 && !routeComparing;

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
      if (rA.hops[i]!.ip && rB.hops[i]!.ip && rA.hops[i]!.ip !== rB.hops[i]!.ip) {
        divergenceHop = i + 1;
        break;
      }
    }
    const lastA = rA.hops.filter((h) => h.avg_rtt_ms != null).pop();
    const lastB = rB.hops.filter((h) => h.avg_rtt_ms != null).pop();
    const latencyDelta = lastA && lastB ? (lastA.avg_rtt_ms! - lastB.avg_rtt_ms!) : null;
    return { maxHops, divergenceHop, commonIps, latencyDelta };
  }, [rA, rB]);

  return (
    <Surface>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <GitCompareArrows className="h-4 w-4 text-info" />
          <div>
            <h3 className="text-sm font-medium">Route Comparison</h3>
            <p className="text-xs text-muted-foreground">Compare traceroute paths to two targets</p>
          </div>
        </div>
        {routeComparing && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none text-muted-foreground" />}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Input value={targetA} onChange={(e) => setA(e.target.value)} placeholder="Target A (e.g. 8.8.8.8)"
          className="h-8 text-xs flex-1 min-w-0" disabled={routeComparing} />
        <span className="text-xs text-muted-foreground font-medium shrink-0 px-1">vs</span>
        <Input value={targetB} onChange={(e) => setB(e.target.value)} placeholder="Target B (e.g. 1.1.1.1)"
          className="h-8 text-xs flex-1 min-w-0" disabled={routeComparing} />
        {routeComparing && (
          <Button type="button" size="sm" variant="destructive" className="h-8 gap-1.5 px-3 text-xs shrink-0" onClick={stopRouteComparison}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
        <Button size="sm" className="h-8 gap-1.5 px-4 text-xs shrink-0" onClick={handleRun} disabled={!canRun}>
          {routeComparing ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Play className="h-3.5 w-3.5" />} Compare
        </Button>
      </div>

      {rA && rB && analysis && (
        <div className="space-y-3">
          {/* Summary badges */}
          <div className="flex flex-wrap gap-2">
            {analysis.divergenceHop != null && (
              <Badge variant="secondary" className="text-2xs bg-info/10 text-info border-info/30">
                Diverge at hop {analysis.divergenceHop}
              </Badge>
            )}
            {analysis.commonIps.size > 0 && (
              <Badge variant="secondary" className="text-2xs bg-success/10 text-success border-success/30">
                {analysis.commonIps.size} shared hops
              </Badge>
            )}
            {analysis.latencyDelta != null && (
              <Badge variant="secondary" className="text-2xs">
                {Math.abs(analysis.latencyDelta).toFixed(1)} ms {analysis.latencyDelta > 0 ? `slower to ${targetA}` : `slower to ${targetB}`}
              </Badge>
            )}
          </div>

          {/* Hop table */}
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[40px_1fr_72px_72px_1fr] text-2xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/10 border-b">
              <div className="px-2 py-1.5 text-center">Hop</div>
              <div className="px-2 py-1.5">{targetA}</div>
              <div className="px-2 py-1.5 text-right">RTT A</div>
              <div className="px-2 py-1.5 text-right">RTT B</div>
              <div className="px-2 py-1.5 text-right">{targetB}</div>
            </div>
            <div className="divide-y divide-border/20 max-h-64 overflow-y-auto">
              {Array.from({ length: analysis.maxHops }, (_, i) => {
                const hopA = rA.hops[i];
                const hopB = rB.hops[i];
                const isCommon = hopA?.ip != null && hopB?.ip != null && hopA.ip === hopB.ip;
                const isDivergence = analysis.divergenceHop === i + 1;
                return (
                  <div key={i} className={cn(
                    "grid grid-cols-[40px_1fr_72px_72px_1fr] text-xs hover:bg-muted/10 transition-smooth",
                    isCommon && "bg-success/[0.03]",
                    isDivergence && "bg-warning/[0.04] border-l-2 border-l-warning",
                  )}>
                    <div className="px-2 py-1.5 text-center text-muted-foreground">{i + 1}</div>
                    <div className="px-2 py-1.5 font-mono truncate">{hopA?.hostname ?? hopA?.ip ?? "*"}</div>
                    <div className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {hopA?.avg_rtt_ms != null ? `${hopA.avg_rtt_ms.toFixed(1)} ms` : "--"}
                    </div>
                    <div className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {hopB?.avg_rtt_ms != null ? `${hopB.avg_rtt_ms.toFixed(1)} ms` : "--"}
                    </div>
                    <div className="px-2 py-1.5 font-mono truncate text-right">{hopB?.hostname ?? hopB?.ip ?? "*"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{rA.hops.length} hops to {rA.resolved_ip}</span>
            <span>{rB.hops.length} hops to {rB.resolved_ip}</span>
          </div>
        </div>
      )}

      {(routeResultA.error || routeResultB.error) && !routeComparing && (
        <p className="text-xs text-destructive">{routeResultA.error || routeResultB.error}</p>
      )}
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CONTINUOUS MONITOR
// ═══════════════════════════════════════════════════════════════════

function MonitorSection() {
  const monitorRunning = useNetworkTestStore((s) => s.monitorRunning);
  const monitorSamples = useNetworkTestStore((s) => s.monitorSamples);
  const monitorTarget = useNetworkTestStore((s) => s.monitorTarget);
  const setMonitorTarget = useNetworkTestStore((s) => s.setMonitorTarget);
  const startMonitor = useNetworkTestStore((s) => s.startMonitor);
  const stopMonitor = useNetworkTestStore((s) => s.stopMonitor);
  const addMonitorSample = useNetworkTestStore((s) => s.addMonitorSample);
  const setMonitorRunning = useNetworkTestStore((s) => s.setMonitorRunning);
  const clearMonitorSamples = useNetworkTestStore((s) => s.clearMonitorSamples);

  const [target, setTarget] = useState(monitorTarget);
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
    <Surface>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-warning" />
          <div>
            <h3 className="text-sm font-medium">Continuous Monitor</h3>
            <p className="text-xs text-muted-foreground">Real-time latency, jitter & loss over time</p>
          </div>
          {monitorRunning && (
            <Badge variant="secondary" className="text-2xs bg-success/10 text-success border-success/30 ml-2">
              <span className="h-1.5 w-1.5 rounded-full bg-success status-online mr-1 inline-block" />Live
            </Badge>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-3">
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="8.8.8.8 or host"
          className="h-8 text-xs flex-1 min-w-0" disabled={monitorRunning} />
        <div className="flex items-center gap-1.5 shrink-0">
          <label className="text-2xs text-muted-foreground/60">Duration</label>
          <div className="relative">
            <Input value={duration} onChange={(e) => setDuration(e.target.value)}
              className="h-8 w-[72px] text-xs text-right pr-5" type="number" disabled={monitorRunning} />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-3xs text-muted-foreground/60 pointer-events-none">s</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <label className="text-2xs text-muted-foreground/60">Interval</label>
          <div className="relative">
            <Input value={interval} onChange={(e) => setInterval_(e.target.value)}
              className="h-8 w-[80px] text-xs text-right pr-7" type="number" disabled={monitorRunning} />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-3xs text-muted-foreground/60 pointer-events-none">ms</span>
          </div>
        </div>
        {monitorRunning ? (
          <Button variant="destructive" size="sm" className="h-8 gap-1.5 px-4 text-xs shrink-0" onClick={stopMonitor}>
            <Square className="h-3.5 w-3.5" /> Stop
          </Button>
        ) : (
          <Button size="sm" className="h-8 gap-1.5 px-4 text-xs shrink-0" onClick={() => {
            setMonitorTarget(target); clearMonitorSamples();
            startMonitor(target, parseInt(duration), parseInt(interval));
          }}>
            <Play className="h-3.5 w-3.5" /> Start
          </Button>
        )}
      </div>

      {/* Results */}
      {(monitorRunning || monitorSamples.length > 0) && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <MetricBox label="Latency" value={latest?.latency_ms != null ? latest.latency_ms.toFixed(1) : "--"} unit="ms"
              color={latest ? ((latest.latency_ms ?? 0) < 50 ? "emerald" : "yellow") : undefined} />
            <MetricBox label="Jitter" value={latest?.jitter_ms != null ? latest.jitter_ms.toFixed(1) : "--"} unit="ms"
              color={latest ? ((latest.jitter_ms ?? 0) < 10 ? "emerald" : "yellow") : undefined} />
            <MetricBox label="Loss" value={latest?.packet_loss_pct != null ? latest.packet_loss_pct.toFixed(1) : "--"} unit="%"
              color={latest ? ((latest.packet_loss_pct ?? 0) < 1 ? "emerald" : "red") : undefined} />
            <MetricBox label="Samples" value={String(monitorSamples.length)} />
          </div>

          {chartData.length > 1 && (
            <div className="h-44 rounded-lg bg-background/30 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.2)" />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={30} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }} />
                  <Line type="monotone" dataKey="latency" stroke="#34d399" dot={false} strokeWidth={1.5} name="Latency (ms)" />
                  <Line type="monotone" dataKey="jitter" stroke="#facc15" dot={false} strokeWidth={1.5} name="Jitter (ms)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}
