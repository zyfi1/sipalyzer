/**
 * Feeds Network Test / VoIP assessment results into the central troubleshooting timeline + findings.
 * Kept separate from troubleshootingStore to keep the store file smaller and to unit-test rules.
 */

import type {
  HealthCheckResult,
  PingResult,
  MosResult,
  PortScanResult,
  DnsResult,
  DscpResult,
  StunResult,
  TracerouteResult,
  JitterResult,
  PacketLossResult,
  SpeedTestResult,
  SipProbeResult,
  StunQualityResult,
} from "@/types/networkTest";
import type { ForensicFinding, ForensicsTimelineEntry } from "@/types/forensics";
import type { NetworkTestState } from "@/stores/networkTestStore";
import { VOIP_THRESHOLDS } from "@/lib/voipThresholds";

export interface Slice<T> {
  status: string;
  result: T | null;
  error: string | null;
}

/** Serializable slice of network test state for troubleshooting sync. */
export interface NetworkSyncPayload {
  voipTarget: string;
  healthCheck: Slice<HealthCheckResult>;
  voipPing: Slice<PingResult>;
  voipMos: Slice<MosResult>;
  voipPortScan: Slice<PortScanResult>;
  voipDns: Slice<DnsResult>;
  voipDscp: Slice<DscpResult>;
  voipStun: Slice<StunResult>;
  stunQuality: Slice<StunQualityResult>;
  sipProbe: Slice<SipProbeResult>;
  ping: Slice<PingResult>;
  dns: Slice<DnsResult>;
  traceroute: Slice<TracerouteResult>;
  portScan: Slice<PortScanResult>;
  jitterTest: Slice<JitterResult>;
  packetLossTest: Slice<PacketLossResult>;
  speedTest: Slice<SpeedTestResult>;
}

function pickSlice<T>(box: { status: string; result: T | null; error: string | null }): Slice<T> {
  return { status: box.status, result: box.result, error: box.error };
}

/** Build payload from zustand network test store state (omit high-churn monitor / packet streams). */
export function buildNetworkSyncPayload(state: NetworkTestState): NetworkSyncPayload {
  return {
    voipTarget: state.voipTarget ?? "",
    healthCheck: pickSlice(state.healthCheck),
    voipPing: pickSlice(state.voipPing),
    voipMos: pickSlice(state.voipMos),
    voipPortScan: pickSlice(state.voipPortScan),
    voipDns: pickSlice(state.voipDns),
    voipDscp: pickSlice(state.voipDscp),
    voipStun: pickSlice(state.voipStun),
    stunQuality: pickSlice(state.stunQuality),
    sipProbe: pickSlice(state.sipProbe),
    ping: pickSlice(state.ping),
    dns: pickSlice(state.dns),
    traceroute: pickSlice(state.traceroute),
    portScan: pickSlice(state.portScan),
    jitterTest: pickSlice(state.jitterTest),
    packetLossTest: pickSlice(state.packetLossTest),
    speedTest: pickSlice(state.speedTest),
  };
}

/**
 * Compact signature of completed / failed tests only — avoids thrashing sync on monitor samples etc.
 */
export function networkStoreSignature(state: NetworkTestState): string {
  const p = buildNetworkSyncPayload(state);
  const sig = (s: Slice<unknown>) => `${s.status}:${s.error ?? ""}`;
  const res = <T,>(s: Slice<T>, key: keyof T | "len") => {
    if (s.status !== "done" && s.status !== "error") return "";
    if (s.status === "error") return "err";
    const r = s.result as Record<string, unknown> | null;
    if (!r) return "ok";
    if (key === "len" && Array.isArray(r.results)) return String((r.results as unknown[]).length);
    const v = r[key as string];
    return v === undefined || v === null ? "" : String(v);
  };
  return [
    p.voipTarget,
    sig(p.healthCheck),
    p.healthCheck.result?.internet_reachable,
    sig(p.voipPing),
    res(p.voipPing, "avg_ms"),
    sig(p.voipMos),
    res(p.voipMos, "mos"),
    sig(p.voipPortScan),
    res(p.voipPortScan, "len"),
    sig(p.voipDns),
    sig(p.voipDscp),
    sig(p.voipStun),
    sig(p.stunQuality),
    res(p.stunQuality, "mos"),
    sig(p.sipProbe),
    sig(p.ping),
    res(p.ping, "packet_loss_pct"),
    sig(p.dns),
    sig(p.traceroute),
    sig(p.portScan),
    sig(p.jitterTest),
    sig(p.packetLossTest),
    sig(p.speedTest),
  ].join("|");
}

