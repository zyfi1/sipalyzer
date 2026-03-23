import { useEffect, useRef, useState, useMemo } from "react";
import { listen } from "@/lib/tauriEvents";
import { useNetworkTestStore } from "@/stores/networkTestStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";

import { ToolViewShell } from "./components/ToolViewShell";
import { MetricCard } from "./components/MetricCard";
import { MosGauge } from "./components/MosGauge";
import { TroubleshootLink } from "@/components/troubleshooting/TroubleshootLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  Activity, Globe, PhoneCall, Loader2, Play, Shield,
  Wifi, Zap, Search, BarChart3, Award, Timer, Info,
} from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type {
  PortTestEntry,
  PortTestResult,
  SipProbePacketEvent,
  StunQualityPacketEvent,
  ProbeMethod,
} from "@/types/networkTest";
import { ResultSourceBadge } from "./components/ResultSourceBadge";

// ── Section header ──────────────────────────────────────────────

function SectionHeader({ icon: Icon, color, title, badge }: {
  icon: React.ComponentType<{ className?: string }>; color: string; title: string; badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className={cn("h-3.5 w-3.5", color)} />
      <h3 className="section-label-sm">{title}</h3>
      {badge}
    </div>
  );
}

// ── Stat row ────────────────────────────────────────────────────

function Stat({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="section-label-sm shrink-0">{label}</span>
      <span className={cn("text-sm font-medium tabular-nums truncate", mono && "font-mono", color ?? "text-foreground")}>{value}</span>
    </div>
  );
}

// ── MetricBox ───────────────────────────────────────────────────

function MetricBox({ label, value, unit, color }: {
  label: string; value: string; unit?: string; color?: "emerald" | "yellow" | "red" | "blue";
}) {
  const colorMap = {
    emerald: "text-success",
    yellow: "text-warning",
    red: "text-destructive",
    blue: "text-primary",
  };
  return (
    <div className="ui-hero-metric px-3 py-2">
      <div className="section-label-sm">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={cn("text-lg font-semibold tabular-nums leading-tight", color ? colorMap[color] : "text-foreground")}>{value}</span>
        {unit && <span className="text-2xs text-muted-foreground/60">{unit}</span>}
      </div>
    </div>
  );
}

// ── Card wrapper ────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("ui-hero-surface px-5 py-4", className)}>{children}</div>;
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN VIEW
// ═══════════════════════════════════════════════════════════════════

