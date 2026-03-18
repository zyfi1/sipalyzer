import { create } from "zustand";
import * as api from "@/api/networkDevices";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import type {
  DiscoveredDevice,
  ScanResult,
  ScanMethod,
  ScanTransport,
  ScanMode,
  ScanPhase,
  ScanEnrichmentPreset,
  ScanEnrichmentFlags,
  ScanDiffSummary,
  DeviceLabelCacheEntry,
  ScanFilter,
  ScanHistoryEntry,
  ScanProgressEvent,
} from "@/types/networkDevices";
import { DEFAULT_SCAN_FILTER } from "@/types/networkDevices";
import type { ExecutionContext } from "@/stores/executionContextStore";
import { dispatchDeviceScan } from "@/lib/executionDispatch";
import type { NormalizedDeviceScanResult } from "@/lib/resultNormalizers";

// ── Helpers ──────────────────────────────────────────────────────

type ScanStatus = "idle" | "running" | "done" | "error";
const DEFAULT_LABEL_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_ENRICHMENT_PRESET: ScanEnrichmentPreset = "balanced";
const DEFAULT_ENRICHMENT_FLAGS: ScanEnrichmentFlags = {
  rdns: true,
  fingerprint: true,
  port_scan: true,
  banner_grab: false,
};

// ── Store ────────────────────────────────────────────────────────

interface NetworkDevicesState {
  // ── Scan status ──────────────────────────────────────────────
  status: ScanStatus;
  error: string | null;

  // ── Config (persisted via session state) ─────────────────────
  targets: string;
  ports: string; // comma-separated for UI, parsed to numbers on scan
  transport: ScanTransport;
  timeoutMs: number;
  concurrency: number;
  method: ScanMethod;
  scanMode: ScanMode;
  enrichmentPreset: ScanEnrichmentPreset;
  enrichmentFlags: ScanEnrichmentFlags;

  // ── Results ──────────────────────────────────────────────────
  devices: DiscoveredDevice[];
  probed: number;
  totalProbes: number;
  durationMs: number;
  phase: ScanPhase | null;
  phaseLabel: string | null;
  phaseProbed: number;
  phaseTotal: number;
  diffSummary: ScanDiffSummary | null;
  newDeviceKeys: string[];
  changedDeviceKeys: string[];
  offlineDevices: DiscoveredDevice[];
  previousSuccessfulDevices: DiscoveredDevice[];
  deviceLabelCache: Record<string, DeviceLabelCacheEntry>;

  // ── Last execution source (local vs remote) ───────────────────
  lastSource: { source: "local" | "remote"; agentId?: string } | null;

  // ── Filter ───────────────────────────────────────────────────
  filter: ScanFilter;

  // ── UI state ─────────────────────────────────────────────────
  expandedDeviceId: string | null;
  selectedMapDeviceIp: string | null;
  requestMapTab: boolean;
  mapFocusOffline: boolean;

  // ── History (persisted via session state) ─────────────────────
  history: ScanHistoryEntry[];

  // ── Actions ──────────────────────────────────────────────────
  setTargets: (v: string) => void;
  setPorts: (v: string) => void;
  setTransport: (v: ScanTransport) => void;
  setTimeoutMs: (v: number) => void;
  setConcurrency: (v: number) => void;
  setMethod: (v: ScanMethod) => void;
  setScanMode: (v: ScanMode) => void;
  setEnrichmentPreset: (v: ScanEnrichmentPreset) => void;
  setFilter: (f: Partial<ScanFilter>) => void;
  clearFilter: () => void;
  setExpandedDevice: (id: string | null) => void;
  showOnMap: (ip: string) => void;
  showOfflineOnMap: () => void;
  clearMapRequest: () => void;
  clearMapFocus: () => void;
  setDeviceLabel: (device: DiscoveredDevice, label: string) => void;
  getDeviceLabel: (device: DiscoveredDevice) => string | null;
  clearResults: () => void;

