// ── Health Check ────────────────────────────────────────────────

export interface HealthPingEntry {
  host: string;
  label: string;
  result: PingResult;
}

export interface HealthCheckResult {
  pings: HealthPingEntry[];
  gateway_reachable: boolean;
  internet_reachable: boolean;
  avg_latency_ms: number | null;
  best_latency_ms: number | null;
  packet_loss_pct: number | null;
}

export interface NetworkCapabilityReport {
  platform: string;
  tracerouteSupported: boolean;
  tracerouteReason: string | null;
  mtrSupported: boolean;
  mtrReason: string | null;
  wifiSupported: boolean;
  wifiReason: string | null;
}

// ── Ping ────────────────────────────────────────────────────────

export interface ProbeResult {
  seq: number;
  rtt_ms: number | null;
  success: boolean;
}

export interface PingResult {
  host: string;
  resolved_ip: string;
  probes: ProbeResult[];
  min_ms: number;
  max_ms: number;
  avg_ms: number;
  stddev_ms: number;
  packet_loss_pct: number;
  success: boolean;
  error: string | null;
}

// ── Jitter ──────────────────────────────────────────────────────

export interface JitterResult {
  host: string;
  avg_jitter_ms: number;
  max_jitter_ms: number;
  min_jitter_ms: number;
  stddev_jitter_ms: number;
  packets_sent: number;
  packets_received: number;
  packet_loss_pct: number;
  jitter_samples: number[];
  success: boolean;
  error: string | null;
}

// ── Packet Loss ─────────────────────────────────────────────────

export interface PacketLossResult {
  host: string;
  packets_sent: number;
  packets_received: number;
  loss_pct: number;
  success: boolean;
  error: string | null;
}

// ── Bandwidth ───────────────────────────────────────────────────

export interface BandwidthResult {
  host: string;
  upload_kbps: number;
  download_kbps: number;
  duration_ms: number;
  bytes_sent: number;
  bytes_received: number;
  packets_sent: number;
  packets_received: number;
  packet_loss_pct: number;
  success: boolean;
  error: string | null;
}

// ── MOS ─────────────────────────────────────────────────────────

export interface MosResult {
  r_factor: number;
  mos: number;
  quality: string;
  latency_ms: number;
  jitter_ms: number;
  packet_loss_pct: number;
}

// ── Traceroute ──────────────────────────────────────────────────

export interface TracerouteHop {
  hop: number;
  ip: string | null;
  hostname: string | null;
  rtt_ms: (number | null)[];
  avg_rtt_ms: number | null;
}

export interface TracerouteResult {
  host: string;
  resolved_ip: string;
  hops: TracerouteHop[];
  reached_destination: boolean;
  success: boolean;
  error: string | null;
}

// ── MTU ─────────────────────────────────────────────────────────

export interface MtuResult {
  host: string;
  path_mtu: number;
  success: boolean;
  error: string | null;
}

// ── DSCP ────────────────────────────────────────────────────────

export interface DscpResult {
  host: string;
  dscp_sent: number;
  dscp_name: string;
  packet_sent: boolean;
  success: boolean;
  error: string | null;
}

// ── Port Scan ───────────────────────────────────────────────────

export type PortProtocol = "tcp" | "udp";
export type PortStatus = "open" | "closed" | "filtered" | "open_filtered";

export interface PortTestEntry {
  port: number;
  protocol: PortProtocol;
  label: string | null;
}

export interface PortTestResult {
  port: number;
  protocol: PortProtocol;
  label: string | null;
  status: PortStatus;
  response_ms: number | null;
}

export interface PortScanResult {
  host: string;
  results: PortTestResult[];
  success: boolean;
  error: string | null;
}

/** A saved port profile for reuse. */
export interface PortProfile {
  id: string;
  name: string;
  entries: PortTestEntry[];
}

// ── DNS ─────────────────────────────────────────────────────────

