/**
 * Result normalizers: map remote agent JSON responses to the TypeScript
 * types used by local tool stores.
 *
 * Agent results arrive as `unknown` (JSON from Go). These functions
 * safely extract and map fields to the expected local types.
 */

import type {
  PingResult,
  TracerouteResult,
  PortScanResult,
  DnsResult,
} from "@/types/networkTest";
import type {
  JoinResult,
  IgmpQueryResult,
  SnoopingVerifyResult,
  SendTestResult,
} from "@/types/multicast";

// ── Helpers ─────────────────────────────────────────────────────

function asAny(data: unknown): Record<string, any> {
  return (data ?? {}) as Record<string, any>;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function maybeStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ── Ping ────────────────────────────────────────────────────────

export function normalizePingResult(data: unknown): PingResult {
  const d = asAny(data);
  const probes = arr(d.probes).map((p: any) => ({
    seq: num(p?.seq),
    rtt_ms: num(p?.rtt_ms),
    success: bool(p?.success),
    error: p?.error ?? null,
  }));
  return {
    host: str(d.host),
    resolved_ip: str(d.resolved_ip || d.ip),
    probes,
    min_ms: num(d.min_ms),
    max_ms: num(d.max_ms),
    avg_ms: num(d.avg_ms),
    stddev_ms: num(d.stddev_ms),
    packet_loss_pct: num(d.packet_loss_pct),
    success: bool(d.success, true),
    error: d.error ?? null,
  };
}

// ── Traceroute ──────────────────────────────────────────────────

export function normalizeTracerouteResult(data: unknown): TracerouteResult {
  const d = asAny(data);
  const hops = arr(d.hops).map((h: any) => {
    const rttArr = Array.isArray(h?.rtt_ms) ? h.rtt_ms : [h?.rtt_ms ?? null];
    const validRtts = rttArr.filter((v: any) => v != null && !isNaN(Number(v)));
    const avgRtt = validRtts.length > 0
      ? validRtts.reduce((a: number, b: number) => a + b, 0) / validRtts.length
      : null;
    return {
      hop: num(h?.hop),
      ip: h?.ip || h?.addr || null,
      hostname: h?.hostname ?? null,
      rtt_ms: rttArr as (number | null)[],
      avg_rtt_ms: avgRtt,
    };
  });
  return {
    host: str(d.host),
    resolved_ip: str(d.resolved_ip || d.ip),
    hops,
    reached_destination: bool(d.reached_destination),
    success: bool(d.success, true),
    error: d.error ?? null,
  };
}

// ── DNS ─────────────────────────────────────────────────────────

export function normalizeDnsResult(data: unknown): DnsResult {
  const d = asAny(data);
  return {
    domain: str(d.domain || d.hostname),
    srv_records: arr(d.srv_records).map((r: any) => ({
      service: str(r?.service),
      target: str(r?.target),
      port: num(r?.port),
      priority: num(r?.priority),
      weight: num(r?.weight),
    })),
    naptr_records: arr(d.naptr_records).map((r: any) => ({
      order: num(r?.order),
      preference: num(r?.preference),
      flags: str(r?.flags),
      service: str(r?.service),
      regexp: str(r?.regexp),
      replacement: str(r?.replacement),
    })),
    a_records: arr(d.a_records).map((r: any) => str(r)),
    aaaa_records: arr(d.aaaa_records).map((r: any) => str(r)),
    resolution_ms: num(d.resolution_ms || d.elapsed_ms),
    success: bool(d.success, true),
    error: d.error ?? null,
  };
}

// ── Port Scan ───────────────────────────────────────────────────

export function normalizePortScanResult(data: unknown): PortScanResult {
  const d = asAny(data);
  const results = arr(d.results || d.ports).map((r: any) => ({
    port: num(r?.port),
    protocol: str(r?.protocol || r?.proto, "tcp") as "tcp" | "udp",
    label: r?.label != null ? str(r.label) : null,
    status: str(r?.status, "closed") as "open" | "closed" | "filtered" | "open_filtered",
    response_ms: r?.latency_ms != null ? num(r.latency_ms) : r?.response_ms != null ? num(r.response_ms) : null,
  }));
  return {
    host: str(d.host),
    results,
    success: bool(d.success, true),
    error: d.error ?? null,
  };
}

// ── Device Scan ─────────────────────────────────────────────────

export interface NormalizedDeviceScanResult {
  devices: Array<{
    ip: string;
    mac: string;
    hostname: string;
    vendor: string;
    open_ports: number[];
    banner: string;
  }>;
  network: string;
  elapsed_ms: number;
  success: boolean;
  error: string | null;
}

export function normalizeDeviceScanResult(data: unknown): NormalizedDeviceScanResult {
  const d = asAny(data);
  const firstString = (...values: unknown[]): string => {
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    return "";
  };
  const devices = arr(d.devices).map((dev: any) => ({
    ip: str(dev?.ip),
    mac: str(dev?.mac),
    hostname: firstString(
      dev?.hostname,
      dev?.host_name,
      dev?.host,
      dev?.dns_name,
      dev?.rdns_name,
      dev?.name,
      arr(dev?.hostnames)[0],
      arr(dev?.names)[0],
    ),
    vendor: str(dev?.vendor),
    open_ports: arr(dev?.open_ports).map((p: any) => num(p)),
    banner: str(dev?.banner),
  }));
  return {
    devices,
    network: str(d.network),
    elapsed_ms: num(d.elapsed_ms),
    success: bool(d.success, true),
    error: d.error ?? null,
  };
}

// ── Registration Test ───────────────────────────────────────────

export interface NormalizedRegistrationResult {
  success: boolean;
  status_code: number;
  status_text: string;
  elapsed_ms: number;
  contact: string;
  expires: number;
  error: string | null;
  events: Array<{ time_ms: number; event: string; detail: string }>;
}

export function normalizeRegistrationResult(data: unknown): NormalizedRegistrationResult {
  const d = asAny(data);
  // Go agent returns "status" (string like "200") and "reason" (string like "OK")
  // instead of "status_code" (number) and "status_text" (string).
  const statusCode = num(d.status_code) || parseInt(str(d.status), 10) || 0;
  const statusText = str(d.status_text) || str(d.reason);
  // Derive success: prefer explicit boolean, otherwise infer from 2xx status code.
  const success = typeof d.success === "boolean"
    ? d.success
    : (statusCode >= 200 && statusCode < 300);
  return {
    success,
    status_code: statusCode,
    status_text: statusText,
    elapsed_ms: num(d.elapsed_ms),
    contact: str(d.contact),
    expires: num(d.expires),
    error: d.error ?? null,
    events: arr(d.events).map((e: any) => ({
      time_ms: num(e?.time_ms),
      event: str(e?.event),
      detail: str(e?.detail),
    })),
  };
}

// ── Fax ─────────────────────────────────────────────────────────

export interface NormalizedFaxResult {
  success: boolean;
  pages_sent: number;
  duration_ms: number;
  baud_rate: number;
  ecm: boolean;
  resolution: string;
  error: string | null;
  events: Array<{ time_ms: number; event: string; detail: string }>;
}

export function normalizeFaxResult(data: unknown): NormalizedFaxResult {
  const d = asAny(data);
  return {
    success: bool(d.success),
    pages_sent: num(d.pages_sent),
    duration_ms: num(d.duration_ms || d.elapsed_ms),
    baud_rate: num(d.baud_rate),
    ecm: bool(d.ecm),
    resolution: str(d.resolution),
    error: d.error ?? null,
    events: arr(d.events).map((e: any) => ({
      time_ms: num(e?.time_ms),
      event: str(e?.event),
      detail: str(e?.detail),
    })),
  };
}

// ── SIP Call ────────────────────────────────────────────────────

export interface NormalizedSipCallResult {
  success: boolean;
  answer_time_ms: number;
  duration_ms: number;
  audio_sent: boolean;
  pcap_base64: string | null;
  error: string | null;
  events: Array<{ time_ms: number; event: string; detail: string }>;
}

export function normalizeSipCallResult(data: unknown): NormalizedSipCallResult {
  const d = asAny(data);
  return {
    success: bool(d.success),
    answer_time_ms: num(d.answer_time_ms),
    duration_ms: num(d.duration_ms || d.elapsed_ms),
    audio_sent: bool(d.audio_sent),
    pcap_base64: d.pcap ?? d.pcap_base64 ?? null,
    error: d.error ?? null,
    events: arr(d.events).map((e: any) => ({
      time_ms: num(e?.time_ms),
      event: str(e?.event),
      detail: str(e?.detail),
    })),
  };
}

// ── Multicast ────────────────────────────────────────────────

export function normalizeJoinResult(data: unknown): JoinResult {
  const d = asAny(data);
  return {
    success: bool(d.success),
    group: str(d.group),
    error: d.error ?? undefined,
  };
}

export function normalizeIgmpQueryResult(data: unknown): IgmpQueryResult {
  const d = asAny(data);
  return {
    groups_found: arr(d.groups_found).map((g: any) => ({
      group: str(g?.group),
      last_reporter: str(g?.last_reporter),
      igmp_version: num(g?.igmp_version),
      compatibility_mode: str(g?.compatibility_mode),
    })),
    igmp_version: num(d.igmp_version),
    query_time_ms: num(d.query_time_ms),
    responders: num(d.responders),
  };
}

export function normalizeSnoopingVerifyResult(data: unknown): SnoopingVerifyResult {
  const d = asAny(data);
  return {
    group: str(d.group),
    snooping_active: bool(d.snooping_active),
    join_latency_ms: num(d.join_latency_ms),
    leave_verified: bool(d.leave_verified),
    ttl_check: bool(d.ttl_check),
    details: arr(d.details).map((s: any) => str(s)),
  };
}

export function normalizeSendTestResult(data: unknown): SendTestResult {
  const d = asAny(data);
  return {
    success: bool(d.success),
    group: str(d.group),
    sent: num(d.sent),
    elapsed_ms: num(d.elapsed_ms),
    error: d.error ?? undefined,
  };
}

// ── DNS SIP Resolve ─────────────────────────────────────────────

export function normalizeDnsSipResolveResult(data: unknown): any {
  const d = asAny(data);
  return { ...d, success: bool(d.success, true), error: d.error ?? null };
}

// ── DNS Reverse ─────────────────────────────────────────────────

export function normalizeDnsReverseResult(data: unknown): any {
  const d = asAny(data);
  return {
    ip: str(d.ip),
    hostnames: arr(d.hostnames).map((h: any) => str(h)),
    elapsed_ms: num(d.elapsed_ms),
    success: bool(d.success, true),
    error: d.error ?? null,
  };
}

// ── DNS Dig ─────────────────────────────────────────────────────

export function normalizeDnsDigResult(data: unknown): any {
  const d = asAny(data);
  return { ...d, success: bool(d.success, true), error: d.error ?? null };
}

// ── DNS GeoIP ───────────────────────────────────────────────────

export function normalizeDnsGeoIpResult(data: unknown): any {
  const d = asAny(data);
  const rawRdap = d.rdap;
  let rdap: Record<string, string | null> | null = null;
  if (rawRdap && typeof rawRdap === "object") {
    const r = rawRdap as Record<string, unknown>;
    rdap = {
      registry: maybeStr(r.registry),
      net_range: maybeStr(r.net_range),
      net_handle: maybeStr(r.net_handle),
      net_name: maybeStr(r.net_name),
      allocation_type: maybeStr(r.allocation_type),
      status: maybeStr(r.status),
      registrant: maybeStr(r.registrant),
      abuse_email: maybeStr(r.abuse_email),
      org_address: maybeStr(r.org_address),
      whois_server: maybeStr(r.whois_server),
      remarks: maybeStr(r.remarks),
    };
    if (Object.values(rdap).every((x) => x == null)) {
      rdap = null;
    }
  }
  return {
    ...d,
    success: bool(d.success, true),
    error: d.error ?? null,
    continent: maybeStr(d.continent),
    continent_code: maybeStr(d.continent_code),
    postal: maybeStr(d.postal),
    region_code: maybeStr(d.region_code),
    connection_domain: maybeStr(d.connection_domain),
    connection_class: maybeStr(d.connection_class),
    ip_kind: maybeStr(d.ip_kind),
    rdap,
  };
}

// ── NTP Check ───────────────────────────────────────────────────

export function normalizeNtpCheckResult(data: unknown): any {
  const d = asAny(data);
  return {
    server: str(d.server),
    stratum: num(d.stratum),
    offset_ms: num(d.offset_ms),
    delay_ms: num(d.delay_ms),
    success: bool(d.success, true),
    error: d.error ?? null,
  };
}

// ── NAT Detect ──────────────────────────────────────────────────

export function normalizeNatDetectResult(data: unknown): any {
  const d = asAny(data);
  const firstPresent = (...values: unknown[]) =>
    values.find((value) => value !== null && value !== undefined);
  const maybeNum = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const maybeBool = (value: unknown): boolean | null =>
    typeof value === "boolean" ? value : null;
  const maybeStr = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value : null;

  const mappedIp = maybeStr(firstPresent(d.mapped_ip, d.external_ip, d.public_ip));
  const mappedPort = maybeNum(firstPresent(d.mapped_port, d.external_port, d.public_port));
  const localIp = maybeStr(firstPresent(d.local_ip, d.internal_ip, d.private_ip));
  const localPort = maybeNum(firstPresent(d.local_port, d.internal_port, d.private_port));
  const natType = maybeStr(d.nat_type);
  const mappingBehavior = maybeStr(firstPresent(d.mapping_behavior, d.nat_mapping_behavior, d.mapping));
  const filteringBehavior = maybeStr(firstPresent(d.filtering_behavior, d.nat_filtering_behavior, d.filtering));

  const fallbackNatType = (() => {
    const mapping = (mappingBehavior ?? "").toLowerCase();
    const filtering = (filteringBehavior ?? "").toLowerCase();
    if (!mapping && !filtering) return "";
    const titleCase = (v: string) =>
      v
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    const mappingText = mapping ? titleCase(mapping) : "Unknown mapping";
    const filteringText = filtering ? titleCase(filtering) : "Unknown filtering";
    return `${mappingText} / ${filteringText}`;
  })();

  return {
    nat_type: natType || fallbackNatType || "",
    mapped_ip: mappedIp,
    mapped_port: mappedPort,
    local_ip: localIp,
    local_port: localPort,
    hairpin_supported: maybeBool(firstPresent(d.hairpin_supported, d.hairpin)),
    alg_detected: maybeBool(firstPresent(d.alg_detected, d.sip_alg_detected, d.alg)),
    modified_headers: arr(firstPresent(d.modified_headers, d.alg_modified_headers))
      .map((h) => str(h))
      .filter(Boolean),
    udp_timeout_secs: maybeNum(firstPresent(d.udp_timeout_secs, d.udp_timeout, d.udp_idle_timeout_secs)),
    elapsed_ms: maybeNum(firstPresent(d.elapsed_ms, d.response_ms, d.duration_ms)),
    // Keep legacy fields for compatibility with any older consumers.
    external_ip: mappedIp,
    external_port: mappedPort,
    mapping_behavior: mappingBehavior ?? "",
    filtering_behavior: filteringBehavior ?? "",
    success: typeof d.success === "boolean" ? d.success : d.error == null,
    error: d.error ?? null,
  };
}

// ── SNMP Poll ───────────────────────────────────────────────────

export function normalizeSnmpPollResult(data: unknown): any {
  const d = asAny(data);
  const interfaces = arr(d.interfaces).map((iface: any) => ({
    index: num(iface?.index),
    description: str(iface?.description),
    type: str(iface?.type || iface?.if_type),
    speed: num(iface?.speed),
    oper_status: str(iface?.oper_status),
    in_octets: num(iface?.in_octets),
    out_octets: num(iface?.out_octets),
    in_errors: num(iface?.in_errors),
    out_errors: num(iface?.out_errors),
    in_discards: num(iface?.in_discards),
    out_discards: num(iface?.out_discards),
  }));
  const sys = asAny(d.system_info);
  return {
    system_info: {
      sys_name: str(sys.sys_name),
      sys_descr: str(sys.sys_descr),
      sys_uptime: str(sys.sys_uptime),
      sys_contact: str(sys.sys_contact),
      sys_location: str(sys.sys_location),
    },
    interfaces,
    elapsed_ms: num(d.elapsed_ms),
  };
}

// ── SIP Probe ───────────────────────────────────────────────────

import type { SipProbeResult, StunResult } from "@/types/networkTest";

export function normalizeSipProbeResult(data: unknown): SipProbeResult {
  const d = asAny(data);
  const elapsedMs = num(d.elapsed_ms);
  const statusCode = parseInt(str(d.status, "0"), 10) || null;
  return {
    host: str(d.target),
    resolved_ip: str(d.target),
    port: num(d.port, 5060),
    method_used: str(d.method, "OPTIONS"),
    avg_latency_ms: elapsedMs,
    min_latency_ms: elapsedMs,
    max_latency_ms: elapsedMs,
    stddev_latency_ms: 0,
    probe_rtts: [elapsedMs],
    avg_jitter_ms: 0,
    max_jitter_ms: 0,
    packets_sent: 1,
    packets_received: statusCode ? 1 : 0,
    packet_loss_pct: statusCode ? 0 : 100,
    sip_responses: statusCode ? [{ seq: 0, status_code: statusCode, rtt_ms: elapsedMs }] : [],
    success: !!statusCode,
    error: statusCode ? null : str(d.reason, "No response"),
  };
}

// ── STUN ────────────────────────────────────────────────────────

export function normalizeStunResult(data: unknown): StunResult {
  const d = asAny(data);
  const hasPublicIp = !!d.public_ip;
  return {
    stun_server: str(d.server),
    public_ip: d.public_ip ?? null,
    public_port: d.public_port ?? null,
    local_ip: null,
    local_port: null,
    nat_type: str(d.nat_type),
    response_ms: d.elapsed_ms != null ? num(d.elapsed_ms) : null,
    success: hasPublicIp,
    error: hasPublicIp ? null : str(d.error, "No response"),
  };
}

// ── MTR ─────────────────────────────────────────────────────────

export function normalizeMtrResult(data: unknown): any {
  const d = asAny(data);
  const hops = Array.isArray(d.hops) ? d.hops : [];
  const resolvedIp = str(d.resolved_ip || d.ip);
  const hopIps = hops
    .map((hop) => str((hop as Record<string, unknown>)?.ip).trim().toLowerCase())
    .filter((ip) => ip.length > 0);
  const reachedByLegacyInference =
    !!resolvedIp &&
    hopIps.some((ip) => ip === resolvedIp.trim().toLowerCase());

  return {
    ...d,
    destination_reached:
      typeof d.destination_reached === "boolean"
        ? d.destination_reached || reachedByLegacyInference
        : reachedByLegacyInference,
    success: bool(d.success, true),
    error: d.error ?? null,
  };
}

// ── Device Control ──────────────────────────────────────────────

export function normalizeDeviceControlResult(data: unknown): any {
  const d = asAny(data);
  return { ...d, success: bool(d.success, true), error: d.error ?? null };
}

// ── Capture Permission ──────────────────────────────────────────

export interface NormalizedCapturePermStatus {
  available: boolean;
  method: string;
  detail: string;
}

export function normalizeCapturePermResult(data: unknown): NormalizedCapturePermStatus {
  const d = asAny(data);
  return {
    available: bool(d.available),
    method: str(d.method),
    detail: str(d.detail),
  };
}

// ── Provision ──────────────────────────────────────────────────────────

export function normalizeFetchProvisionResult(data: unknown): any {
  const d = asAny(data);
  return {
    raw: str(d.raw),
    parsed: d.parsed ?? null,
    request_info: d.request_info ?? {
      final_url: "",
      user_agent: "",
      mac_used: "",
      status: 0,
    },
    parseable: bool(d.parseable),
  };
}
