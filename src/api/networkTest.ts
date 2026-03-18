/**
 * Network Test API — typed wrappers for all network testing backend commands.
 */

import { invokeTauri } from "./invoke";
import type {
  HealthCheckResult,
  NetworkCapabilityReport,
  PingResult,
  JitterResult,
  PacketLossResult,
  BandwidthResult,
  MosResult,
  TracerouteResult,
  MtrResult,
  MtuResult,
  DscpResult,
  PortTestEntry,
  PortScanResult,
  PortProtocol,
  DnsResult,
  StunResult,
  TurnResult,
  RtpSimResult,
  NetInfoResult,
  WifiInfo,
  SipProbeResult,
  ProbeMethod,
  StunQualityResult,
  SpeedTestResult,
  NtpCheckResult,
  NatDetectResult,
  SnmpPollResult,
} from "@/types/networkTest";

// ── Health Check ────────────────────────────────────────────────

export async function networkHealthCheck(): Promise<HealthCheckResult> {
  return invokeTauri<HealthCheckResult>("network_health_check");
}

export async function networkGetCapabilities(): Promise<NetworkCapabilityReport> {
  return invokeTauri<NetworkCapabilityReport>("network_get_capabilities");
}

// ── Ping / Latency ──────────────────────────────────────────────

export async function networkPing(
  host: string,
  count?: number,
  timeoutMs?: number
): Promise<PingResult> {
  return invokeTauri<PingResult>("network_ping", {
    host,
    count: count ?? null,
    timeoutMs: timeoutMs ?? null,
  });
}

export async function networkStopPing(): Promise<void> {
  return invokeTauri<void>("network_stop_ping");
}

export async function networkJitter(
  host: string,
  port?: number,
  packetCount?: number,
  intervalMs?: number
): Promise<JitterResult> {
  return invokeTauri<JitterResult>("network_jitter", {
    host,
    port: port ?? null,
    packetCount: packetCount ?? null,
    intervalMs: intervalMs ?? null,
  });
}

export async function networkPacketLoss(
  host: string,
  port?: number,
  burstSize?: number
): Promise<PacketLossResult> {
  return invokeTauri<PacketLossResult>("network_packet_loss", {
    host,
    port: port ?? null,
    burstSize: burstSize ?? null,
  });
}

export async function networkBandwidth(
  host: string,
  port?: number,
  durationSecs?: number
): Promise<BandwidthResult> {
  return invokeTauri<BandwidthResult>("network_bandwidth", {
    host,
    port: port ?? null,
    durationSecs: durationSecs ?? null,
  });
}

export async function networkCalculateMos(
  latencyMs: number,
  jitterMs: number,
  packetLossPct: number,
  codecIe?: number
): Promise<MosResult> {
  return invokeTauri<MosResult>("network_calculate_mos", {
    latencyMs,
    jitterMs,
    packetLossPct,
    codecIe: codecIe ?? null,
  });
}

// ── SIP Probe (VoIP-aware latency/jitter/loss) ─────────────────

export async function networkSipProbe(
  host: string,
  port?: number,
  count?: number,
  intervalMs?: number,
  method?: ProbeMethod
): Promise<SipProbeResult> {
  return invokeTauri<SipProbeResult>("network_sip_probe", {
    host,
    port: port ?? null,
    count: count ?? null,
    intervalMs: intervalMs ?? null,
    method: method ?? null,
  });
}

// ── Path Analysis ───────────────────────────────────────────────

export async function networkTraceroute(
  host: string,
  maxHops?: number,
  timeoutMs?: number
): Promise<TracerouteResult> {
  return invokeTauri<TracerouteResult>("network_traceroute", {
    host,
    maxHops: maxHops ?? null,
    timeoutMs: timeoutMs ?? null,
  });
}

export async function networkStopTraceroute(): Promise<void> {
  return invokeTauri<void>("network_stop_traceroute");
}

export async function networkMtuDiscovery(host: string): Promise<MtuResult> {
  return invokeTauri<MtuResult>("network_mtu_discovery", { host });
}

export async function networkDscpTest(
  host: string,
  port?: number,
  dscpValue?: number
): Promise<DscpResult> {
  return invokeTauri<DscpResult>("network_dscp_test", {
    host,
    port: port ?? null,
    dscpValue: dscpValue ?? null,
  });
}

// ── Connectivity ────────────────────────────────────────────────

export async function networkPortScan(
  host: string,
  entries: PortTestEntry[],
  timeoutMs?: number,
  concurrency?: number
): Promise<PortScanResult> {
  return invokeTauri<PortScanResult>("network_port_scan", {
    host,
    entries,
    timeoutMs: timeoutMs ?? null,
    concurrency: concurrency ?? null,
  });
}

export async function networkGetVoipPortPresets(): Promise<
  [string, PortTestEntry[]][]
> {
  return invokeTauri<[string, PortTestEntry[]][]>(
    "network_get_voip_port_presets"
  );
}

export async function networkExpandPortRange(
  range: string,
  protocol: PortProtocol,
  label?: string
): Promise<PortTestEntry[]> {
  return invokeTauri<PortTestEntry[]>("network_expand_port_range", {
    range,
    protocol,
    label: label ?? null,
  });
}