  startScan: (ctx?: ExecutionContext) => Promise<void>;
  stopScan: () => Promise<void>;

  // Called from event listener when backend emits progress
  handleProgress: (event: ScanProgressEvent) => void;

  // History
  loadFromHistory: (entry: ScanHistoryEntry) => void;
  deleteHistory: (id: string) => void;
  clearHistory: () => void;

  // Computed
  getFilteredDevices: () => DiscoveredDevice[];
  getUniqueVendors: () => string[];
}

function parsePortsString(ports: string): number[] {
  return ports
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0 && n <= 65535);
}

function effectiveFlagsForPreset(preset: ScanEnrichmentPreset): ScanEnrichmentFlags {
  switch (preset) {
    case "fast":
      return { rdns: false, fingerprint: true, port_scan: false, banner_grab: false };
    case "deep":
      return { rdns: true, fingerprint: true, port_scan: true, banner_grab: true };
    case "balanced":
    default:
      return { ...DEFAULT_ENRICHMENT_FLAGS };
  }
}

function normalizeDeviceFields(device: DiscoveredDevice): DiscoveredDevice {
  const hostname = (device.hostname ?? "").trim();
  return {
    ...device,
    hostname: hostname.length > 0 ? hostname : null,
  };
}

function makeDeviceKey(device: DiscoveredDevice): string {
  const mac = (device.mac_address ?? "").trim().toLowerCase();
  if (mac) return `mac:${mac}`;
  return `ip:${device.ip}`;
}

function deviceSignature(device: DiscoveredDevice): string {
  const ports = device.open_ports
    .map((p) => `${p.port}/${p.protocol}:${p.service_name}:${p.banner}`)
    .sort()
    .join("|");
  return JSON.stringify({
    hostname: device.hostname ?? "",
    vendor: device.oui_vendor ?? "",
    fpVendor: device.fingerprint.vendor ?? "",
    fpModel: device.fingerprint.model ?? "",
    fpType: device.fingerprint.device_type ?? "unknown",
    ports,
    ua: device.user_agent ?? "",
    server: device.server_header ?? "",
  });
}

function computeDiffDetails(current: DiscoveredDevice[], baseline: DiscoveredDevice[]) {
  const currentMap = new Map(current.map((d) => [makeDeviceKey(d), d]));
  const baselineMap = new Map(baseline.map((d) => [makeDeviceKey(d), d]));
  const newKeys: string[] = [];
  const changedKeys: string[] = [];
  const offlineDevices: DiscoveredDevice[] = [];

  for (const [key, currentDevice] of currentMap.entries()) {
    const baselineDevice = baselineMap.get(key);
    if (!baselineDevice) {
      newKeys.push(key);
      continue;
    }
    if (deviceSignature(currentDevice) !== deviceSignature(baselineDevice)) {
      changedKeys.push(key);
    }
  }
  for (const [key, baselineDevice] of baselineMap.entries()) {
    if (!currentMap.has(key)) offlineDevices.push(baselineDevice);
  }

  return {
    summary: {
      newCount: newKeys.length,
      changedCount: changedKeys.length,
      offlineCount: offlineDevices.length,
    },
    newKeys,
    changedKeys,
    offlineDevices,
  };
}

