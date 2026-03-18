/**
 * SIP Discovery types — mirrors the Rust structs in sip_discovery/.
 */

// ── Device types ─────────────────────────────────────────────────

export type DeviceType =
  | "phone"
  | "pbx"
  | "gateway"
  | "sbc"
  | "proxy"
  | "softphone"
  | "unknown";

export interface DeviceFingerprint {
  vendor: string;
  model: string;
  firmware: string;
  device_type: DeviceType;
}

export interface DiscoveredDevice {
  ip: string;
  port: number;
  transport: string;
  status_code: number;
  user_agent: string;
  server_header: string;
  allow_header: string;
  contact_header: string;
  rtt_ms: number;
  fingerprint: DeviceFingerprint;
  raw_response: string;
}

// ── Scan config ──────────────────────────────────────────────────

export type ScanMethod = "options" | "register" | "invite";
export type ScanTransport = "udp" | "tcp";

export interface ScanConfig {
  targets: string;
  ports: number[];
  transport: ScanTransport;
  timeout_ms: number;
  concurrency: number;
  method: ScanMethod;
}

// ── Scan result ──────────────────────────────────────────────────

export interface ScanResult {
  devices: DiscoveredDevice[];
  total_ips_scanned: number;
  total_ports_scanned: number;
  responded_count: number;
  duration_ms: number;
  stopped: boolean;
  error: string | null;
}

// ── Progress event ───────────────────────────────────────────────

export interface ScanProgressEvent {
  probed: number;
  total: number;
  device: DiscoveredDevice | null;
}

// ── Scan history entry (for session persistence) ─────────────────

export interface ScanHistoryEntry {
  id: string;
  timestamp: string;
  targets: string;
  ports: number[];
  transport: ScanTransport;
  method: ScanMethod;
  devicesFound: number;
  totalScanned: number;
  durationMs: number;
  devices: DiscoveredDevice[];
}

// ── Detected subnet ──────────────────────────────────────────────

export interface DetectedSubnet {
  cidr: string;
  local_ip: string;
  prefix_len: number;
  gateway: string | null;
}

// ── Filter state ─────────────────────────────────────────────────

export interface ScanFilter {
  search: string;
  ip: string;
  port: string;
  deviceTypes: DeviceType[];
  vendor: string;
}

// ── Detected subnet ──────────────────────────────────────────────

export interface DetectedSubnet {
  cidr: string;
  local_ip: string;
  prefix_len: number;
  gateway: string | null;
}

export const DEFAULT_SCAN_FILTER: ScanFilter = {
  search: "",
  ip: "",
  port: "",
  deviceTypes: [],
  vendor: "",
};
