import { create } from "zustand";
import * as api from "@/api/sipDiscovery";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import type {
  DiscoveredDevice,
  ScanResult,
  ScanMethod,
  ScanTransport,
  ScanFilter,
  ScanHistoryEntry,
  ScanProgressEvent,
} from "@/types/sipDiscovery";
import { DEFAULT_SCAN_FILTER } from "@/types/sipDiscovery";

// ── Helpers ──────────────────────────────────────────────────────

type ScanStatus = "idle" | "running" | "done" | "error";

// ── Store ────────────────────────────────────────────────────────

interface SipDiscoveryState {
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

  // ── Results ──────────────────────────────────────────────────
  devices: DiscoveredDevice[];
  probed: number;
  totalProbes: number;
  durationMs: number;

  // ── Filter ───────────────────────────────────────────────────
  filter: ScanFilter;

  // ── UI state ─────────────────────────────────────────────────
  expandedDeviceId: string | null;

  // ── History (persisted via session state) ─────────────────────
  history: ScanHistoryEntry[];

  // ── Actions ──────────────────────────────────────────────────
  setTargets: (v: string) => void;
  setPorts: (v: string) => void;
  setTransport: (v: ScanTransport) => void;
  setTimeoutMs: (v: number) => void;
  setConcurrency: (v: number) => void;
  setMethod: (v: ScanMethod) => void;
  setFilter: (f: Partial<ScanFilter>) => void;
  clearFilter: () => void;
  setExpandedDevice: (id: string | null) => void;
  clearResults: () => void;

  startScan: () => Promise<void>;
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

export const useSipDiscoveryStore = create<SipDiscoveryState>((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────
  status: "idle",
  error: null,

  targets: "",
  ports: "5060",
  transport: "udp",
  timeoutMs: 2000,
  concurrency: 20,
  method: "options",

  devices: [],
  probed: 0,
  totalProbes: 0,
  durationMs: 0,

  filter: { ...DEFAULT_SCAN_FILTER },
  expandedDeviceId: null,

  history: [],

  // ── Config setters ─────────────────────────────────────────────
  setTargets: (v) => set({ targets: v }),
  setPorts: (v) => set({ ports: v }),
  setTransport: (v) => set({ transport: v }),
  setTimeoutMs: (v) => set({ timeoutMs: v }),
  setConcurrency: (v) => set({ concurrency: v }),
  setMethod: (v) => set({ method: v }),

  // ── Filter ─────────────────────────────────────────────────────
  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),
  clearFilter: () => set({ filter: { ...DEFAULT_SCAN_FILTER } }),

  // ── UI ─────────────────────────────────────────────────────────
  setExpandedDevice: (id) => set({ expandedDeviceId: id }),

  clearResults: () =>
    set({ devices: [], probed: 0, totalProbes: 0, durationMs: 0, error: null, status: "idle" }),

  // ── Scan ───────────────────────────────────────────────────────
  startScan: async () => {
    const { targets, ports, transport, timeoutMs, concurrency, method } = get();

    if (!targets.trim()) {
      set({ error: "Please enter target IPs or a CIDR range", status: "error" });
      return;
    }

    const parsedPorts = parsePortsString(ports);
    if (parsedPorts.length === 0) {
      set({ error: "Please enter at least one valid port", status: "error" });
      return;
    }

    set({
      status: "running",
      error: null,
      devices: [],
      probed: 0,
      totalProbes: 0,
      durationMs: 0,
      expandedDeviceId: null,
    });

    try {
      const result: ScanResult = await api.sipDiscoveryScan(
        targets,
        parsedPorts,
        transport,
        timeoutMs,
        concurrency,
        method,
      );

      // Save to history
      const historyEntry: ScanHistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        targets,
        ports: parsedPorts,
        transport,
        method,
        devicesFound: result.responded_count,
        totalScanned: result.total_ports_scanned,
        durationMs: result.duration_ms,
        devices: result.devices,
      };

      set((s) => ({
        status: result.error ? "error" : "done",
        error: result.error,
        devices: result.devices,
        durationMs: result.duration_ms,
        probed: result.total_ports_scanned,
        totalProbes: result.total_ports_scanned,
        history: [historyEntry, ...s.history].slice(0, 20),
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: "error", error: msg });
    }
  },

  stopScan: async () => {
    try {
      await api.sipDiscoveryStopScan();
    } catch {
      // ignore
    }
  },

  // ── Live progress handler ──────────────────────────────────────
  handleProgress: (event) => {
    set((s) => {
      const newDevices = event.device
        ? [...s.devices, event.device]
        : s.devices;
      return {
        probed: event.probed,
        totalProbes: event.total,
        devices: newDevices,
      };
    });
  },

  // ── History ────────────────────────────────────────────────────
  loadFromHistory: (entry) => {
    set({
      targets: entry.targets,
      ports: entry.ports.join(", "),
      transport: entry.transport,
      method: entry.method,
      devices: entry.devices,
      status: "done",
      error: null,
      probed: entry.totalScanned,
      totalProbes: entry.totalScanned,
      durationMs: entry.durationMs,
    });
  },

  deleteHistory: (id) =>
    set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

  clearHistory: () => set({ history: [] }),

  // ── Computed ───────────────────────────────────────────────────
  getFilteredDevices: () => {
    const { devices, filter } = get();
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
          String(d.port).includes(q) ||
          String(d.status_code).includes(q),
      );
    }

    // IP filter (prefix match)
    if (filter.ip) {
      const ipFilter = filter.ip.trim();
      filtered = filtered.filter((d) => d.ip.startsWith(ipFilter));
    }

    // Port filter (exact match, comma-separated)
    if (filter.port) {
      const portFilter = parsePortsString(filter.port);
      if (portFilter.length > 0) {
        filtered = filtered.filter((d) => portFilter.includes(d.port));
      }
    }

    // Device type filter
    if (filter.deviceTypes.length > 0) {
      filtered = filtered.filter((d) =>
        filter.deviceTypes.includes(d.fingerprint.device_type),
      );
    }

    // Vendor filter
    if (filter.vendor) {
      const vf = filter.vendor.toLowerCase();
      filtered = filtered.filter(
        (d) => d.fingerprint.vendor.toLowerCase() === vf,
      );
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
    }
    return Array.from(vendors).sort();
  },
}));

function buildSipDiscoveryActivityItems(state: SipDiscoveryState): ActivityMonitorWorkItem[] {
  if (state.status !== "running") return [];
  return [{
    key: "network-sip-discovery-scan",
    name: "SIP discovery scan",
    detail: "In progress",
    state: "running",
    cpuPct: 14,
    memMb: 95,
    startedAt: Date.now() - 15_000,
    kind: "network",
  }];
}

useSipDiscoveryStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "sip-discovery-store",
    buildSipDiscoveryActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "sip-discovery-store",
  buildSipDiscoveryActivityItems(useSipDiscoveryStore.getState()),
);