function inferDeviceTypeForMappedDevice(
  vendor: string,
  hostname: string,
  openPorts: number[],
): DiscoveredDevice["fingerprint"]["device_type"] {
  const signal = `${vendor} ${hostname}`.toLowerCase();
  const has = (port: number) => openPorts.includes(port);
  const hasAny = (ports: number[]) => ports.some((p) => has(p));

  if (/opensips|kamailio|sip proxy|proxy/.test(signal)) return "proxy";
  if (/session border|\bsbc\b|oracle communications/.test(signal)) return "sbc";
  if (/asterisk|freepbx|freeswitch|3cx|\bpbx\b/.test(signal)) return "pbx";
  if (/linphone|microsip|zoiper|bria/.test(signal)) return "softphone";
  if (/yealink|polycom|grandstream|fanvil|avaya|mitel|snom|voip/.test(signal)) return "phone";
  if (/switch|catalyst|procurve/.test(signal)) return "switch";
  if (/access point|wireless|wifi|wlan|unifi ap/.test(signal)) return "accesspoint";
  if (/router|gateway|firewall|fortigate|mikrotik|palo alto/.test(signal)) return "router";
  if (/nas|synology|qnap|truenas/.test(signal)) return "nas";
  if (/printer|epson|xerox|brother/.test(signal) || hasAny([515, 631, 9100])) return "printer";
  if (/camera|hikvision|dahua|axis|cctv/.test(signal) || hasAny([554, 8554])) return "camera";
  if (/server|esxi|proxmox/.test(signal) || hasAny([1433, 1521, 3306, 5432, 6379, 9200, 27017])) return "server";
  if (/dell|lenovo|hewlett|hp inc|intel|microsoft|apple|asus|acer|laptop|desktop|workstation/.test(signal) || hasAny([3389, 5900, 445])) return "computer";
  if (/sonos|roku|chromecast|amazon|google|tuya|shelly|espressif|raspberry|iot/.test(signal)) return "iot";
  if (hasAny([5060, 5061])) return "gateway";
  return "unknown";
}

/** Map remote NormalizedDeviceScanResult to local ScanResult format. */
function mapNormalizedToScanResult(
  norm: NormalizedDeviceScanResult,
  _targets: string,
  scanMode: ScanMode,
): ScanResult {
  const devices: DiscoveredDevice[] = norm.devices.map((d) => {
    const deviceType = inferDeviceTypeForMappedDevice(d.vendor, d.hostname, d.open_ports);
    return normalizeDeviceFields({
      ip: d.ip,
      mac_address: d.mac || null,
      oui_vendor: d.vendor || null,
      hostname: d.hostname || null,
      open_ports: d.open_ports.map((p) => ({
        port: p,
        protocol: "tcp",
        status: "open",
        service_name: "",
        banner: d.banner,
      })),
      sip: null,
      rtt_ms: null,
      discovery_method: "arp" as const,
      port: 0,
      transport: "udp",
      status_code: 0,
      user_agent: "",
      server_header: "",
      allow_header: "",
      contact_header: "",
      fingerprint: { vendor: d.vendor, model: "", firmware: "", device_type: deviceType },
      raw_response: "",
    });
  });
  return {
    devices,
    total_ips_scanned: 0,
    total_ports_scanned: norm.devices.length,
    responded_count: norm.devices.length,
    duration_ms: norm.elapsed_ms,
    stopped: false,
    error: norm.error,
    scan_mode: scanMode,
  };
}

