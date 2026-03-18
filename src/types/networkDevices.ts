/**
 * Network Devices types — mirrors the Rust structs in network_discovery/.
 */

// ── Device types ─────────────────────────────────────────────────

export type DeviceType =
  | "phone"
  | "pbx"
  | "gateway"
  | "sbc"
  | "proxy"
  | "softphone"
  | "router"
  | "switch"
  | "accesspoint"
  | "computer"
  | "server"
  | "printer"
  | "camera"
  | "nas"
  | "iot"
  | "unknown";

export interface DeviceFingerprint {
  vendor: string;
  model: string;
  firmware: string;
  device_type: DeviceType;
}

// ── Open port (from banner grab) ─────────────────────────────────

export interface OpenPort {
  port: number;
  protocol: string;
  status: string;
  service_name: string;
  banner: string;
}

// ── SIP device info (sub-struct) ─────────────────────────────────

export interface SipDeviceInfo {
  port: number;
  transport: string;
  status_code: number;
  user_agent: string;
  server_header: string;
  allow_header: string;
  contact_header: string;
  fingerprint: DeviceFingerprint;
  raw_response: string;
}

// ── Discovery method ─────────────────────────────────────────────

export type DiscoveryMethod = "arp" | "sip" | "both";

// ── Unified device model ─────────────────────────────────────────

export interface DiscoveredDevice {
  // General (from ARP + port scan)
  ip: string;
  mac_address: string | null;
  oui_vendor: string | null;
  hostname: string | null;
  open_ports: OpenPort[];
  // SIP-specific (from SIP probe, may be null)
  sip: SipDeviceInfo | null;
  // Common
  rtt_ms: number | null;
  discovery_method: DiscoveryMethod;

  // Legacy compatibility fields (populated from sip when present)
  port: number;
  transport: string;
  status_code: number;
  user_agent: string;
  server_header: string;
  allow_header: string;
  contact_header: string;
  fingerprint: DeviceFingerprint;
  raw_response: string;
}

// ── Scan config ──────────────────────────────────────────────────

export type ScanMethod = "options" | "register" | "invite";
export type ScanTransport = "udp" | "tcp";
export type ScanMode = "quick" | "sip" | "full";
export type ScanEnrichmentPreset = "fast" | "balanced" | "deep";
export type ScanPhase = "discovering" | "enriching" | "fingerprinting" | "finalizing";

export interface ScanEnrichmentFlags {
  rdns: boolean;
  fingerprint: boolean;
  port_scan: boolean;
  banner_grab: boolean;
}

export interface ScanConfig {
  targets: string;
  ports: number[];
  transport: ScanTransport;
  timeout_ms: number;
  concurrency: number;
  method: ScanMethod;
  scan_mode: ScanMode;
  enrichment_preset?: ScanEnrichmentPreset;
  enrichment_flags?: Partial<ScanEnrichmentFlags>;
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
  scan_mode: ScanMode;
}

// ── Progress event ───────────────────────────────────────────────

export interface ScanProgressEvent {
  probed: number;
  total: number;
  device: DiscoveredDevice | null;
  phase?: ScanPhase;
  phase_label?: string;
  phase_probed?: number;
  phase_total?: number;
}

// ── Scan history entry (for session persistence) ─────────────────

export interface ScanHistoryEntry {
  id: string;
  timestamp: string;
  targets: string;
  ports: number[];
  transport: ScanTransport;
  method: ScanMethod;
  scanMode: ScanMode;
  devicesFound: number;
  totalScanned: number;
  durationMs: number;
  devices: DiscoveredDevice[];
  succeeded?: boolean;
  error?: string | null;
}

export interface DeviceLabelCacheEntry {
  key: string;
  label: string;
  updatedAt: number;
  expiresAt: number;
}

export interface ScanDiffSummary {
  newCount: number;
  offlineCount: number;
  changedCount: number;
}

// ── Detected subnet ──────────────────────────────────────────────

export interface DetectedSubnet {
  cidr: string;
  local_ip: string;
  prefix_len: number;
  gateway: string | null;
}

// ── Subnet info (all interfaces) ─────────────────────────────────

export interface SubnetInfo {
  cidr: string;
  local_ip: string;
  prefix_len: number;
  gateway: string | null;
  interface_name: string;
  friendly_name: string | null;
  mac_address: string | null;
  interface_type: string;
  is_default: boolean;
  host_count: number;
}

// ── Filter state ─────────────────────────────────────────────────

export interface ScanFilter {
  search: string;
  ip: string;
  port: string;
  openPort: string;
  hostname: string;
  hasMac: boolean;
  diffStatus: "" | "new" | "changed";
  deviceTypes: DeviceType[];
  vendor: string;
  discoveryMethod: DiscoveryMethod | "";
}

export const DEFAULT_SCAN_FILTER: ScanFilter = {
  search: "",
  ip: "",
  port: "",
  openPort: "",
  hostname: "",
  hasMac: false,
  diffStatus: "",
  deviceTypes: [],
  vendor: "",
  discoveryMethod: "",
};