export interface SrvRecord {
  service: string;
  priority: number;
  weight: number;
  port: number;
  target: string;
}

export interface NaptrRecord {
  order: number;
  preference: number;
  flags: string;
  service: string;
  regexp: string;
  replacement: string;
}

export interface DnsResult {
  domain: string;
  srv_records: SrvRecord[];
  naptr_records: NaptrRecord[];
  a_records: string[];
  aaaa_records: string[];
  resolution_ms: number;
  success: boolean;
  error: string | null;
}

// ── STUN ────────────────────────────────────────────────────────

export interface StunResult {
  stun_server: string;
  public_ip: string | null;
  public_port: number | null;
  local_ip: string | null;
  local_port: number | null;
  nat_type: string;
  response_ms: number | null;
  success: boolean;
  error: string | null;
}

// ── TURN ────────────────────────────────────────────────────────

export interface TurnResult {
  server: string;
  reachable: boolean;
  response_ms: number | null;
  allocated_address: string | null;
  success: boolean;
  error: string | null;
}

// ── RTP Simulation ──────────────────────────────────────────────

export interface RtpSimResult {
  host: string;
  codec: string;
  packets_sent: number;
  packets_received: number;
  packet_loss_pct: number;
  avg_jitter_ms: number;
  max_jitter_ms: number;
  avg_latency_ms: number;
  mos_estimate: number;
  duration_ms: number;
  success: boolean;
  error: string | null;
}

// ── Network Info ────────────────────────────────────────────────

export interface NetworkInterface {
  name: string;
  friendly_name: string | null;
  mac_address: string | null;
  ipv4: string[];
  ipv6: string[];
  is_default: boolean;
  interface_type: string;
  gateway: string | null;
}

export interface NetInfoResult {
  interfaces: NetworkInterface[];
  default_interface: string | null;
  default_gateway: string | null;
  local_ip: string | null;
  success: boolean;
  error: string | null;
}

// ── Wi-Fi ───────────────────────────────────────────────────────

export interface WifiInfo {
  ssid: string | null;
  bssid: string | null;
  rssi_dbm: number | null;
  noise_dbm: number | null;
  channel: number | null;
  tx_rate_mbps: number | null;
  security: string | null;
  signal_quality_pct: number | null;
  success: boolean;
  error: string | null;
}

// ── SIP Probe ───────────────────────────────────────────────────

export interface SipResponseInfo {
  seq: number;
  status_code: number | null;
  rtt_ms: number | null;
}

export type ProbeMethod = "options" | "register" | "tcp" | "auto";

export interface SipProbePacketEvent {
  seq: number;
  total: number;
  method: string;
  status_code: number | null;
  rtt_ms: number | null;
  running_sent: number;
  running_received: number;
  running_loss_pct: number;
  running_avg_rtt_ms: number;
  running_jitter_ms: number;
}

export interface SipProbeResult {
  host: string;
  resolved_ip: string;
  port: number;
  method_used: string;

  avg_latency_ms: number;
  min_latency_ms: number;
  max_latency_ms: number;
  stddev_latency_ms: number;
  probe_rtts: (number | null)[];

  avg_jitter_ms: number;
  max_jitter_ms: number;

  packets_sent: number;
  packets_received: number;
  packet_loss_pct: number;

  sip_responses: SipResponseInfo[];

  success: boolean;
  error: string | null;
}

// ── STUN Quality Probe ──────────────────────────────────────────

export interface StunQualityPacketEvent {
  seq: number;
  total: number;
  rtt_ms: number | null;
  running_sent: number;
  running_received: number;
  running_loss_pct: number;
  running_avg_rtt_ms: number;
  running_jitter_ms: number;
  running_mos: number;
}

export interface StunQualityResult {
  server: string;
  resolved_ip: string;
  port: number;

  avg_rtt_ms: number;
  min_rtt_ms: number;
  max_rtt_ms: number;
  stddev_rtt_ms: number;

