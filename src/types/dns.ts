// ── DNS Record Types ────────────────────────────────────────────────────

export type DnsRecordType =
  | "A"
  | "AAAA"
  | "SRV"
  | "NAPTR"
  | "MX"
  | "TXT"
  | "CNAME"
  | "NS"
  | "SOA"
  | "PTR"
  | "CAA"
  | "TLSA"
  | "SSHFP"
  | "HTTPS"
  | "ANY";

// ── DNS Lookup Result ───────────────────────────────────────────────────

export interface DnsRecordSet {
  domain: string;
  record_type: string;
  server: string | null;
  records: DnsRecord[];
  resolution_ms: number;
  success: boolean;
  error: string | null;
}

export interface DnsRecord {
  name: string;
  record_type: string;
  ttl: number;
  data: DnsRecordEntry;
}

export type DnsRecordEntry =
  | { type: "A"; value: string }
  | { type: "AAAA"; value: string }
  | { type: "SRV"; value: SrvRecordData }
  | { type: "NAPTR"; value: NaptrRecordData }
  | { type: "MX"; value: MxRecordData }
  | { type: "TXT"; value: TxtRecordData }
  | { type: "CNAME"; value: string }
  | { type: "NS"; value: string }
  | { type: "SOA"; value: SoaRecordData }
  | { type: "PTR"; value: string }
  | { type: "CAA"; value: CaaRecordData }
  | { type: "TLSA"; value: TlsaRecordData }
  | { type: "SSHFP"; value: SshfpRecordData }
  | { type: "HTTPS"; value: string }
  | { type: "Raw"; value: string };

export interface SrvRecordData {
  service: string;
  priority: number;
  weight: number;
  port: number;
  target: string;
}

export interface NaptrRecordData {
  order: number;
  preference: number;
  flags: string;
  service: string;
  regexp: string;
  replacement: string;
}

export interface MxRecordData {
  preference: number;
  exchange: string;
}

export interface TxtRecordData {
  text: string;
}

export interface SoaRecordData {
  mname: string;
  rname: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
}

export interface CaaRecordData {
  issuer_critical: boolean;
  tag: string;
  value: string;
}

export interface TlsaRecordData {
  cert_usage: number;
  selector: number;
  matching_type: number;
  cert_data: string;
}

export interface SshfpRecordData {
  algorithm: number;
  fingerprint_type: number;
  fingerprint: string;
}

// ── SIP Resolution (RFC 3263) ───────────────────────────────────────────

export interface SipResolutionChain {
  domain: string;
  steps: SipResolutionStep[];
  targets: SipTarget[];
  total_ms: number;
  success: boolean;
  error: string | null;
}

export interface SipResolutionStep {
  step_type: string;
  query: string;
  record_type: string;
  records_found: number;
  resolution_ms: number;
  details: StepDetail[];
}

export interface StepDetail {
  label: string;
  value: string;
}

export interface SipTarget {
  transport: string;
  host: string;
  port: number;
  priority: number;
  weight: number;
  ip_addresses: string[];
}

// ── Reverse DNS + FCrDNS ────────────────────────────────────────────────

export interface ReverseDnsResult {
  ip: string;
  ptr_hostname: string | null;
  resolution_ms: number;
  success: boolean;
  error: string | null;
  fcrdns: FcrDnsResult | null;
}

export interface FcrDnsResult {
  ip: string;
  ptr_hostname: string | null;
  forward_ips: string[];
  confirmed: boolean;
  mismatch_details: string | null;
}

export interface BatchReverseDnsResult {
  results: ReverseDnsResult[];
  total_ms: number;
}

// ── Dig-Style Raw DNS ───────────────────────────────────────────────────

export interface RawDnsResponse {
  server: string;
  query: string;
  query_type: string;
  transport: string;
  header: DnsFlags;
  question: DnsQuestionSection[];
  answer: RawDnsRecord[];
  authority: RawDnsRecord[];
  additional: RawDnsRecord[];
  edns: EdnsInfo | null;
  query_time_ms: number;
  response_size: number;
  truncated: boolean;
  tcp_retry: boolean;
  success: boolean;
  error: string | null;
  dig_output: string;
}

export interface DnsFlags {
  id: number;
  qr: boolean;
  opcode: string;
  aa: boolean;
  tc: boolean;
  rd: boolean;
  ra: boolean;
  ad: boolean;
  cd: boolean;
  rcode: string;
  rcode_description: string;
  qdcount: number;
  ancount: number;
  nscount: number;
  arcount: number;
}

export interface DnsQuestionSection {
  name: string;
  record_type: string;
  class: string;
}

export interface RawDnsRecord {
  name: string;
  ttl: number;
  class: string;
  record_type: string;
  data: string;
}

export interface EdnsInfo {
  version: number;
  udp_payload_size: number;
  dnssec_ok: boolean;
  options: string[];
}

// ── GeoIP ───────────────────────────────────────────────────────────────

export interface GeoIpResult {
  ip: string;
  success: boolean;
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  isp: string | null;
  org: string | null;
  asn: string | null;
  timezone: string | null;
  source: string;
  error: string | null;
}

export interface AsnResult {
  ip: string;
  asn: string | null;
  cidr: string | null;
  country_code: string | null;
  registry: string | null;
  org_name: string | null;
  success: boolean;
  error: string | null;
}

export interface BatchGeoIpResult {
  results: GeoIpResult[];
  total_ms: number;
}

// ── PCAP Correlation ────────────────────────────────────────────────────

export interface DnsCorrelation {
  query_domain: string;
  query_type: string | null;
  matched_packets: MatchedDnsPacket[];
  packets_scanned: number;
  discrepancies: DnsDiscrepancy[];
}

export interface MatchedDnsPacket {
  packet_index: number;
  timestamp: string;
  src_ip: string;
  dst_ip: string;
  src_port: number;
  dst_port: number;
  is_response: boolean;
  transaction_id: number;
  query_name: string;
  query_type: number;
  answers: MatchedDnsAnswer[];
  response_code: number | null;
}

export interface MatchedDnsAnswer {
  name: string;
  record_type: number;
  ttl: number;
  data: string;
}

export interface DnsDiscrepancy {
  severity: string;
  description: string;
}

// ── Multi-Site Comparison ───────────────────────────────────────────────

export interface MultiSiteConfig {
  test_type: "lookup" | "sip_resolve" | "reverse" | "dig";
  target: string;
  record_type?: string;
  server?: string;
  agent_ids: string[];
  include_local: boolean;
}

export interface MultiSiteDnsComparison {
  target: string;
  test_type: string;
  results: SiteDnsResult[];
  discrepancies: MultiSiteDiscrepancy[];
  total_ms: number;
}

export interface SiteDnsResult {
  source: string;
  agent_id: string | null;
  command_id: string | null;
  result: unknown | null;
  latency_ms: number | null;
  success: boolean;
  error: string | null;
}

export interface MultiSiteDiscrepancy {
  severity: string;
  description: string;
  sites_affected: string[];
}