export const useNetworkDevicesStore = create<NetworkDevicesState>((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────
  status: "idle",
  error: null,

  targets: "",
  ports: "5060",
  transport: "udp",
  timeoutMs: 2000,
  concurrency: 20,
  method: "options",
  scanMode: "quick",
  enrichmentPreset: DEFAULT_ENRICHMENT_PRESET,
  enrichmentFlags: { ...DEFAULT_ENRICHMENT_FLAGS },

  devices: [],
  probed: 0,
  totalProbes: 0,
  durationMs: 0,
  phase: null,
  phaseLabel: null,
  phaseProbed: 0,
  phaseTotal: 0,
  diffSummary: null,
  newDeviceKeys: [],
  changedDeviceKeys: [],
  offlineDevices: [],
  previousSuccessfulDevices: [],
  deviceLabelCache: {},
  lastSource: null,

  filter: { ...DEFAULT_SCAN_FILTER },
  expandedDeviceId: null,
  selectedMapDeviceIp: null,
  requestMapTab: false,
  mapFocusOffline: false,

  history: [],

  // ── Config setters ─────────────────────────────────────────────
  setTargets: (v) => set({ targets: v }),
  setPorts: (v) => set({ ports: v }),
  setTransport: (v) => set({ transport: v }),
  setTimeoutMs: (v) => set({ timeoutMs: v }),
  setConcurrency: (v) => set({ concurrency: v }),
  setMethod: (v) => set({ method: v }),
  setScanMode: (v) => set({ scanMode: v }),
  setEnrichmentPreset: (v) => set({ enrichmentPreset: v, enrichmentFlags: effectiveFlagsForPreset(v) }),

  // ── Filter ─────────────────────────────────────────────────────
  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),
  clearFilter: () => set({ filter: { ...DEFAULT_SCAN_FILTER } }),

  // ── UI ─────────────────────────────────────────────────────────
  setExpandedDevice: (id) => set({ expandedDeviceId: id }),
  showOnMap: (ip) => set({ selectedMapDeviceIp: ip, requestMapTab: true, mapFocusOffline: false }),
  showOfflineOnMap: () => set({ selectedMapDeviceIp: null, requestMapTab: true, mapFocusOffline: true }),
  clearMapRequest: () => set({ requestMapTab: false }),
  clearMapFocus: () => set({ mapFocusOffline: false }),

  setDeviceLabel: (device, label) => {
    const key = makeDeviceKey(device);
    const now = Date.now();
    set((s) => ({
      deviceLabelCache: {
        ...s.deviceLabelCache,
        [key]: { key, label: label.trim(), updatedAt: now, expiresAt: now + DEFAULT_LABEL_TTL_MS },
      },
    }));
  },
  getDeviceLabel: (device) => {
    const key = makeDeviceKey(device);
    const entry = get().deviceLabelCache[key];
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) return null;
    return entry.label;
  },

  clearResults: () =>
    set({ devices: [], probed: 0, totalProbes: 0, durationMs: 0, phase: null, phaseLabel: null, phaseProbed: 0, phaseTotal: 0, diffSummary: null, newDeviceKeys: [], changedDeviceKeys: [], offlineDevices: [], error: null, status: "idle" }),

  // ── Scan ───────────────────────────────────────────────────────
  startScan: async (ctx?: ExecutionContext) => {
    const { targets, ports, transport, timeoutMs, concurrency, method, scanMode, enrichmentPreset, enrichmentFlags } = get();

    if (!targets.trim()) {
      set({ error: "Please enter target IPs or a CIDR range", status: "error" });
      return;
    }

    // Quick mode doesn't need ports validation
    if (scanMode !== "quick") {
      const parsedPorts = parsePortsString(ports);
      if (parsedPorts.length === 0) {
        set({ error: "Please enter at least one valid port", status: "error" });
        return;
      }
    }

    set({
      status: "running",
      error: null,
      devices: [],
      probed: 0,
      totalProbes: 0,
      durationMs: 0,
      phase: null,
      phaseLabel: null,
      phaseProbed: 0,
      phaseTotal: 0,
      expandedDeviceId: null,
    });

    try {
      const parsedPorts = parsePortsString(ports);
      const localScanFn = () =>
        api.networkDevicesScan(
          targets,
          parsedPorts.length > 0 ? parsedPorts : undefined,
          transport,
          timeoutMs,
          concurrency,
          method,
          scanMode,
          enrichmentPreset,
          enrichmentFlags,
        );
      const res = ctx
        ? await dispatchDeviceScan(ctx, targets.trim(), scanMode === "full", localScanFn)
        : { source: "local" as const, result: await localScanFn(), agentId: undefined };

      const result: ScanResult =
        res.source !== "local"
          ? mapNormalizedToScanResult(res.result as NormalizedDeviceScanResult, targets, scanMode)
          : (res.result as ScanResult);
      const normalizedDevices = result.devices.map(normalizeDeviceFields);

      // Save to history
      const historyEntry: ScanHistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        targets,
        ports: parsedPorts,
        transport,
        method,
        scanMode,
        devicesFound: result.responded_count,
        totalScanned: result.total_ports_scanned,
        durationMs: result.duration_ms,
        devices: normalizedDevices,
        succeeded: !result.error,
        error: result.error,
      };

      const baseline = get().previousSuccessfulDevices;
      const nextDiff = computeDiffDetails(normalizedDevices, baseline);

      set((s) => ({
        status: result.error ? "error" : "done",
        error: result.error,
        devices: normalizedDevices,
        durationMs: result.duration_ms,
        probed: result.total_ports_scanned,
        totalProbes: result.total_ports_scanned,
        phase: "finalizing",
        phaseLabel: "Finalizing results",
        phaseProbed: result.total_ports_scanned,
        phaseTotal: result.total_ports_scanned,
        diffSummary: nextDiff.summary,
        newDeviceKeys: nextDiff.newKeys,
        changedDeviceKeys: nextDiff.changedKeys,
        offlineDevices: nextDiff.offlineDevices,
        previousSuccessfulDevices: result.error ? s.previousSuccessfulDevices : normalizedDevices,
        lastSource: {
          source: res.source,
          agentId: res.agentId,
        },
        history: [historyEntry, ...s.history].slice(0, 20),
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: "error", error: msg });
    }
  },

  stopScan: async () => {
    try {
      await api.networkDevicesStopScan();
    } catch {
      // ignore
    }
  },

  // ── Live progress handler ──────────────────────────────────────
  handleProgress: (event) => {
    set((s) => {
      const phase = event.phase ?? s.phase;
      const phaseLabel = event.phase_label ?? s.phaseLabel;
      const phaseProbed = event.phase_probed ?? s.phaseProbed;
      const phaseTotal = event.phase_total ?? s.phaseTotal;
      if (!event.device) {
        // Progress-only update (no device payload)
        return {
          probed: event.probed,
          totalProbes: event.total,
          phase,
          phaseLabel,
          phaseProbed,
          phaseTotal,
        };
      }

      // Merge by IP: the backend re-emits devices as fields are populated
      // (e.g. Quick Scan re-emits after rDNS adds hostnames, Full Scan
      // re-emits after SIP info is merged). Upsert so we update in-place
      // instead of creating duplicates.
      const incoming = normalizeDeviceFields(event.device);
      const existingIdx = s.devices.findIndex((d) => d.ip === incoming.ip);

      const updatedDevices =
        existingIdx >= 0
          ? s.devices.map((d, i) => (i === existingIdx ? incoming : d))
          : [...s.devices, incoming];

      return {
        probed: event.probed,
        totalProbes: event.total,
        devices: updatedDevices,
        phase,
        phaseLabel,
        phaseProbed,
        phaseTotal,
      };
    });
  },

  // ── History ────────────────────────────────────────────────────
  loadFromHistory: (entry) => {
    const baseline = get().previousSuccessfulDevices;
      const normalizedDevices = entry.devices.map(normalizeDeviceFields);
      const nextDiff = computeDiffDetails(normalizedDevices, baseline);
    set({
      targets: entry.targets,
      ports: entry.ports.join(", "),
      transport: entry.transport,
      method: entry.method,
      scanMode: entry.scanMode ?? "sip",
      devices: normalizedDevices,
      status: "done",
      error: null,
      probed: entry.totalScanned,
      totalProbes: entry.totalScanned,
      durationMs: entry.durationMs,
      phase: "finalizing",
      phaseLabel: "Loaded from history",
      phaseProbed: entry.totalScanned,
      phaseTotal: entry.totalScanned,
      diffSummary: nextDiff.summary,
      newDeviceKeys: nextDiff.newKeys,
      changedDeviceKeys: nextDiff.changedKeys,
      offlineDevices: nextDiff.offlineDevices,
    });
  },

  deleteHistory: (id) =>
    set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

  clearHistory: () => set({ history: [] }),

  // ── Computed ───────────────────────────────────────────────────
  getFilteredDevices: () => {
    const { devices, filter, newDeviceKeys, changedDeviceKeys } = get();
    let filtered = devices;

    // Text search (across all string fields)
    if (filter.search) {
      const q = filter.search.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.ip.toLowerCase().includes(q) ||
          d.user_agent.toLowerCase().includes(q) ||
          d.server_header.toLowerCase().includes(q) ||
          d.fingerprint.vendor.toLowerCase().includes(q) ||
          d.fingerprint.model.toLowerCase().includes(q) ||
          d.fingerprint.firmware.toLowerCase().includes(q) ||
          d.allow_header.toLowerCase().includes(q) ||
          (d.mac_address ?? "").toLowerCase().includes(q) ||
          (d.oui_vendor ?? "").toLowerCase().includes(q) ||
          (d.hostname ?? "").toLowerCase().includes(q) ||
          String(d.port).includes(q) ||
          String(d.status_code).includes(q),
      );
    }

    // IP filter (prefix match)
    if (filter.ip) {
      const ipFilter = filter.ip.trim();
      filtered = filtered.filter((d) => d.ip.startsWith(ipFilter));
    }

    // Port filter (legacy SIP port, exact match, comma-separated)
    if (filter.port) {
      const portFilter = parsePortsString(filter.port);
      if (portFilter.length > 0) {
        filtered = filtered.filter((d) => portFilter.includes(d.port));
      }
    }

    // Open port filter (matches open_ports array)
    if (filter.openPort) {
      const openPortFilter = parsePortsString(filter.openPort);
      if (openPortFilter.length > 0) {
        filtered = filtered.filter((d) =>
          d.open_ports.some((p) => openPortFilter.includes(p.port)),
        );
      }
    }

    // Hostname filter (prefix match)
    if (filter.hostname) {
      const hf = filter.hostname.toLowerCase().trim();
      filtered = filtered.filter((d) =>
        (d.hostname ?? "").toLowerCase().includes(hf),
      );
    }

    // Has MAC filter
    if (filter.hasMac) {
      filtered = filtered.filter((d) => !!d.mac_address);
    }

    // Device type filter
    if (filter.deviceTypes.length > 0) {
      filtered = filtered.filter((d) =>
        filter.deviceTypes.includes(d.fingerprint.device_type),
      );
    }

    // Vendor filter (matches both SIP fingerprint vendor and OUI vendor)
    if (filter.vendor) {
      const vf = filter.vendor.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.fingerprint.vendor.toLowerCase() === vf ||
          (d.oui_vendor ?? "").toLowerCase() === vf,
      );
    }

    // Discovery method filter
    if (filter.discoveryMethod) {
      filtered = filtered.filter(
        (d) => d.discovery_method === filter.discoveryMethod,
      );
    }

    if (filter.diffStatus === "new") {
      const newSet = new Set(newDeviceKeys);
      filtered = filtered.filter((d) => newSet.has(makeDeviceKey(d)));
    } else if (filter.diffStatus === "changed") {
      const changedSet = new Set(changedDeviceKeys);
      filtered = filtered.filter((d) => changedSet.has(makeDeviceKey(d)));
    }

    return filtered;
  },

  getUniqueVendors: () => {
    const { devices } = get();
    const vendors = new Set<string>();
    for (const d of devices) {
      if (d.fingerprint.vendor) {
        vendors.add(d.fingerprint.vendor);
      }
      if (d.oui_vendor) {
        vendors.add(d.oui_vendor);
      }
    }
    return Array.from(vendors).sort();
  },
}));

function buildNetworkDiscoveryActivityItems(state: NetworkDevicesState): ActivityMonitorWorkItem[] {
  if (state.status !== "running") return [];
  return [{
    key: "network-network-device-scan",
    name: "Network device scan",
    detail: "In progress",
    state: "running",
    cpuPct: 14,
    memMb: 95,
    startedAt: Date.now() - 15_000,
    kind: "network",
  }];
}

useNetworkDevicesStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "network-devices-store",
    buildNetworkDiscoveryActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "network-devices-store",
  buildNetworkDiscoveryActivityItems(useNetworkDevicesStore.getState()),
);