export function VoipView() {
  const voipTarget = useNetworkTestStore((s) => s.voipTarget);
  const setVoipTarget = useNetworkTestStore((s) => s.setVoipTarget);
  const voipRunning = useNetworkTestStore((s) => s.voipRunning);
  const runVoipAssessment = useNetworkTestStore((s) => s.runVoipAssessment);
  const hasTarget = voipTarget.trim().length > 0;

  void useExecutionContextStore((s) => s.resolvedContext);

  return (
    <ToolViewShell
      icon={PhoneCall}
      tint="text-primary"
      title="VoIP Assessment"
      description="Comprehensive VoIP readiness and call quality analysis"
      compact
      controls={
        <div className="flex items-center gap-3">
          <TooltipWrapper title="Target Host" description="Enter your SIP server, PBX, or VoIP provider hostname. All tests will target this host." side="bottom">
            <span><Globe className="h-4 w-4 text-muted-foreground/60 shrink-0" /></span>
          </TooltipWrapper>
          <Input
            value={voipTarget}
            onChange={(e) => setVoipTarget(e.target.value)}
            placeholder="SIP server — e.g. sip.example.com, pbx.company.com"
            className="h-10 text-sm flex-1 min-w-0"
            disabled={voipRunning}
            onKeyDown={(e) => e.key === "Enter" && hasTarget && !voipRunning && runVoipAssessment()}
          />
          <TooltipWrapper title="Run Full Assessment" description="Runs all VoIP quality tests in parallel: ping, MOS calculation, SIP DNS, port scan, DSCP marking, STUN quality, and NAT detection." side="bottom">
            <Button className="h-10 gap-2 px-5 text-sm shrink-0" onClick={runVoipAssessment} disabled={voipRunning || !hasTarget}>
              {voipRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {voipRunning ? "Testing…" : "Full Test"}
            </Button>
          </TooltipWrapper>
        </div>
      }
    >
      <div className="space-y-4">
        {/* ═══ HERO — MOS + Readiness ═════════════════════ */}
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <QualityHero />
          <ScoreCard />
        </div>

        {/* ═══ NETWORK QUALITY ════════════════════════════ */}
        <div className="grid grid-cols-3 gap-4">
          <CallQuality />
          <UdpQuality />
          <QosDscp />
        </div>

        {/* ═══ NAT INFO ══════════════════════════════════ */}
        <NatInfoCard />

        {/* ═══ SIP INFRASTRUCTURE ═════════════════════════ */}
        <div className="grid grid-cols-3 gap-4">
          <SipConnectivity />
          <SipDns />
          <div className="space-y-4">
            <CodecCalc />
            <JitterBuffer />
          </div>
        </div>

        {/* ═══ RTP & SIP PROBE ════════════════════════════ */}
        <div className="grid grid-cols-1 gap-4">
          <Card><RtpSimTile target={voipTarget || "8.8.8.8"} /></Card>
          <Card><SipProbe /></Card>
        </div>
      </div>
    </ToolViewShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Quality Hero
// ═══════════════════════════════════════════════════════════════════

function QualityHero() {
  const voipMos = useNetworkTestStore((s) => s.voipMos);
  const voipPing = useNetworkTestStore((s) => s.voipPing);
  const voipRunning = useNetworkTestStore((s) => s.voipRunning);
  const mos = voipMos.result;
  const ping = voipPing.result;
  const jitter = ping ? calcJitter(ping.probes.filter((p) => p.rtt_ms !== null).map((p) => p.rtt_ms as number)) : null;
  const codecs = mos ? getCodecRecs(mos.latency_ms, mos.jitter_ms, mos.packet_loss_pct) : null;

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <SectionHeader icon={PhoneCall} color="text-primary" title="Call Quality Overview" />
        {voipRunning && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {ping && !voipRunning && <span className="text-2xs text-muted-foreground/60 font-mono ml-auto">{ping.resolved_ip}</span>}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-5 items-center">
        <div className="flex items-center gap-1.5">
          <MosGauge mos={mos?.mos ?? null} quality={mos?.quality} loading={voipRunning || voipMos.status === "running"} />
          {mos != null && <TroubleshootLink metric="mos" value={mos.mos} compact />}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <TooltipWrapper title="Latency" description="Round-trip time to the SIP server. <100ms is good for voice, >200ms causes noticeable delay." side="bottom">
            <div className="cursor-help">
              <MetricCard label="Latency" value={ping?.avg_ms ?? null} unit="ms"
                status={!ping ? "idle" : ping.avg_ms < 100 ? "pass" : ping.avg_ms < 200 ? "warn" : "fail"}
                subtitle={ping ? `${ping.min_ms.toFixed(0)}–${ping.max_ms.toFixed(0)}` : undefined} />
            </div>
          </TooltipWrapper>
          <TooltipWrapper title="Jitter" description="Variation in packet arrival times. <10ms is ideal for voice. High jitter causes choppy audio." side="bottom">
            <div className="cursor-help flex items-center gap-1.5">
              <MetricCard label="Jitter" value={jitter} unit="ms"
                status={jitter === null ? "idle" : jitter < 10 ? "pass" : jitter < 30 ? "warn" : "fail"} />
              {jitter != null && <TroubleshootLink metric="jitter" value={jitter} compact />}
            </div>
          </TooltipWrapper>
          <TooltipWrapper title="Packet Loss" description="Percentage of packets lost in transit. <1% is acceptable for voice; >3% causes audible degradation." side="bottom">
            <div className="cursor-help flex items-center gap-1.5">
              <MetricCard label="Loss" value={ping?.packet_loss_pct ?? null} unit="%"
                status={!ping ? "idle" : ping.packet_loss_pct < 1 ? "pass" : ping.packet_loss_pct < 3 ? "warn" : "fail"} />
              {ping != null && <TroubleshootLink metric="loss" value={ping.packet_loss_pct} compact />}
            </div>
          </TooltipWrapper>
        </div>
      </div>
      {codecs && (
        <div className="mt-3 pt-3 border-t border-border/20 flex items-center gap-3 text-xs flex-wrap">
          <span className="section-label-sm">Codec fit:</span>
          {codecs.map((c) => (
            <TooltipWrapper key={c.name} title={`${c.name} Compatibility`} description={c.ok ? `${c.name} should work well with your current network conditions.` : `${c.name} may have issues: ${c.note === "lat" ? "high latency" : c.note === "loss" ? "packet loss too high" : c.note === "jit" ? "jitter too high" : c.note === "deg" ? "degraded quality likely" : "poor conditions"}.`} side="bottom">
              <span className="flex items-center gap-1 cursor-help">
                <span className={cn("h-1.5 w-1.5 rounded-full", c.ok ? "bg-success" : "bg-destructive/60")} />
                <span className={cn("font-medium", c.ok ? "text-foreground" : "text-muted-foreground/60")}>{c.name}</span>
              </span>
            </TooltipWrapper>
          ))}
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Readiness Score
// ═══════════════════════════════════════════════════════════════════

interface ScoreCat { label: string; weight: number; score: number | null; status: "idle" | "ok" | "warn" | "fail"; detail: string; tip: string; }

function ScoreCard() {
  const voipMos = useNetworkTestStore((s) => s.voipMos);
  const voipPortScan = useNetworkTestStore((s) => s.voipPortScan);
  const voipDns = useNetworkTestStore((s) => s.voipDns);
  const voipDscp = useNetworkTestStore((s) => s.voipDscp);
  const voipStun = useNetworkTestStore((s) => s.voipStun);

  const cats = useMemo<ScoreCat[]>(() => {
    const m = voipMos.result;
    const p = voipPortScan.result;
    const d = voipDns.result;
    const ds = voipDscp.result;
    const st = voipStun.result;
    const op = p ? p.results.filter((r) => r.status === "open" || r.status === "open_filtered").length : 0;
    const tp = p ? p.results.length : 0;
    const hS = (d?.srv_records.length ?? 0) > 0;
    const hA = (d?.a_records.length ?? 0) > 0;
    const hN = (d?.naptr_records.length ?? 0) > 0;
    const nOk = st?.nat_type === "No NAT" || st?.nat_type === "Full Cone";
    const nSym = st?.nat_type === "Symmetric";
    return [
      { label: "Quality", weight: 35, score: m ? Math.min(100, Math.max(0, (m.mos - 1) * 25)) : null,
        status: !m ? "idle" : m.mos >= 4.0 ? "ok" : m.mos >= 3.6 ? "warn" : "fail", detail: m ? `MOS ${m.mos.toFixed(1)}` : "—", tip: "Voice quality score derived from latency, jitter, and packet loss." },
      { label: "Ports", weight: 20, score: p ? (op / Math.max(1, tp)) * 100 : null,
        status: !p ? "idle" : op === tp ? "ok" : op > 0 ? "warn" : "fail", detail: p ? `${op}/${tp}` : "—", tip: "SIP/VoIP ports that are reachable on the target server." },
      { label: "DNS", weight: 15, score: d ? (hA ? 40 : 0) + (hS ? 40 : 0) + (hN ? 20 : 0) : null,
        status: !d ? "idle" : (hS || hA) ? "ok" : "fail", detail: d ? [hA && "A", hS && "SRV"].filter(Boolean).join(",") || "—" : "—", tip: "SIP DNS records (A, SRV, NAPTR) for proper call routing." },
      { label: "QoS", weight: 15, score: ds ? (ds.packet_sent ? 100 : 20) : null,
        status: !ds ? "idle" : ds.packet_sent ? "ok" : "warn", detail: ds ? (ds.packet_sent ? "OK" : "Fail") : "—", tip: "DSCP EF marking — ensures voice packets get network priority." },
      { label: "NAT", weight: 15, score: st ? (nOk ? 100 : nSym ? 30 : 70) : null,
        status: !st ? "idle" : nOk ? "ok" : nSym ? "fail" : "warn", detail: st ? st.nat_type : "—", tip: "NAT type affects VoIP connectivity. Symmetric NAT can block calls." },
    ];
  }, [voipMos.result, voipPortScan.result, voipDns.result, voipDscp.result, voipStun.result]);

  const hasAny = cats.some((c) => c.score !== null);
  if (!hasAny) return null;

  const tested = cats.filter((c) => c.score !== null);
  const tw = tested.reduce((s, c) => s + c.weight, 0);
  const overall = tw > 0 ? tested.reduce((s, c) => s + c.score! * (c.weight / tw), 0) : 0;
  const grade = overall >= 90 ? "A" : overall >= 80 ? "B" : overall >= 65 ? "C" : overall >= 50 ? "D" : "F";
  const gc = grade <= "B" ? "text-success" : grade === "C" ? "text-warning" : grade === "D" ? "text-warning" : "text-destructive";
  const bc = (s: ScoreCat["status"]) => s === "ok" ? "bg-success" : s === "warn" ? "bg-warning" : s === "fail" ? "bg-destructive" : "bg-muted-foreground/20";

  return (
    <Card className="w-56 shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <Award className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="section-label-sm">Readiness</span>
        <span className={cn("text-2xl font-black tabular-nums ml-auto", gc)}>{grade}</span>
      </div>
      <p className="text-base font-bold tabular-nums mb-3">{Math.round(overall)} <span className="text-sm font-normal text-muted-foreground/60">/ 100</span></p>
      <div className="space-y-2">
        {cats.map((c) => (
          <TooltipWrapper key={c.label} title={c.label} description={c.tip} side="left">
            <div className="flex items-center gap-2 cursor-help">
              <span className="text-2xs text-muted-foreground/60 w-12 shrink-0">{c.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted/20 overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-[var(--motion-duration-attention)] [transition-timing-function:var(--motion-ease-overlay)]", bc(c.status))}
                  style={{ width: c.score != null ? `${c.score}%` : "0%" }} />
              </div>
              <span className="text-2xs text-muted-foreground/60 w-12 text-right truncate tabular-nums">{c.detail}</span>
            </div>
          </TooltipWrapper>
        ))}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Call Quality
// ═══════════════════════════════════════════════════════════════════

function CallQuality() {
  const voipTarget = useNetworkTestStore((s) => s.voipTarget);
  const voipPing = useNetworkTestStore((s) => s.voipPing);
  const runVoipPing = useNetworkTestStore((s) => s.runVoipPing);
  const ping = voipPing.result;
  const running = voipPing.status === "running";
  const hasTarget = voipTarget.trim().length > 0;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionHeader icon={Activity} color="text-success" title="Call Quality" />
        <TooltipWrapper title="Run Ping Test" description="Send 50 ICMP echo requests to measure latency, jitter, and packet loss to your SIP server." side="bottom">
          <Button size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={() => runVoipPing()} disabled={!hasTarget || running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
          </Button>
        </TooltipWrapper>
      </div>
      {ping && !running && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Stat label="Avg" value={`${ping.avg_ms.toFixed(1)} ms`} />
          <Stat label="Loss" value={`${ping.packet_loss_pct.toFixed(1)}%`}
            color={ping.packet_loss_pct < 1 ? "text-success" : "text-destructive"} />
          <Stat label="Min / Max" value={`${ping.min_ms.toFixed(0)} / ${ping.max_ms.toFixed(0)} ms`} />
          <Stat label="StdDev" value={`±${ping.stddev_ms.toFixed(1)} ms`} />
          <span className="col-span-2 text-2xs text-muted-foreground/60 mt-1 font-mono truncate">
            {ping.probes.filter((p) => p.success).length}/{ping.probes.length} ok · {ping.resolved_ip}
          </span>
        </div>
      )}
      {!ping && !running && <p className="text-2xs text-muted-foreground/60">50 ICMP pings to your SIP server.</p>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SIP Connectivity
// ═══════════════════════════════════════════════════════════════════

function extractPort(target: string): number | undefined {
  const t = target.trim();
  if (!t) return undefined;
  if (t.startsWith("[")) {
    const bracket = t.indexOf("]");
    if (bracket > 0) { const rest = t.slice(bracket + 1); if (rest.startsWith(":")) { const p = parseInt(rest.slice(1), 10); if (p > 0 && p <= 65535) return p; } }
    return undefined;
  }
  if ((t.match(/:/g) || []).length === 1) { const idx = t.lastIndexOf(":"); const p = parseInt(t.slice(idx + 1), 10); if (p > 0 && p <= 65535) return p; }
  return undefined;
}

function isPortPass(status: string) { return status === "open" || status === "open_filtered"; }
const DEFAULT_SIP_PORTS_STR = "5060, 5061, 8443";
type ProtoMode = "both" | "tcp" | "udp";

function parsePorts(input: string, mode: ProtoMode = "both"): PortTestEntry[] {
  const entries: PortTestEntry[] = [];
  const seen = new Set<string>();
  const protos: ("udp" | "tcp")[] = mode === "both" ? ["udp", "tcp"] : [mode];
  for (const part of input.split(/[,\s]+/).filter(Boolean)) {
    const p = parseInt(part.trim(), 10);
    if (isNaN(p) || p < 1 || p > 65535) continue;
    const label = p === 5060 ? "SIP" : p === 5061 ? "SIP TLS" : p === 8443 ? "WSS" : p === 3478 ? "STUN" : null;
    for (const proto of protos) {
      const key = `${p}:${proto}`;
      if (!seen.has(key)) { seen.add(key); entries.push({ port: p, protocol: proto, label: label ? `${label} ${proto.toUpperCase()}` : `${proto.toUpperCase()} ${p}` }); }
    }
  }
  return entries;
}

function SipConnectivity() {
  const voipTarget = useNetworkTestStore((s) => s.voipTarget);
  const voipPortScan = useNetworkTestStore((s) => s.voipPortScan);
  const runVoipPortScan = useNetworkTestStore((s) => s.runVoipPortScan);
  const portsInput = useNetworkTestStore((s) => s.voipCustomPorts);
  const setPortsInput = useNetworkTestStore((s) => s.setVoipCustomPorts);
  const protoMode = useNetworkTestStore((s) => s.voipProtoMode);
  const setProtoMode = useNetworkTestStore((s) => s.setVoipProtoMode);
  const result = voipPortScan.result;
  const running = voipPortScan.status === "running";
  const hasTarget = voipTarget.trim().length > 0;
  const targetPort = extractPort(voipTarget);

  useEffect(() => {
    if (targetPort && ![5060, 5061, 8443].includes(targetPort)) {
      const existing = portsInput.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10));
      if (!existing.includes(targetPort)) setPortsInput(`${targetPort}, ${portsInput}`);
    }
  }, [targetPort]);

  const handleScan = () => { runVoipPortScan(); };
  const passCount = result ? result.results.filter((r) => isPortPass(r.status)).length : 0;
  const portCount = parsePorts(portsInput, protoMode).length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionHeader icon={Shield} color="text-destructive" title="SIP Ports"
          badge={result && !running ? (
            <Badge variant="secondary" className={cn("text-2xs px-1.5 py-0",
              passCount > 0 ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"
            )}>{passCount}/{result.results.length}</Badge>
          ) : undefined}
        />
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <TooltipWrapper title="Ports to scan" description="Comma-separated port numbers. The target's port is auto-included if specified with :port.">
          <Input value={portsInput} onChange={(e) => setPortsInput(e.target.value)}
            placeholder={DEFAULT_SIP_PORTS_STR} className="h-7 text-xs flex-1 min-w-0 font-mono" disabled={running}
            onKeyDown={(e) => e.key === "Enter" && hasTarget && !running && handleScan()} />
        </TooltipWrapper>
        <div className="flex items-center h-7 rounded-lg border border-border/40 overflow-hidden shrink-0">
          {(["both", "tcp", "udp"] as const).map((m) => (
            <TooltipWrapper key={m} title={m === "both" ? "TCP + UDP" : m.toUpperCase()} description={m === "both" ? "Test each port on both TCP and UDP." : `Test ${m.toUpperCase()} only.`} side="bottom">
              <button onClick={() => setProtoMode(m)} disabled={running}
                className={cn("px-1.5 h-full section-label-sm transition-smooth",
                  protoMode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/30", running && "opacity-50 cursor-not-allowed"
                )}>{m === "both" ? "Both" : m.toUpperCase()}</button>
            </TooltipWrapper>
          ))}
        </div>
        <TooltipWrapper title="Run Port Scan" description={`Scan ${portCount} port${portCount !== 1 ? "s" : ""} on the target SIP server.`} side="bottom">
          <Button size="sm" className="h-7 gap-1 px-2.5 text-xs shrink-0" onClick={handleScan} disabled={!hasTarget || running || portCount === 0}>
            {running ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Search className="h-2.5 w-2.5" />} Scan
          </Button>
        </TooltipWrapper>
      </div>
      {result && !running && (
        <div className="flex flex-wrap gap-1">
          {result.results.map((r: PortTestResult, i: number) => {
            const pass = isPortPass(r.status);
            return (
              <TooltipWrapper key={i}
                title={r.status === "open_filtered" ? "Open | Filtered (UDP)" : r.status === "open" ? "Open" : r.status === "closed" ? "Closed" : "Filtered"}
                description={r.status === "open_filtered" ? "No ICMP reject — likely open. Normal for UDP." : r.status === "closed" ? "Connection refused." : r.status === "filtered" ? "No response — likely firewalled." : "Service is listening."}
              >
                <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-mono cursor-help",
                  pass ? "bg-success/10 text-success" : r.status === "closed" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
                )}>
                  {r.port}/{r.protocol.toUpperCase()}
                  {r.response_ms !== null && <span className="opacity-60">{r.response_ms.toFixed(0)}ms</span>}
                </span>
              </TooltipWrapper>
            );
          })}
        </div>
      )}
      {!result && !running && <p className="text-2xs text-muted-foreground/60">{protoMode === "both" ? "TCP + UDP" : protoMode.toUpperCase()} · {portCount} tests</p>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SIP DNS
// ═══════════════════════════════════════════════════════════════════

function SipDns() {
  const voipTarget = useNetworkTestStore((s) => s.voipTarget);
  const voipDns = useNetworkTestStore((s) => s.voipDns);
  const runVoipDns = useNetworkTestStore((s) => s.runVoipDns);
  const result = voipDns.result;
  const running = voipDns.status === "running";
  const hasTarget = voipTarget.trim().length > 0;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <SectionHeader icon={Globe} color="text-info" title="SIP DNS" />
          <TroubleshootLink articleId="dns-config-for-sip" compact />
        </div>
        <TooltipWrapper title="Run DNS Lookup" description="Resolve SRV, NAPTR, and A records for SIP routing on the target domain." side="bottom">
          <Button size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={() => runVoipDns()} disabled={!hasTarget || running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} Lookup
          </Button>
        </TooltipWrapper>
      </div>
      {result && !running && (
        <div className="space-y-1 text-xs">
          {result.a_records.map((ip, i) => (
            <div key={i} className="font-mono flex items-center gap-1.5"><Badge variant="secondary" className="text-3xs px-1 py-0 h-4">A</Badge> {ip}</div>
          ))}
          {result.srv_records.map((r, i) => (
            <div key={i} className="font-mono text-muted-foreground/70 truncate flex items-center gap-1.5"><Badge variant="secondary" className="text-3xs px-1 py-0 h-4">SRV</Badge> {r.target}:{r.port}</div>
          ))}
          {result.naptr_records.map((r, i) => (
            <div key={i} className="font-mono text-muted-foreground/70 truncate flex items-center gap-1.5"><Badge variant="secondary" className="text-3xs px-1 py-0 h-4">NAPTR</Badge> {r.replacement}</div>
          ))}
          {result.a_records.length === 0 && result.srv_records.length === 0 && (
            <EmptyState
              variant="inline"
              title="No SIP records found"
              description="No A, SRV, or NAPTR records were returned for this target."
              className="h-full min-h-0 p-4"
            />
          )}
          <p className="text-muted-foreground/60 tabular-nums">{result.resolution_ms.toFixed(0)} ms</p>
        </div>
      )}
      {!result && !running && <p className="text-2xs text-muted-foreground/60">SRV, NAPTR & A records for SIP routing.</p>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  NAT Info Card
// ═══════════════════════════════════════════════════════════════════

const NAT_INFO: Record<string, { severity: "ok" | "warn" | "fail"; summary: string; detail: string }> = {
  "No NAT": { severity: "ok", summary: "Direct Connection", detail: "No NAT detected — your device has a public IP. VoIP traffic flows directly without translation. This is the ideal configuration for SIP." },
  "Full Cone": { severity: "ok", summary: "Full Cone NAT", detail: "The most permissive NAT type. Any external host can send packets to your mapped address once a binding is created. VoIP works well with minimal STUN usage." },
  "Restricted Cone": { severity: "warn", summary: "Restricted Cone NAT", detail: "External hosts can only send packets if your device has previously sent to their IP. VoIP generally works but may require STUN for initial hole-punching." },
  "Port Restricted Cone": { severity: "warn", summary: "Port Restricted NAT", detail: "The strictest cone type — external hosts must match both IP and port. VoIP usually works with STUN, but some call setups may experience delays." },
  "Symmetric": { severity: "fail", summary: "Symmetric NAT", detail: "Each outbound connection gets a different external port mapping. STUN alone cannot traverse this — a TURN relay server is typically required for VoIP calls to connect reliably." },
};

function NatInfoCard() {
  const voipStun = useNetworkTestStore((s) => s.voipStun);
  const st = voipStun.result;
  if (!st) return null;

  const info = NAT_INFO[st.nat_type] ?? { severity: "warn", summary: st.nat_type, detail: "Unknown NAT type detected." };
  const colorMap = { ok: "border-success/30 bg-success/[0.04]", warn: "border-warning/30 bg-warning/[0.04]", fail: "border-destructive/30 bg-destructive/[0.04]" };
  const iconColor = { ok: "text-success", warn: "text-warning", fail: "text-destructive" };
  const dotColor = { ok: "bg-success", warn: "bg-warning", fail: "bg-destructive" };

  return (
    <div className={cn("ui-hero-metric px-4 py-3 flex items-start gap-3", colorMap[info.severity])}>
      <Info className={cn("h-4 w-4 shrink-0 mt-0.5", iconColor[info.severity])} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor[info.severity])} />
          <span className="text-xs font-semibold">{info.summary}</span>
          {st.public_ip && (
            <span className="text-2xs text-muted-foreground/60 font-mono ml-auto">
              {st.public_ip}{st.public_port ? `:${st.public_port}` : ""}
            </span>
          )}
        </div>
        <p className="text-2xs text-muted-foreground/60 leading-relaxed">{info.detail}</p>
        <div className="flex items-center gap-3 mt-1.5 text-2xs text-muted-foreground/60">
          <span className="font-mono">STUN: {st.stun_server}</span>
          {st.response_ms != null && <span className="tabular-nums">{st.response_ms.toFixed(0)} ms</span>}
          {st.local_ip && <span className="font-mono">Local: {st.local_ip}{st.local_port ? `:${st.local_port}` : ""}</span>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  QoS / DSCP
// ═══════════════════════════════════════════════════════════════════

function QosDscp() {
  const voipTarget = useNetworkTestStore((s) => s.voipTarget);
  const voipDscp = useNetworkTestStore((s) => s.voipDscp);
  const runVoipDscp = useNetworkTestStore((s) => s.runVoipDscp);
  const result = voipDscp.result;
  const running = voipDscp.status === "running";
  const hasTarget = voipTarget.trim().length > 0;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionHeader icon={Zap} color="text-warning" title="QoS / DSCP" />
        <TooltipWrapper title="Run DSCP Test" description="Send a packet with DSCP EF marking (Expedited Forwarding) to verify voice traffic prioritization on your network." side="bottom">
          <Button size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={() => runVoipDscp()} disabled={!hasTarget || running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Test
          </Button>
        </TooltipWrapper>
      </div>
      {result && !running && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tabular-nums">{result.dscp_sent}</span>
            <span className="text-xs text-muted-foreground/60">{result.dscp_name}</span>
            <span className={cn("text-xs font-medium ml-auto", result.packet_sent ? "text-success" : "text-destructive")}>
              {result.packet_sent ? "Sent OK" : "Failed"}
            </span>
          </div>
          <p className="text-2xs text-muted-foreground/60">
            {result.packet_sent ? "DSCP EF marking is working — voice packets will be prioritized." : "DSCP marking failed — voice traffic may not be prioritized on this network."}
          </p>
        </div>
      )}
      {!result && !running && <p className="text-2xs text-muted-foreground/60">DSCP EF marking for voice prioritization.</p>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  UDP Path Quality
// ═══════════════════════════════════════════════════════════════════

function UdpQuality() {
  const stunQuality = useNetworkTestStore((s) => s.stunQuality);
  const stunQualityPackets = useNetworkTestStore((s) => s.stunQualityPackets);
  const addStunQualityPacket = useNetworkTestStore((s) => s.addStunQualityPacket);
  const runStunQuality = useNetworkTestStore((s) => s.runStunQuality);
  const result = stunQuality.result;
  const running = stunQuality.status === "running";

  useEffect(() => {
    const unlisten = listen<StunQualityPacketEvent>("stun-quality-packet", (event) => addStunQualityPacket(event.payload));
    return () => { unlisten.then((fn) => fn()); };
  }, [addStunQualityPacket]);

  const latestPkt = stunQualityPackets.length > 0 ? stunQualityPackets[stunQualityPackets.length - 1] : null;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionHeader icon={Wifi} color="text-info" title="UDP Quality"
          badge={result && !running ? (
            <Badge variant="secondary" className={cn("text-2xs px-1.5 py-0",
              result.mos >= 4.0 ? "bg-success/10 text-success border-success/30" :
              result.mos >= 3.6 ? "bg-warning/10 text-warning border-warning/30" :
              "bg-destructive/10 text-destructive border-destructive/30"
            )}>MOS {result.mos.toFixed(2)}</Badge>
          ) : undefined}
        />
        <TooltipWrapper title="Run UDP Quality Test" description="Send 100 STUN probes at VoIP packet rates to measure real-world UDP path quality, jitter, and loss." side="bottom">
          <Button size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={() => runStunQuality()} disabled={running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Test
          </Button>
        </TooltipWrapper>
      </div>

      {running && latestPkt && (
        <>
          <div className="h-1 rounded-full bg-muted/20 overflow-hidden mb-2">
            <div className="h-full rounded-full bg-info transition-all duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]"
              style={{ width: `${((latestPkt.seq + 1) / latestPkt.total) * 100}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-x-3">
            <Stat label="RTT" value={`${latestPkt.running_avg_rtt_ms.toFixed(1)} ms`} />
            <Stat label="Jitter" value={`${latestPkt.running_jitter_ms.toFixed(1)} ms`} />
            <Stat label="MOS" value={latestPkt.running_mos.toFixed(2)} color={latestPkt.running_mos >= 4.0 ? "text-success" : latestPkt.running_mos >= 3.6 ? "text-warning" : "text-destructive"} />
          </div>
        </>
      )}

      {result && !running && (
        <div className="grid grid-cols-3 gap-x-3">
          <Stat label="RTT" value={`${result.avg_rtt_ms.toFixed(1)} ms`} />
          <Stat label="Jitter" value={`${result.avg_jitter_ms.toFixed(1)} ms`} />
          <Stat label="Loss" value={`${result.packet_loss_pct.toFixed(1)}%`}
            color={result.packet_loss_pct < 1 ? "text-success" : "text-destructive"} />
        </div>
      )}

      {!result && !running && <p className="text-2xs text-muted-foreground/60">100 STUN probes at VoIP rates.</p>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Codec Calculator
// ═══════════════════════════════════════════════════════════════════

interface CodecDef { name: string; bitrate_kbps: number; ptime_ms: number; ie: number; label: string; }
const CODECS: CodecDef[] = [
  { name: "G.711", bitrate_kbps: 64, ptime_ms: 20, ie: 0, label: "G.711" },
  { name: "G.729", bitrate_kbps: 8, ptime_ms: 20, ie: 11, label: "G.729" },
  { name: "G.722", bitrate_kbps: 64, ptime_ms: 20, ie: 7, label: "G.722" },
];
const HDR = 40;
function codecBw(c: CodecDef) { return ((c.bitrate_kbps * 1000 / 8) * (c.ptime_ms / 1000) + HDR) * (1000 / c.ptime_ms) * 8 / 1000; }
function eMos(lat: number, jit: number, loss: number, ie: number) {
  const d = lat / 2 + jit; const id = d > 177.3 ? 0.024 * d + 0.11 * (d - 177.3) : 0.024 * d;
  const ieEff = ie + (95 - ie) * (loss / (loss + 25)); const r = Math.max(0, Math.min(100, 93.2 - id - ieEff));
  return r <= 0 ? 1 : r >= 100 ? 4.5 : Math.max(1, Math.min(5, 1 + 0.035 * r + r * (r - 60) * (100 - r) * 7e-6));
}

function CodecCalc() {
  const voipPing = useNetworkTestStore((s) => s.voipPing);
  const speedTest = useNetworkTestStore((s) => s.speedTest);
  const [bwInput, setBwInput] = useState("");
  const ping = voipPing.result;
  const availBw = bwInput.trim() ? parseFloat(bwInput) * 1000 : speedTest.result ? speedTest.result.download_mbps * 1000 : null;
  const lat = ping?.avg_ms ?? 0;
  const jit = ping ? (calcJitter(ping.probes.filter((p) => p.rtt_ms !== null).map((p) => p.rtt_ms as number)) ?? 0) : 0;
  const loss = ping?.packet_loss_pct ?? 0;

  const data = useMemo(() => CODECS.map((c) => {
    const bw = codecBw(c); return { ...c, bw, maxCalls: availBw ? Math.floor(availBw / bw) : null, mos: ping ? eMos(lat, jit, loss, c.ie) : null };
  }), [availBw, lat, jit, loss, ping]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <SectionHeader icon={BarChart3} color="text-primary" title="Codecs" />
        <TooltipWrapper title="Bandwidth Override" description="Override available bandwidth (Mbps) for concurrent call calculations. Defaults to your internet speed test result." side="bottom">
          <Input value={bwInput} onChange={(e) => setBwInput(e.target.value)}
            placeholder={speedTest.result ? `${speedTest.result.download_mbps.toFixed(0)}` : "Mbps"}
            className="h-6 text-2xs w-16 text-center" type="number" />
        </TooltipWrapper>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="text-muted-foreground/60 border-b border-border/20">
          <th className="text-left font-medium pb-0.5">Codec</th>
          <th className="text-right font-medium pb-0.5">kbps</th>
          {availBw != null && <th className="text-right font-medium pb-0.5">Calls</th>}
          {ping && <th className="text-right font-medium pb-0.5">MOS</th>}
        </tr></thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.name} className="border-b border-border/20">
              <td className="py-0.5 font-medium">{c.label}</td>
              <td className="py-0.5 text-right tabular-nums font-mono text-muted-foreground/60">{c.bw.toFixed(0)}</td>
              {availBw != null && <td className="py-0.5 text-right tabular-nums font-mono">{c.maxCalls!}</td>}
              {ping && c.mos != null && (
                <td className={cn("py-0.5 text-right tabular-nums font-mono font-semibold",
                  c.mos >= 4.0 ? "text-success" : c.mos >= 3.6 ? "text-warning" : "text-destructive"
                )}>{c.mos.toFixed(2)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Jitter Buffer Sim
// ═══════════════════════════════════════════════════════════════════

const BUFS = [20, 40, 60, 80, 100, 150];

function JitterBuffer() {
  const voipPing = useNetworkTestStore((s) => s.voipPing);
  const stunQualityPackets = useNetworkTestStore((s) => s.stunQualityPackets);
  const probeRtts = useMemo(() => {
    if (stunQualityPackets.length > 0) return stunQualityPackets.map((p) => p.rtt_ms).filter((v): v is number => v !== null);
    if (voipPing.result) return voipPing.result.probes.map((p) => p.rtt_ms).filter((v): v is number => v !== null);
    return [];
  }, [stunQualityPackets, voipPing.result]);
  const networkLoss = voipPing.result?.packet_loss_pct ?? 0;

  const sim = useMemo(() => {
    if (probeRtts.length < 4) return null;
    const owds = probeRtts.map((r) => r / 2); const minO = Math.min(...owds); const rel = owds.map((d) => d - minO);
    return BUFS.map((buf) => {
      const latePct = (rel.filter((d) => d > buf).length / rel.length) * 100;
      const effLoss = Math.min(100, networkLoss + latePct);
      const accepted = owds.filter((_, i) => rel[i]! <= buf);
      const avg = accepted.length > 0 ? accepted.reduce((s, v) => s + v, 0) / accepted.length : owds.reduce((s, v) => s + v, 0) / owds.length;
      let jit = 0;
      if (accepted.length >= 2) { let s = 0; for (let i = 1; i < accepted.length; i++) s += Math.abs(accepted[i]! - accepted[i - 1]!); jit = s / (accepted.length - 1); }
      return { buf, latePct, effLoss, effLat: avg * 2 + buf, mos: eMos(avg * 2 + buf, jit, effLoss, 0) };
    });
  }, [probeRtts, networkLoss]);

  const best = sim ? sim.reduce((b, r) => r.mos > b.mos ? r : b, sim[0]!) : null;

  return (
    <Card>
      <SectionHeader icon={Timer} color="text-warning" title="Jitter Buffer" />
      {!sim && <p className="text-2xs text-muted-foreground/60">Run Call Quality or UDP test first.</p>}
      {sim && (
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground/60 border-b border-border/20">
            <th className="text-left font-medium pb-0.5">Buf</th>
            <th className="text-right font-medium pb-0.5">Late</th>
            <th className="text-right font-medium pb-0.5">Loss</th>
            <th className="text-right font-medium pb-0.5">MOS</th>
          </tr></thead>
          <tbody>
            {sim.map((r) => (
              <tr key={r.buf} className={cn("border-b border-border/20", best?.buf === r.buf && "bg-success/[0.04]")}>
                <td className="py-0.5 font-medium">{r.buf}ms{best?.buf === r.buf && <span className="text-3xs text-success ml-0.5">★</span>}</td>
                <td className="py-0.5 text-right tabular-nums font-mono text-muted-foreground/60">{r.latePct.toFixed(1)}%</td>
                <td className={cn("py-0.5 text-right tabular-nums font-mono",
                  r.effLoss < 1 ? "text-success" : r.effLoss < 3 ? "text-warning" : "text-destructive"
                )}>{r.effLoss.toFixed(1)}%</td>
                <td className={cn("py-0.5 text-right tabular-nums font-mono font-semibold",
                  r.mos >= 4.0 ? "text-success" : r.mos >= 3.6 ? "text-warning" : "text-destructive"
                )}>{r.mos.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  RTP Simulation
// ═══════════════════════════════════════════════════════════════════

function RtpSimTile({ target }: { target: string }) {
  const rtpSim = useNetworkTestStore((s) => s.rtpSim);
  const runRtpSim = useNetworkTestStore((s) => s.runRtpSim);
  const [port, setPort] = useState("");
  const [codec, setCodec] = useState("g711");
  const [ptime, setPtime] = useState("20");
  const [duration, setDuration] = useState("10");
  const r = rtpSim.result;
  const running = rtpSim.status === "running";

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <SectionHeader icon={PhoneCall} color="text-info" title="RTP Simulation" />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/60">
            <TooltipWrapper title="Port" description="UDP port for the RTP simulation. Leave blank for auto."><span className="cursor-help">Port</span></TooltipWrapper>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="auto" className="h-6 w-14 text-2xs text-center" type="number" />
            <TooltipWrapper title="Codec" description="Simulate voice stream with this codec's characteristics."><span className="cursor-help">Codec</span></TooltipWrapper>
            <select value={codec} onChange={(e) => setCodec(e.target.value)} className="h-6 text-2xs rounded border bg-background px-1.5">
              <option value="g711">G.711</option><option value="g729">G.729</option>
            </select>
            <TooltipWrapper title="Packet Time" description="Packetization interval in milliseconds. 20ms is standard for VoIP."><span className="cursor-help">ptime</span></TooltipWrapper>
            <Input value={ptime} onChange={(e) => setPtime(e.target.value)} className="h-6 w-10 text-2xs text-center" type="number" />
            <TooltipWrapper title="Duration" description="How long to run the simulated voice stream."><span className="cursor-help">Dur</span></TooltipWrapper>
            <Input value={duration} onChange={(e) => setDuration(e.target.value)} className="h-6 w-10 text-2xs text-center" type="number" />
            <span>sec</span>
          </div>
          <Button size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={() => runRtpSim(target, port ? parseInt(port) : undefined, parseInt(ptime) || 20, parseInt(duration) || 10, codec)} disabled={running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
          </Button>
        </div>
      </div>
      {r && !running && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-2">
            <MetricBox label="MOS" value={r.mos_estimate.toFixed(2)} color={r.mos_estimate >= 4.0 ? "emerald" : r.mos_estimate >= 3.6 ? "yellow" : "red"} />
            <MetricBox label="Jitter" value={r.avg_jitter_ms.toFixed(1)} unit="ms" color={r.avg_jitter_ms < 10 ? "emerald" : "yellow"} />
            <MetricBox label="Loss" value={r.packet_loss_pct.toFixed(1)} unit="%" color={r.packet_loss_pct < 1 ? "emerald" : "red"} />
            <MetricBox label="Latency" value={r.avg_latency_ms.toFixed(1)} unit="ms" />
          </div>
          <p className="text-2xs text-muted-foreground/60">{r.codec} · {r.packets_received}/{r.packets_sent} packets · {(r.duration_ms / 1000).toFixed(1)}s</p>
        </div>
      )}
      {!r && !running && <p className="text-2xs text-muted-foreground/60">Simulates a real voice stream to measure MOS, jitter, and loss under VoIP conditions.</p>}
      {rtpSim.error && <p className="text-xs text-destructive">{rtpSim.error}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SIP Probe
// ═══════════════════════════════════════════════════════════════════

const PROBE_METHODS: { value: ProbeMethod; label: string; desc: string }[] = [
  { value: "auto", label: "Auto", desc: "OPTIONS → REGISTER → TCP" },
  { value: "options", label: "OPT", desc: "SIP OPTIONS (UDP)" },
  { value: "register", label: "REG", desc: "SIP REGISTER (UDP)" },
  { value: "tcp", label: "TCP", desc: "TCP connect" },
];

function SipProbe() {
  const voipTarget = useNetworkTestStore((s) => s.voipTarget);
  const sipProbe = useNetworkTestStore((s) => s.sipProbe);
  const lastSource = useNetworkTestStore((s) => s.lastSource);
  const sipProbePackets = useNetworkTestStore((s) => s.sipProbePackets);
  const addSipProbePacket = useNetworkTestStore((s) => s.addSipProbePacket);
  const runSipProbe = useNetworkTestStore((s) => s.runSipProbe);
  const voipProbeMethod = useNetworkTestStore((s) => s.voipProbeMethod);
  const setVoipProbeMethod = useNetworkTestStore((s) => s.setVoipProbeMethod);
  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const probe = sipProbe.result;
  const isProbing = sipProbe.status === "running";
  const hasTarget = voipTarget.trim().length > 0;
  const isTcp = voipProbeMethod === "tcp" || probe?.method_used === "tcp";
  const feedRef = useRef<HTMLDivElement>(null);
  const ctx = resolvedContext("voip");
  const source = lastSource.sipProbe;
  const agentName =
    source?.source === "remote" ? resolvedAgentName("voip") ?? undefined : undefined;

  useEffect(() => {
    const unlisten = listen<SipProbePacketEvent>("sip-probe-packet", (event) => addSipProbePacket(event.payload));
    return () => { unlisten.then((fn) => fn()); };
  }, [addSipProbePacket]);

  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [sipProbePackets]);

  const latestPkt = sipProbePackets.length > 0 ? sipProbePackets[sipProbePackets.length - 1] : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <SectionHeader icon={PhoneCall} color="text-primary" title="SIP Probe"
          badge={<Badge variant="secondary" className="text-3xs px-1 py-0 text-muted-foreground/60 border-muted-foreground/15">Advanced</Badge>}
        />
        <div className="flex items-center gap-1">
          {PROBE_METHODS.map((m) => (
            <TooltipWrapper key={m.value} title={m.desc}>
              <button onClick={() => setVoipProbeMethod(m.value)} disabled={isProbing}
                className={cn("px-1.5 py-0.5 rounded text-3xs font-medium transition-smooth",
                  voipProbeMethod === m.value ? "bg-accent text-foreground" : "text-muted-foreground/60 hover:bg-muted/30",
                  isProbing && "opacity-50"
                )}>{m.label}</button>
            </TooltipWrapper>
          ))}
          <Button
            size="sm"
            className="h-6 gap-1 px-2 text-2xs ml-1"
            onClick={() => runSipProbe(undefined, undefined, undefined, ctx)}
            disabled={!hasTarget || isProbing}
          >
            {isProbing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />} Probe
          </Button>
        </div>
      </div>

      {isProbing && latestPkt && (
        <div className="h-1 rounded-full bg-muted/20 overflow-hidden mb-1">
          <div className="h-full rounded-full bg-primary transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]"
            style={{ width: `${((latestPkt.seq + 1) / latestPkt.total) * 100}%` }} />
        </div>
      )}

      {(isProbing || sipProbePackets.length > 0) && (
        <div ref={feedRef} className="max-h-32 overflow-y-auto rounded border border-border/20 text-2xs font-mono">
          <div className="sticky top-0 ui-hero-surface px-2 py-0.5 flex gap-2 section-label-sm border-b border-border/20">
            <span className="w-5 text-right">#</span>
            <span className="w-12">{isTcp ? "Conn" : "Resp"}</span>
            <span className="w-10 text-right">RTT</span>
            <span className="w-10 text-right">Avg</span>
            <span className="w-10 text-right">Jit</span>
            <span className="w-8 text-right">Loss</span>
          </div>
          {sipProbePackets.map((pkt) => (
            <div key={pkt.seq} className={cn("px-2 py-px flex gap-2", pkt.rtt_ms === null && "text-destructive/60")}>
              <span className="w-5 text-right text-muted-foreground/60">{pkt.seq + 1}</span>
              <span className="w-12">
                {pkt.status_code !== null ? (pkt.status_code === 0 ? <span className="text-success">OK</span> : <span>SIP {pkt.status_code}</span>) : <span className="text-destructive/70">--</span>}
              </span>
              <span className="w-10 text-right">{pkt.rtt_ms !== null ? pkt.rtt_ms.toFixed(1) : "—"}</span>
              <span className="w-10 text-right text-muted-foreground/60">{pkt.running_avg_rtt_ms > 0 ? pkt.running_avg_rtt_ms.toFixed(1) : "—"}</span>
              <span className="w-10 text-right text-muted-foreground/60">{pkt.running_jitter_ms > 0 ? pkt.running_jitter_ms.toFixed(1) : "—"}</span>
              <span className={cn("w-8 text-right", pkt.running_loss_pct > 3 ? "text-destructive" : "text-muted-foreground/60")}>{pkt.running_loss_pct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}

      {!isProbing && probe && (
        <div className="space-y-2 mt-1">
          {source && (
            <ResultSourceBadge source={source.source} agentName={agentName} />
          )}
          <div className="flex items-center gap-2 text-2xs text-muted-foreground/60">
          <span>{probe.method_used.toUpperCase()}</span>
          <span className="font-mono">{probe.resolved_ip}:{probe.port}</span>
          <Badge variant={probe.success ? "secondary" : "destructive"} className="text-3xs px-1 py-0">
            {probe.success ? `${probe.packets_received}/${probe.packets_sent}` : "No resp"}
          </Badge>
          {probe.success && (
            <span className="ml-auto tabular-nums font-mono">
              {probe.avg_latency_ms.toFixed(1)}ms · {probe.avg_jitter_ms.toFixed(1)}ms jit · {probe.packet_loss_pct.toFixed(1)}% loss
            </span>
          )}
        </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Shared utilities
// ═══════════════════════════════════════════════════════════════════

function calcJitter(rtts: number[]): number | null {
  if (rtts.length < 2) return null;
  let sum = 0; for (let i = 1; i < rtts.length; i++) sum += Math.abs(rtts[i]! - rtts[i - 1]!);
  return sum / (rtts.length - 1);
}

function getCodecRecs(latency: number, jitter: number, loss: number) {
  return [
    { name: "G.711", ok: latency < 150 && jitter < 20 && loss < 1, note: latency < 150 && jitter < 20 && loss < 1 ? "64k" : latency >= 150 ? "lat" : loss >= 1 ? "loss" : "jit" },
    { name: "G.729", ok: latency < 200 && jitter < 40 && loss < 3, note: latency < 200 && jitter < 40 && loss < 3 ? "8k" : "deg" },
  ];
}
