/**
 * DNS Suite API — typed Tauri IPC wrappers for the comprehensive DNS testing suite.
 */

import { invokeTauri } from "./invoke";
import type {
  DnsRecordSet,
  DnsRecordType,
  SipResolutionChain,
  ReverseDnsResult,
  BatchReverseDnsResult,
  RawDnsResponse,
  GeoIpResult,
  BatchGeoIpResult,
  AsnResult,
  MultiSiteConfig,
  MultiSiteDnsComparison,
} from "@/types/dns";

// ── DNS Lookup (full record types) ──────────────────────────────────────

export async function dnsLookup(
  domain: string,
  recordType?: DnsRecordType,
  server?: string,
  port?: number,
  transport?: "udp" | "tcp"
): Promise<DnsRecordSet> {
  return invokeTauri<DnsRecordSet>("dns_lookup", {
    domain,
    recordType: recordType ?? null,
    server: server ?? null,
    port: port ?? null,
    transport: transport ?? null,
  });
}

// ── RFC 3263 SIP Resolution Chain ───────────────────────────────────────

export async function dnsSipResolve(
  domain: string,
  server?: string,
  port?: number
): Promise<SipResolutionChain> {
  return invokeTauri<SipResolutionChain>("dns_sip_resolve", {
    domain,
    server: server ?? null,
    port: port ?? null,
  });
}

// ── Reverse DNS + FCrDNS ────────────────────────────────────────────────

export async function dnsReverse(
  ip: string,
  server?: string,
  port?: number,
  fcrdns?: boolean
): Promise<ReverseDnsResult> {
  return invokeTauri<ReverseDnsResult>("dns_reverse", {
    ip,
    server: server ?? null,
    port: port ?? null,
    fcrdns: fcrdns ?? true,
  });
}

export async function dnsReverseBatch(
  ips: string[],
  server?: string,
  port?: number,
  fcrdns?: boolean,
  concurrency?: number
): Promise<BatchReverseDnsResult> {
  return invokeTauri<BatchReverseDnsResult>("dns_reverse_batch", {
    ips,
    server: server ?? null,
    port: port ?? null,
    fcrdns: fcrdns ?? true,
    concurrency: concurrency ?? 10,
  });
}

// ── Dig-Style Raw Query ─────────────────────────────────────────────────

export async function dnsDig(
  domain: string,
  recordType?: string,
  server?: string,
  port?: number,
  useTcp?: boolean,
  rd?: boolean,
  cd?: boolean,
  ad?: boolean
): Promise<RawDnsResponse> {
  return invokeTauri<RawDnsResponse>("dns_dig", {
    domain,
    recordType: recordType ?? null,
    server: server ?? null,
    port: port ?? null,
    useTcp: useTcp ?? false,
    rd: rd ?? null,
    cd: cd ?? null,
    ad: ad ?? null,
  });
}

// ── GeoIP Enrichment ────────────────────────────────────────────────────

export async function dnsGeoIp(ip: string): Promise<GeoIpResult> {
  return invokeTauri<GeoIpResult>("dns_geoip", { ip });
}

export async function dnsGeoIpBatch(ips: string[]): Promise<BatchGeoIpResult> {
  return invokeTauri<BatchGeoIpResult>("dns_geoip_batch", { ips });
}

export async function dnsAsnLookup(ip: string): Promise<AsnResult> {
  return invokeTauri<AsnResult>("dns_asn_lookup", { ip });
}

// ── Multi-Site Comparison ───────────────────────────────────────────────

export async function dnsMultiSite(
  config: MultiSiteConfig
): Promise<MultiSiteDnsComparison> {
  return invokeTauri<MultiSiteDnsComparison>("dns_multi_site", { config });
}