export async function networkDnsLookup(domain: string): Promise<DnsResult> {
  return invokeTauri<DnsResult>("network_dns_lookup", { domain });
}

export async function networkStunTest(
  stunServer?: string,
  stunPort?: number
): Promise<StunResult> {
  return invokeTauri<StunResult>("network_stun_test", {
    stunServer: stunServer ?? null,
    stunPort: stunPort ?? null,
  });
}

export async function networkTurnTest(
  server: string,
  port?: number,
  username?: string,
  password?: string
): Promise<TurnResult> {
  return invokeTauri<TurnResult>("network_turn_test", {
    server,
    port: port ?? null,
    username: username ?? null,
    password: password ?? null,
  });
}

// ── STUN Quality Probe ──────────────────────────────────────────

export async function networkStunQuality(
  server?: string,
  port?: number,
  count?: number,
  intervalMs?: number
): Promise<StunQualityResult> {
  return invokeTauri<StunQualityResult>("network_stun_quality", {
    server: server ?? null,
    port: port ?? null,
    count: count ?? null,
    intervalMs: intervalMs ?? null,
  });
}

// ── Speed Test ──────────────────────────────────────────────────

export async function networkSpeedTest(source?: string): Promise<SpeedTestResult> {
  return invokeTauri<SpeedTestResult>("network_speed_test", {
    source: source ?? null,
  });
}

// ── Monitor ─────────────────────────────────────────────────────

export async function networkStartMonitor(
  host: string,
  durationSecs?: number,
  intervalMs?: number
): Promise<void> {
  return invokeTauri<void>("network_start_monitor", {
    host,
    durationSecs: durationSecs ?? null,
    intervalMs: intervalMs ?? null,
  });
}

export async function networkStopMonitor(): Promise<void> {
  return invokeTauri<void>("network_stop_monitor");
}

export async function networkIsMonitorRunning(): Promise<boolean> {
  return invokeTauri<boolean>("network_is_monitor_running");
}

export async function networkRtpSimulation(
  host: string,
  port?: number,
  ptimeMs?: number,
  durationSecs?: number,
  codec?: string
): Promise<RtpSimResult> {
  return invokeTauri<RtpSimResult>("network_rtp_simulation", {
    host,
    port: port ?? null,
    ptimeMs: ptimeMs ?? null,
    durationSecs: durationSecs ?? null,
    codec: codec ?? null,
  });
}

// ── Environment ─────────────────────────────────────────────────

export async function networkGetInterfaces(): Promise<NetInfoResult> {
  return invokeTauri<NetInfoResult>("network_get_interfaces");
}

export async function networkGetWifiInfo(): Promise<WifiInfo> {
  return invokeTauri<WifiInfo>("network_get_wifi_info");
}

// ── MTR (Continuous Traceroute) ─────────────────────────────────

export async function networkMtr(
  host: string,
  maxHops?: number,
  rounds?: number,
  intervalMs?: number,
  timeoutMs?: number
): Promise<MtrResult> {
  return invokeTauri<MtrResult>("network_mtr", {
    host,
    maxHops: maxHops ?? null,
    rounds: rounds ?? null,
    intervalMs: intervalMs ?? null,
    timeoutMs: timeoutMs ?? null,
  });
}

export async function networkStopMtr(): Promise<void> {
  return invokeTauri<void>("network_stop_mtr");
}

// ── NTP / Time Sync Check ───────────────────────────────────────

export async function networkNtpCheck(
  servers?: string[],
  timeoutMs?: number
): Promise<NtpCheckResult> {
  return invokeTauri<NtpCheckResult>("network_ntp_check", {
    servers: servers ?? null,
    timeoutMs: timeoutMs ?? null,
  });
}

// ── NAT / ALG Detection ────────────────────────────────────────

export async function networkNatDetect(
  stunServer?: string,
  stunPort?: number
): Promise<NatDetectResult> {
  return invokeTauri<NatDetectResult>("network_nat_detect", {
    stunServer: stunServer ?? null,
    stunPort: stunPort ?? null,
  });
}

// ── SNMP Poller ─────────────────────────────────────────────────

export async function networkSnmpPoll(
  host: string,
  community?: string,
  version?: number,
  v3?: {
    username?: string;
    authPassword?: string;
    privPassword?: string;
    securityLevel?: "noAuthNoPriv" | "authNoPriv" | "authPriv";
    authProtocol?: "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512";
    privacyProtocol?: "des" | "aes128" | "aes192" | "aes256";
  },
): Promise<SnmpPollResult> {
  return invokeTauri<SnmpPollResult>("network_snmp_poll", {
    host,
    community: community ?? null,
    version: version ?? null,
    v3Username: v3?.username ?? null,
    v3AuthPassword: v3?.authPassword ?? null,
    v3PrivPassword: v3?.privPassword ?? null,
    v3SecurityLevel: v3?.securityLevel ?? null,
    v3AuthProtocol: v3?.authProtocol ?? null,
    v3PrivacyProtocol: v3?.privacyProtocol ?? null,
  });
}