  avg_jitter_ms: number;
  max_jitter_ms: number;

  packets_sent: number;
  packets_received: number;
  packet_loss_pct: number;

  mos: number;
  r_factor: number;
  quality: string;

  probe_rtts: (number | null)[];

  success: boolean;
  error: string | null;
}

// ── Speed Test ──────────────────────────────────────────────────

export interface SpeedTestProgressEvent {
  phase: "latency" | "download" | "upload";
  progress_pct: number;
  current_mbps: number;
}

export interface SpeedTestResult {
  download_mbps: number;
  upload_mbps: number;
  latency_ms: number;
  jitter_ms: number;
  download_loaded_latency_ms?: number;
  download_loaded_jitter_ms?: number;
  upload_loaded_latency_ms?: number;
  upload_loaded_jitter_ms?: number;
  idle_latency_samples?: number;
  download_loaded_latency_samples?: number;
  upload_loaded_latency_samples?: number;
  server: string;
  success: boolean;
  error: string | null;

  // Optional enhanced metrics from newer backend versions.
  latency_idle_ms?: number;
  latency_loaded_ms?: number;
  latency_download_ms?: number;
  latency_upload_ms?: number;
  packet_loss_pct?: number;
  confidence?: number;
  confidence_score?: number;
  sample_count?: number;
  download_samples_mbps?: number[];
  upload_samples_mbps?: number[];
  server_location?: string;
  server_region?: string;
  server_country?: string;
  measured_at_ms?: number;

  // Allow additional backend-provided fields without breaking older clients.
  [key: string]: unknown;
}

// ── Monitor ─────────────────────────────────────────────────────

export interface MonitorSample {
  timestamp_ms: number;
  latency_ms: number | null;
  jitter_ms: number | null;
  packet_loss_pct: number | null;
}

export interface MonitorStatus {
  running: boolean;
  elapsed_secs: number;
  total_samples: number;
}

// ── MTR (Continuous Traceroute) ─────────────────────────────────

export interface MtrHop {
  hop: number;
  ip: string;
  hostname: string;
  loss_pct: number;
  sent: number;
  received: number;
  best_ms: number;
  worst_ms: number;
  avg_ms: number;
  last_ms: number;
  stdev_ms: number;
  jitter_ms: number;
}

export interface MtrResult {
  host: string;
  resolved_ip: string;
  hops: MtrHop[];
  rounds: number;
  destination_reached: boolean;
  success: boolean;
  error: string | null;
}

// ── NTP / Time Sync Check ───────────────────────────────────────

export interface NtpServerResult {
  server: string;
  stratum: number;
  offset_ms: number;
  delay_ms: number;
  reference_id: string;
  success: boolean;
  error: string | null;
}

export interface NtpCheckResult {
  servers: NtpServerResult[];
  local_time: string;
  utc_time: string;
  clock_status: "ok" | "warning" | "critical";
}

// ── NAT / ALG Detection ────────────────────────────────────────

export interface NatDetectResult {
  nat_type: string;
  mapped_ip: string;
  mapped_port: number;
  local_ip: string;
  local_port: number;
  hairpin_supported: boolean;
  alg_detected: boolean;
  modified_headers: string[];
  udp_timeout_secs: number;
  elapsed_ms: number;
}

// ── SNMP Poller ─────────────────────────────────────────────────

export interface SnmpSystemInfo {
  sys_name: string;
  sys_descr: string;
  sys_uptime: string;
  sys_contact: string;
  sys_location: string;
}

export interface SnmpInterface {
  index: number;
  description: string;
  type: string;
  speed: number;
  oper_status: string;
  in_octets: number;
  out_octets: number;
  in_errors: number;
  out_errors: number;
  in_discards: number;
  out_discards: number;
}

export interface SnmpPollResult {
  system_info: SnmpSystemInfo;
  interfaces: SnmpInterface[];
  elapsed_ms: number;
}