function netLink(subview: string, label?: string): ForensicFinding["link"] {
  return { type: "network", id: subview, label };
}

function sipPortReachability(r: PortScanResult): { open: number; checked: number } {
  const ports = new Set([5060, 5061, 8443]);
  const relevant = r.results.filter((x) => ports.has(x.port));
  const open = relevant.filter((x) => x.status === "open").length;
  return { open, checked: relevant.length };
}

const MEDIUM = 0.65;
const HIGH = 0.85;

export function buildNetworkTimelineAndFindings(
  payload: NetworkSyncPayload,
  atIso: string,
): { timeline: ForensicsTimelineEntry[]; findings: ForensicFinding[] } {
  const timeline: ForensicsTimelineEntry[] = [];
  const findings: ForensicFinding[] = [];
  const target = payload.voipTarget.trim() || "VoIP target";

  const pushTimeline = (
    id: string,
    label: string,
    detail: string | undefined,
    success: boolean | undefined,
  ) => {
    timeline.push({
      id,
      timestamp: atIso,
      kind: "network_test",
      label,
      detail,
      success,
    });
  };

  // ── Health check ─────────────────────────────────────────────
  if (payload.healthCheck.status === "done" && payload.healthCheck.result) {
    const h = payload.healthCheck.result;
    const ok = h.internet_reachable !== false;
    pushTimeline(
      "net-health",
      "Network health check",
      [
        h.internet_reachable ? "Internet OK" : "No internet",
        h.gateway_reachable === false ? "Gateway unreachable" : null,
        h.avg_latency_ms != null ? `${h.avg_latency_ms.toFixed(0)}ms avg` : null,
        h.packet_loss_pct != null ? `${h.packet_loss_pct.toFixed(1)}% loss` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      ok,
    );
    if (!h.internet_reachable) {
      findings.push({
        id: "net-find-no-internet",
        severity: "critical",
        title: "Internet unreachable",
        description:
          "The network health check could not verify internet reachability. VoIP and registration will fail until connectivity is restored.",
        confidenceLevel: "high",
        confidenceScore: HIGH,
        uncertaintyState: "certain",
        timestamp: atIso,
        link: netLink("speed", "Speed / health"),
      });
    }
    if (h.packet_loss_pct != null && h.packet_loss_pct >= VOIP_THRESHOLDS.packetLoss.criticalAbove) {
      findings.push({
        id: "net-find-health-loss",
        severity: "warning",
        title: "High packet loss on health check path",
        description: `Observed ${h.packet_loss_pct.toFixed(1)}% loss during the overview health check. Expect MOS and call quality issues.`,
        confidenceLevel: "medium",
        confidenceScore: MEDIUM,
        uncertaintyState: "uncertain",
        uncertaintyReasons: [
          {
            code: "insufficient-evidence",
            message: "Loss on the health-check path may not match the path to your SIP provider.",
          },
        ],
        timestamp: atIso,
        link: netLink("ping", "Ping / path"),
      });
    }
  } else if (payload.healthCheck.status === "error") {
    pushTimeline("net-health", "Network health check", payload.healthCheck.error ?? "Failed", false);
  }

  // ── VoIP assessment pieces ───────────────────────────────────
  if (payload.voipMos.status === "done" && payload.voipMos.result) {
    const m = payload.voipMos.result;
    const poor = m.mos < VOIP_THRESHOLDS.mos.warnBelow;
    pushTimeline(
      "net-voip-mos",
      `VoIP MOS · ${target}`,
      `MOS ${m.mos.toFixed(2)} · ${m.quality}`,
      !poor,
    );
    if (poor) {
      findings.push({
        id: "net-find-voip-mos",
        severity: "warning",
        title: "VoIP MOS below acceptable threshold",
        description: `MOS ${m.mos.toFixed(2)} for ${target} (latency ${m.latency_ms.toFixed(0)}ms, jitter ${m.jitter_ms.toFixed(1)}ms, loss ${m.packet_loss_pct.toFixed(1)}%).`,
        confidenceLevel: "high",
        confidenceScore: HIGH,
        uncertaintyState: "certain",
        timestamp: atIso,
        link: netLink("voip", "VoIP assessment"),
      });
    }
  } else if (payload.voipMos.status === "error") {
    pushTimeline("net-voip-mos", `VoIP MOS · ${target}`, payload.voipMos.error ?? "Failed", false);
  }

  if (payload.voipPortScan.status === "done" && payload.voipPortScan.result) {
    const r = payload.voipPortScan.result;
    const { open, checked } = sipPortReachability(r);
    pushTimeline(
      "net-voip-ports",
      `SIP ports · ${r.host}`,
      checked ? `${open}/${checked} key ports open` : `${r.results.length} ports scanned`,
      open > 0 || checked === 0,
    );
    if (checked > 0 && open === 0) {
      findings.push({
        id: "net-find-sip-ports-closed",
        severity: "critical",
        title: "No standard SIP ports reachable",
        description: `TCP/UDP checks to 5060/5061/8443 on ${r.host} found no open SIP/WSS path. Registration and calling cannot work until firewall or provider reachability is fixed.`,
        confidenceLevel: "high",
        confidenceScore: HIGH,
        uncertaintyState: "uncertain",
        uncertaintyReasons: [
          {
            code: "insufficient-evidence",
            message: "Some environments use non-standard ports only — confirm expected ports with your provider.",
          },
        ],
        timestamp: atIso,
        link: netLink("voip", "VoIP assessment"),
      });
    }
  } else if (payload.voipPortScan.status === "error") {
    pushTimeline(
      "net-voip-ports",
      `SIP ports · ${target}`,
      payload.voipPortScan.error ?? "Failed",
      false,
    );
  }

  if (payload.voipDns.status === "done" && payload.voipDns.result) {
    const d = payload.voipDns.result;
    const hasRecords =
      d.a_records.length > 0 ||
      d.aaaa_records.length > 0 ||
      d.srv_records.length > 0 ||
      d.naptr_records.length > 0;
    pushTimeline(
      "net-voip-dns",
      `DNS · ${d.domain}`,
      hasRecords
        ? `${d.a_records.length} A · ${d.srv_records.length} SRV`
        : "No A/AAAA/SRV/NAPTR",
      hasRecords,
    );
    if (!hasRecords) {
      findings.push({
        id: "net-find-voip-dns-empty",
        severity: "warning",
        title: "DNS returned no usable records for VoIP target",
        description: `Lookup for ${d.domain} returned no A, AAAA, SRV, or NAPTR records. SIP URIs that depend on DNS will fail.`,
        confidenceLevel: "medium",
        confidenceScore: MEDIUM,
        uncertaintyState: "uncertain",
        uncertaintyReasons: [
          {
            code: "insufficient-evidence",
            message: "You may be using a raw IP or hosts file; DNS empty is only a problem if the phone uses this hostname.",
          },
        ],
        timestamp: atIso,
        link: netLink("voip", "VoIP assessment"),
      });
    }
  } else if (payload.voipDns.status === "error") {
    pushTimeline("net-voip-dns", `DNS · ${target}`, payload.voipDns.error ?? "Failed", false);
  }

  if (payload.voipStun.status === "done" && payload.voipStun.result) {
    const s = payload.voipStun.result;
    pushTimeline(
      "net-voip-stun",
      `STUN · ${s.stun_server}`,
      s.public_ip ? `Public ${s.public_ip} · ${s.nat_type}` : s.nat_type,
      s.success,
    );
  } else if (payload.voipStun.status === "error") {
    pushTimeline("net-voip-stun", "STUN", payload.voipStun.error ?? "Failed", false);
  }

  if (payload.stunQuality.status === "done" && payload.stunQuality.result) {
    const q = payload.stunQuality.result;
    const poor = q.mos < VOIP_THRESHOLDS.mos.warnBelow;
    pushTimeline(
      "net-stun-quality",
      `UDP/STUN quality · ${q.server}`,
      `MOS ${q.mos.toFixed(2)} · ${q.packet_loss_pct.toFixed(1)}% loss`,
      !poor,
    );
    if (poor) {
      findings.push({
        id: "net-find-stun-quality",
        severity: "warning",
        title: "UDP voice-path quality looks poor (STUN probe)",
        description: `MOS ${q.mos.toFixed(2)}, loss ${q.packet_loss_pct.toFixed(1)}%, jitter ${q.avg_jitter_ms.toFixed(1)}ms to ${q.server}.`,
        confidenceLevel: "medium",
        confidenceScore: MEDIUM,
        uncertaintyState: "uncertain",
        uncertaintyReasons: [
          {
            code: "insufficient-evidence",
            message: "STUN path ≠ your RTP path to carrier, but UDP impairment often correlates.",
          },
        ],
        timestamp: atIso,
        link: netLink("voip", "VoIP assessment"),
      });
    }
  } else if (payload.stunQuality.status === "error") {
    pushTimeline("net-stun-quality", "STUN quality", payload.stunQuality.error ?? "Failed", false);
  }

  if (payload.sipProbe.status === "done" && payload.sipProbe.result) {
    const sp = payload.sipProbe.result;
    pushTimeline(
      "net-sip-probe",
      `SIP probe · ${sp.host}:${sp.port}`,
      sp.success
        ? `${sp.packets_received}/${sp.packets_sent} replies · loss ${sp.packet_loss_pct.toFixed(1)}%`
        : sp.error ?? "Failed",
      sp.success,
    );
    if (!sp.success || sp.packet_loss_pct >= VOIP_THRESHOLDS.packetLoss.warnAbove) {
      findings.push({
        id: "net-find-sip-probe",
        severity: sp.success ? "warning" : "critical",
        title: sp.success ? "SIP probe reports high loss or degraded responses" : "SIP probe failed",
        description: sp.success
          ? `Loss ${sp.packet_loss_pct.toFixed(1)}% toward ${sp.host}:${sp.port} (${sp.method_used}).`
          : `${sp.error ?? "No SIP response"} (${sp.host}:${sp.port}).`,
        confidenceLevel: "medium",
        confidenceScore: MEDIUM,
        uncertaintyState: "uncertain",
        timestamp: atIso,
        link: netLink("voip", "VoIP assessment"),
      });
    }
  } else if (payload.sipProbe.status === "error") {
    pushTimeline("net-sip-probe", "SIP probe", payload.sipProbe.error ?? "Failed", false);
  }

  if (payload.voipPing.status === "done" && payload.voipPing.result) {
    const p = payload.voipPing.result;
    const lossy = p.packet_loss_pct >= VOIP_THRESHOLDS.packetLoss.warnAbove;
    pushTimeline(
      "net-voip-ping",
      `VoIP ping · ${p.host}`,
      `${p.avg_ms.toFixed(1)}ms avg · ${p.packet_loss_pct.toFixed(1)}% loss`,
      !lossy,
    );
  } else if (payload.voipPing.status === "error") {
    pushTimeline("net-voip-ping", `VoIP ping · ${target}`, payload.voipPing.error ?? "Failed", false);
  }

  // ── General tools (user-initiated) ───────────────────────────
  if (payload.ping.status === "done" && payload.ping.result) {
    const p = payload.ping.result;
    pushTimeline(
      "net-ping",
      `Ping · ${p.host}`,
      `${p.avg_ms.toFixed(1)}ms avg · ${p.packet_loss_pct.toFixed(1)}% loss`,
      p.packet_loss_pct < VOIP_THRESHOLDS.packetLoss.criticalAbove,
    );
  } else if (payload.ping.status === "error") {
    pushTimeline("net-ping", "Ping", payload.ping.error ?? "Failed", false);
  }

  if (payload.dns.status === "done" && payload.dns.result) {
    const d = payload.dns.result;
    const n =
      d.a_records.length +
      d.aaaa_records.length +
      d.srv_records.length +
      d.naptr_records.length;
    pushTimeline("net-dns", `DNS · ${d.domain}`, `${n} record(s)`, n > 0);
  } else if (payload.dns.status === "error") {
    pushTimeline("net-dns", "DNS lookup", payload.dns.error ?? "Failed", false);
  }

  if (payload.traceroute.status === "done" && payload.traceroute.result) {
    const t = payload.traceroute.result;
    pushTimeline(
      "net-trace",
      `Traceroute · ${t.host}`,
      t.reached_destination ? "Reached target" : `${t.hops.length} hops`,
      t.success,
    );
  } else if (payload.traceroute.status === "error") {
    pushTimeline("net-trace", "Traceroute", payload.traceroute.error ?? "Failed", false);
  }

  if (payload.portScan.status === "done" && payload.portScan.result) {
    const ps = payload.portScan.result;
    const open = ps.results.filter((x) => x.status === "open").length;
    pushTimeline("net-ports", `Port scan · ${ps.host}`, `${open}/${ps.results.length} open`, open > 0);
  } else if (payload.portScan.status === "error") {
    pushTimeline("net-ports", "Port scan", payload.portScan.error ?? "Failed", false);
  }

  if (payload.jitterTest.status === "done" && payload.jitterTest.result) {
    const j = payload.jitterTest.result;
    const bad = j.avg_jitter_ms >= VOIP_THRESHOLDS.jitter.warnAbove;
    pushTimeline(
      "net-jitter",
      `Jitter · ${j.host}`,
      `${j.avg_jitter_ms.toFixed(1)}ms avg · ${j.packet_loss_pct.toFixed(1)}% loss`,
      !bad,
    );
    if (bad) {
      findings.push({
        id: "net-find-jitter",
        severity: "warning",
        title: "Elevated jitter on test path",
        description: `Average jitter ${j.avg_jitter_ms.toFixed(1)}ms to ${j.host} with ${j.packet_loss_pct.toFixed(1)}% loss.`,
        confidenceLevel: "medium",
        confidenceScore: MEDIUM,
        uncertaintyState: "uncertain",
        timestamp: atIso,
        link: netLink("ping", "Network tests"),
      });
    }
  } else if (payload.jitterTest.status === "error") {
    pushTimeline("net-jitter", "Jitter test", payload.jitterTest.error ?? "Failed", false);
  }

  if (payload.packetLossTest.status === "done" && payload.packetLossTest.result) {
    const pl = payload.packetLossTest.result;
    const bad = pl.loss_pct >= VOIP_THRESHOLDS.packetLoss.warnAbove;
    pushTimeline(
      "net-ploss",
      `Packet loss · ${pl.host}`,
      `${pl.loss_pct.toFixed(1)}% loss`,
      !bad,
    );
    if (bad) {
      findings.push({
        id: "net-find-ploss",
        severity: "warning",
        title: "High packet loss on UDP test",
        description: `${pl.loss_pct.toFixed(1)}% loss to ${pl.host} (${pl.packets_received}/${pl.packets_sent} packets).`,
        confidenceLevel: "medium",
        confidenceScore: MEDIUM,
        uncertaintyState: "uncertain",
        timestamp: atIso,
        link: netLink("ping", "Network tests"),
      });
    }
  } else if (payload.packetLossTest.status === "error") {
    pushTimeline("net-ploss", "Packet loss test", payload.packetLossTest.error ?? "Failed", false);
  }

  if (payload.speedTest.status === "done" && payload.speedTest.result) {
    const sp = payload.speedTest.result;
    pushTimeline(
      "net-speed",
      "Speed test",
      `${sp.download_mbps.toFixed(1)}↓ ${sp.upload_mbps.toFixed(1)}↑ Mbps · ${sp.latency_ms.toFixed(0)}ms`,
      sp.success,
    );
  } else if (payload.speedTest.status === "error") {
    pushTimeline("net-speed", "Speed test", payload.speedTest.error ?? "Failed", false);
  }

  if (payload.voipDscp.status === "done" && payload.voipDscp.result) {
    const d = payload.voipDscp.result;
    pushTimeline(
      "net-voip-dscp",
      `DSCP · ${d.host}`,
      d.success ? `${d.dscp_name} (${d.dscp_sent})` : d.error ?? "Failed",
      d.success,
    );
  } else if (payload.voipDscp.status === "error") {
    pushTimeline("net-voip-dscp", "DSCP test", payload.voipDscp.error ?? "Failed", false);
  }

  return { timeline, findings };
}
