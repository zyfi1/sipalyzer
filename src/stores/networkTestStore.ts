import { create } from "zustand";
import type {
  HealthCheckResult,
  PingResult,
  JitterResult,
  PacketLossResult,
  BandwidthResult,
  MosResult,
  TracerouteResult,
  MtuResult,
  DscpResult,
  PortScanResult,
  PortTestEntry,
  PortProfile,
  DnsResult,
  StunResult,
  TurnResult,
  RtpSimResult,
  NetInfoResult,
  WifiInfo,
  MonitorSample,
  SipProbeResult,
  SipProbePacketEvent,
  ProbeMethod,
  StunQualityResult,
  StunQualityPacketEvent,
  SpeedTestResult,
  SpeedTestProgressEvent,
} from "@/types/networkTest";
import * as api from "@/api/networkTest";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import type { ExecutionContext } from "@/stores/executionContextStore";
import { dispatchPing, dispatchTraceroute, dispatchDns, dispatchPortScan, dispatchSipProbe, dispatchStunTest } from "@/lib/executionDispatch";

/**
 * Parse a target string that may contain a port suffix.
 * "sip.example.com:6070" → { host: "sip.example.com", port: 6070 }
 * "sip.example.com"      → { host: "sip.example.com", port: undefined }
 * "[::1]:5060"           → { host: "::1", port: 5060 }
 */
function parseHostPort(target: string): { host: string; port: number | undefined } {
  const t = target.trim();
  if (!t) return { host: "", port: undefined };

  // Bracketed IPv6 like [::1]:5060
  if (t.startsWith("[")) {
    const bracket = t.indexOf("]");
    if (bracket > 0) {
      const hostPart = t.slice(1, bracket); // strip brackets
      const rest = t.slice(bracket + 1);
      if (rest.startsWith(":")) {
        const p = parseInt(rest.slice(1), 10);
        if (p > 0 && p <= 65535) return { host: hostPart, port: p };
      }
      return { host: hostPart, port: undefined };
    }
  }

  // Only split on colon if exactly one colon (avoid IPv6 literals)
  const colons = (t.match(/:/g) || []).length;
  if (colons === 1) {
    const idx = t.lastIndexOf(":");
    const hostPart = t.slice(0, idx);
    const portStr = t.slice(idx + 1);
    const p = parseInt(portStr, 10);
    if (p > 0 && p <= 65535) return { host: hostPart, port: p };
  }

  return { host: t, port: undefined };
}

/** Standard SIP ports to always test. */
const DEFAULT_SIP_PORTS: PortTestEntry[] = [
  { port: 5060, protocol: "udp", label: "SIP UDP" },
  { port: 5060, protocol: "tcp", label: "SIP TCP" },
  { port: 5061, protocol: "tcp", label: "SIP TLS" },
  { port: 8443, protocol: "tcp", label: "WSS" },
];

/**
 * Build SIP port list, auto-including a custom port from the target if present.
 * e.g. userPort=6070 → adds TCP 6070 + UDP 6070 at the top, deduplicating against defaults.
 */
function buildSipPortList(userPort?: number, extraPorts?: PortTestEntry[]): PortTestEntry[] {
  const base = extraPorts ?? DEFAULT_SIP_PORTS;
  if (!userPort || userPort <= 0 || userPort > 65535) return base;

  // Add the user's port on both TCP and UDP at the top
  const custom: PortTestEntry[] = [
    { port: userPort, protocol: "tcp", label: `TCP ${userPort}` },
    { port: userPort, protocol: "udp", label: `UDP ${userPort}` },
  ];
  // Deduplicate: remove default entries that match the user port
  const filtered = base.filter((p) => p.port !== userPort);
  return [...custom, ...filtered];
}

/**
 * Parse a comma/space separated port list into PortTestEntry[].
 * Respects the user's proto mode selection.
 */
function parsePortsFromInput(input: string, mode: "both" | "tcp" | "udp" = "both"): PortTestEntry[] {
  const entries: PortTestEntry[] = [];
  const seen = new Set<string>();
  const protos: ("udp" | "tcp")[] = mode === "both" ? ["udp", "tcp"] : [mode];
  for (const part of input.split(/[,\s]+/).filter(Boolean)) {
    const p = parseInt(part.trim(), 10);
    if (isNaN(p) || p < 1 || p > 65535) continue;
    const label = p === 5060 ? "SIP" : p === 5061 ? "SIP TLS" : p === 8443 ? "WSS" : p === 3478 ? "STUN" : null;
    for (const proto of protos) {
      const key = `${p}:${proto}`;
      if (!seen.has(key)) { seen.add(key); entries.push({ port: p, protocol: proto, label: label ? `${label} ${proto.toUpperCase()}` : `${proto.toUpperCase()} ${p}` }); }
    }
  }
  return entries;
}

// ── Helpers ─────────────────────────────────────────────────────

type TestStatus = "idle" | "running" | "done" | "error";

interface TestState<T> {
  status: TestStatus;
  result: T | null;
  error: string | null;
}

function idle<T>(): TestState<T> {
  return { status: "idle", result: null, error: null };
}

function isCancelledMessage(error: string | null | undefined): boolean {
  return typeof error === "string" && error.toLowerCase().includes("cancelled");
}

/** Invalidate in-flight work: increment to skip late `set()` from abandoned runs. */
let portScanRunId = 0;
let speedTestRunId = 0;
let bandwidthTestRunId = 0;
let mtuRunId = 0;
let jitterRunId = 0;
let packetLossRunId = 0;
let turnRunId = 0;
let rtpSimRunId = 0;
let networkDnsRunId = 0;
let routeCompareRunId = 0;
let healthRunId = 0;
let netInfoRunId = 0;
let wifiRunId = 0;
let stunRunId = 0;
let stunQualityRunId = 0;
let sipProbeRunId = 0;
let voipAssessmentRunId = 0;
let voipPingRunId = 0;
let voipPortScanRunId = 0;
let voipDnsRunId = 0;
let voipDscpRunId = 0;
let voipStunRunId = 0;
let voipMosRunId = 0;
let bulkBatchToken = 0;

// ── Store ───────────────────────────────────────────────────────

export interface NetworkTestState {
  // ── Overview (auto health check) ──────────────────────────────
  healthCheck: TestState<HealthCheckResult>;
  runHealthCheck: () => Promise<void>;

  // ── General Tools ─────────────────────────────────────────────
  // These all work against any host — ICMP ping, TCP connections,
  // DNS queries, traceroute. No cooperating endpoint needed.

  ping: TestState<PingResult>;
  traceroute: TestState<TracerouteResult>;
  mtu: TestState<MtuResult>;
  dns: TestState<DnsResult>;
  portScan: TestState<PortScanResult>;
  stun: TestState<StunResult>;

  customPortEntries: PortTestEntry[];
  savedPortProfiles: PortProfile[];
  setCustomPortEntries: (entries: PortTestEntry[]) => void;
  addPortProfile: (profile: PortProfile) => void;
  removePortProfile: (id: string) => void;

  runPing: (host: string, count?: number, ctx?: ExecutionContext) => Promise<void>;
  runTraceroute: (host: string, ctx?: ExecutionContext) => Promise<void>;
  runMtu: (host: string) => Promise<void>;
  runDns: (domain: string, ctx?: ExecutionContext) => Promise<void>;
  runPortScan: (host: string, entries: PortTestEntry[], ctx?: ExecutionContext) => Promise<void>;
  runStun: (server?: string, ctx?: ExecutionContext) => Promise<void>;

  /** Source info for last execution (agentId when remote). */
  lastSource: Record<string, { source: "local" | "remote"; agentId?: string }>;

  // ── New Test States (Jitter, Packet Loss, Bandwidth, TURN, RTP Sim)
  jitterTest: TestState<JitterResult>;
  packetLossTest: TestState<PacketLossResult>;
  bandwidthTest: TestState<BandwidthResult>;
  turnTest: TestState<TurnResult>;
  rtpSim: TestState<RtpSimResult>;

  runJitterTest: (host: string, port?: number, count?: number, interval?: number) => Promise<void>;
  runPacketLossTest: (host: string, port?: number, burstSize?: number) => Promise<void>;
  runBandwidthTest: (host: string, port?: number, duration?: number) => Promise<void>;
  runTurnTest: (server: string, port?: number, user?: string, pass?: string) => Promise<void>;
  runRtpSim: (host: string, port?: number, ptime?: number, duration?: number, codec?: string) => Promise<void>;

  // ── Bulk Run Orchestration ──────────────────────────────────────
  bulkRunning: boolean;
  bulkProgress: { completed: number; total: number } | null;
  runAllTests: (host: string) => Promise<void>;
  runGroup: (group: string, host: string) => Promise<void>;

  // ── VoIP Assessment ───────────────────────────────────────────
  // Practical VoIP testing tools. Primary quality metric is ICMP
  // ping to the actual server (works with any host). Supplementary
  // tools use TCP connect, DNS, DSCP, STUN — all universal.

  voipTarget: string;
  setVoipTarget: (host: string) => void;
  voipRunning: boolean;

  // Quality: ping to the actual server (50 rapid pings → MOS)
  voipPing: TestState<PingResult>;
  voipMos: TestState<MosResult>;

  // Connectivity: SIP port reachability
  voipPortScan: TestState<PortScanResult>;
  voipCustomPorts: string;
  setVoipCustomPorts: (ports: string) => void;
  voipProtoMode: "both" | "tcp" | "udp";
  setVoipProtoMode: (mode: "both" | "tcp" | "udp") => void;

  // DNS: SRV/NAPTR/A record lookup
  voipDns: TestState<DnsResult>;

  // QoS: DSCP EF marking test
  voipDscp: TestState<DscpResult>;

  // NAT: STUN-based NAT detection
  voipStun: TestState<StunResult>;

  // UDP quality: STUN quality probe at VoIP rates
  stunQuality: TestState<StunQualityResult>;
  stunQualityPackets: StunQualityPacketEvent[];
  addStunQualityPacket: (pkt: StunQualityPacketEvent) => void;
  clearStunQualityPackets: () => void;

  // SIP probe: server reachability check (optional advanced tool)
  sipProbe: TestState<SipProbeResult>;
  sipProbePackets: SipProbePacketEvent[];
  addSipProbePacket: (pkt: SipProbePacketEvent) => void;
  clearSipProbePackets: () => void;
  voipProbeMethod: ProbeMethod;
  setVoipProbeMethod: (method: ProbeMethod) => void;

  // Actions
  runVoipAssessment: () => Promise<void>;
  runVoipPing: () => Promise<void>;
  runVoipPortScan: (customPorts?: PortTestEntry[]) => Promise<void>;
  runVoipDns: () => Promise<void>;
  runVoipDscp: () => Promise<void>;
  runVoipStun: () => Promise<void>;
  runStunQuality: (server?: string, count?: number, intervalMs?: number) => Promise<void>;
  runSipProbe: (port?: number, count?: number, method?: ProbeMethod, ctx?: ExecutionContext) => Promise<void>;

  // ── Speed Test ──────────────────────────────────────────────────
  speedTest: TestState<SpeedTestResult>;
  speedTestProgress: SpeedTestProgressEvent | null;
  speedTestCachedAt: number | null;
  setSpeedTestProgress: (evt: SpeedTestProgressEvent | null) => void;
  runSpeedTest: (forceRefresh?: boolean, source?: string) => Promise<void>;

  // ── Route Comparison ───────────────────────────────────────────
  routeTargetA: string;
  routeTargetB: string;
  setRouteTargetA: (host: string) => void;
  setRouteTargetB: (host: string) => void;
  routeResultA: TestState<TracerouteResult>;
  routeResultB: TestState<TracerouteResult>;
  routeComparing: boolean;
  runRouteComparison: () => Promise<void>;

  // ── Monitor (ICMP-based, works against any host) ──────────────
  monitorTarget: string;
  setMonitorTarget: (host: string) => void;
  monitorRunning: boolean;
  monitorSamples: MonitorSample[];

  startMonitor: (host: string, durationSecs?: number, intervalMs?: number) => Promise<void>;
  stopMonitor: () => Promise<void>;
  addMonitorSample: (sample: MonitorSample) => void;
  clearMonitorSamples: () => void;
  setMonitorRunning: (running: boolean) => void;

  // ── Environment ───────────────────────────────────────────────
  netInfo: TestState<NetInfoResult>;
  wifi: TestState<WifiInfo>;
  wifiCachedAt: number | null;
  fetchNetInfo: () => Promise<void>;
  fetchWifi: (forceRefresh?: boolean) => Promise<void>;

  /** OS-backed probes — call backend cancel then rely on normal completion paths. */
  requestStopPing: () => Promise<void>;
  requestStopTraceroute: () => Promise<void>;
  requestStopMtr: () => Promise<void>;
  stopRouteComparison: () => void;
  /** UI dismiss: abandon in-flight work (backend may still finish; late results ignored). */
  dismissPortScan: () => void;
  dismissSpeedTest: () => void;
  dismissBandwidthTest: () => void;
  dismissMtu: () => void;
  dismissJitterTest: () => void;
  dismissPacketLossTest: () => void;
  dismissTurnTest: () => void;
  dismissRtpSim: () => void;
  dismissNetworkDns: () => void;
  dismissStun: () => void;
  dismissStunQuality: () => void;
  dismissSipProbe: () => void;
  dismissHealthCheck: () => void;
  dismissNetInfo: () => void;
  dismissWifi: () => void;
  dismissVoipPing: () => void;
  dismissVoipPortScan: () => void;
  dismissVoipDns: () => void;
  dismissVoipDscp: () => void;
  dismissVoipStun: () => void;
  dismissVoipMos: () => void;
  abortBulkTestSuite: () => void;
  stopDiagnosticGroup: (group: "latency" | "routing" | "performance" | "environment" | "voip") => void;
  abortVoipAssessment: () => Promise<void>;
}

export const useNetworkTestStore = create<NetworkTestState>((set, get) => ({
  // ── Overview ────────────────────────────────────────────────────
  healthCheck: idle(),

  runHealthCheck: async () => {
    const runId = ++healthRunId;
    set({ healthCheck: { status: "running", result: null, error: null } });
    try {
      const result = await api.networkHealthCheck();
      if (runId !== healthRunId) return;
      set({ healthCheck: { status: "done", result, error: null } });
    } catch (e: any) {
      if (runId !== healthRunId) return;
      set({ healthCheck: { status: "error", result: null, error: e.message } });
    }
  },

  // ── Execution source tracking ──────────────────────────────────
  lastSource: {},

  // ── General Tools ───────────────────────────────────────────────
  ping: idle(),
  traceroute: idle(),
  mtu: idle(),
  dns: idle(),
  portScan: idle(),
  stun: idle(),

  customPortEntries: [],
  savedPortProfiles: [],
  setCustomPortEntries: (entries) => set({ customPortEntries: entries }),
  addPortProfile: (profile) =>
    set((s) => ({ savedPortProfiles: [...s.savedPortProfiles, profile] })),
  removePortProfile: (id) =>
    set((s) => ({ savedPortProfiles: s.savedPortProfiles.filter((p) => p.id !== id) })),

  runPing: async (host, count, ctx) => {
    set({ ping: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchPing(ctx, host, count)
        : { source: "local" as const, result: await api.networkPing(host, count), agentId: undefined };
      if (isCancelledMessage(res.result.error)) {
        set((s) => ({
          ping: { status: "idle", result: s.ping.result, error: null },
          lastSource: { ...s.lastSource, ping: { source: res.source, agentId: res.agentId } },
        }));
        return;
      }
      set((s) => ({
        ping: { status: "done", result: res.result, error: res.result.error },
        lastSource: { ...s.lastSource, ping: { source: res.source, agentId: res.agentId } },
      }));
    } catch (e: any) {
      set({ ping: { status: "error", result: null, error: e.message } });
    }
  },

  runTraceroute: async (host, ctx) => {
    set({ traceroute: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchTraceroute(ctx, host)
        : { source: "local" as const, result: await api.networkTraceroute(host), agentId: undefined };
      if (isCancelledMessage(res.result.error)) {
        set((s) => ({
          traceroute: { status: "idle", result: s.traceroute.result, error: null },
          lastSource: { ...s.lastSource, traceroute: { source: res.source, agentId: res.agentId } },
        }));
        return;
      }
      set((s) => ({
        traceroute: { status: "done", result: res.result, error: res.result.error },
        lastSource: { ...s.lastSource, traceroute: { source: res.source, agentId: res.agentId } },
      }));
    } catch (e: any) {
      set({ traceroute: { status: "error", result: null, error: e.message } });
    }
  },

  runMtu: async (host) => {
    const runId = ++mtuRunId;
    set({ mtu: { status: "running", result: null, error: null } });
    try {
      const result = await api.networkMtuDiscovery(host);
      if (runId !== mtuRunId) return;
      set({ mtu: { status: "done", result, error: result.error } });
    } catch (e: any) {
      if (runId !== mtuRunId) return;
      set({ mtu: { status: "error", result: null, error: e.message } });
    }
  },

  runDns: async (domain, ctx) => {
    const runId = ++networkDnsRunId;
    set({ dns: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchDns(ctx, domain)
        : { source: "local" as const, result: await api.networkDnsLookup(domain), agentId: undefined };
      if (runId !== networkDnsRunId) return;
      set((s) => ({
        dns: { status: "done", result: res.result, error: res.result.error },
        lastSource: { ...s.lastSource, dns: { source: res.source, agentId: res.agentId } },
      }));
    } catch (e: any) {
      if (runId !== networkDnsRunId) return;
      set({ dns: { status: "error", result: null, error: e.message } });
    }
  },

  runPortScan: async (host, entries, ctx) => {
    const runId = ++portScanRunId;
    set({ portScan: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchPortScan(ctx, host, entries)
        : { source: "local" as const, result: await api.networkPortScan(host, entries), agentId: undefined };
      if (runId !== portScanRunId) return;
      set((s) => ({
        portScan: { status: "done", result: res.result, error: res.result.error },
        lastSource: { ...s.lastSource, portScan: { source: res.source, agentId: res.agentId } },
      }));
    } catch (e: any) {
      if (runId !== portScanRunId) return;
      set({ portScan: { status: "error", result: null, error: e.message } });
    }
  },

  runStun: async (server, ctx) => {
    const runId = ++stunRunId;
    set({ stun: { status: "running", result: null, error: null } });
    try {
      const res = ctx
        ? await dispatchStunTest(ctx, server)
        : { source: "local" as const, result: await api.networkStunTest(server), agentId: undefined };
      if (runId !== stunRunId) return;
      set((s) => ({
        stun: { status: "done", result: res.result, error: res.result.error },
        lastSource: { ...s.lastSource, stun: { source: res.source, agentId: res.agentId } },
      }));
    } catch (e: any) {
      if (runId !== stunRunId) return;
      set({ stun: { status: "error", result: null, error: e.message } });
    }
  },

  // ── New Test Implementations ────────────────────────────────────
  jitterTest: idle(),
  packetLossTest: idle(),
  bandwidthTest: idle(),
  turnTest: idle(),
  rtpSim: idle(),

  runJitterTest: async (host, port, count, interval) => {
    const runId = ++jitterRunId;
    set({ jitterTest: { status: "running", result: null, error: null } });
    try {
      const result = await api.networkJitter(host, port, count, interval);
      if (runId !== jitterRunId) return;
      set({ jitterTest: { status: "done", result, error: result.error } });
    } catch (e: any) {
      if (runId !== jitterRunId) return;
      set({ jitterTest: { status: "error", result: null, error: e.message } });
    }
  },

  runPacketLossTest: async (host, port, burstSize) => {
    const runId = ++packetLossRunId;
    set({ packetLossTest: { status: "running", result: null, error: null } });
    try {
      const result = await api.networkPacketLoss(host, port, burstSize);
      if (runId !== packetLossRunId) return;
      set({ packetLossTest: { status: "done", result, error: result.error } });
    } catch (e: any) {
      if (runId !== packetLossRunId) return;
      set({ packetLossTest: { status: "error", result: null, error: e.message } });
    }
  },

  runBandwidthTest: async (host, port, duration) => {
    const runId = ++bandwidthTestRunId;
    set({ bandwidthTest: { status: "running", result: null, error: null } });
    try {
      const result = await api.networkBandwidth(host, port, duration);
      if (runId !== bandwidthTestRunId) return;
      set({ bandwidthTest: { status: "done", result, error: result.error } });
    } catch (e: any) {
      if (runId !== bandwidthTestRunId) return;
      set({ bandwidthTest: { status: "error", result: null, error: e.message } });
    }
  },

  runTurnTest: async (server, port, user, pass) => {
    const runId = ++turnRunId;
    set({ turnTest: { status: "running", result: null, error: null } });
    try {
      const result = await api.networkTurnTest(server, port, user, pass);
      if (runId !== turnRunId) return;
      set({ turnTest: { status: "done", result, error: result.error } });
    } catch (e: any) {
      if (runId !== turnRunId) return;
      set({ turnTest: { status: "error", result: null, error: e.message } });
    }
  },

  runRtpSim: async (host, port, ptime, duration, codec) => {
    const runId = ++rtpSimRunId;
    set({ rtpSim: { status: "running", result: null, error: null } });
    try {
      const result = await api.networkRtpSimulation(host, port, ptime, duration, codec);
      if (runId !== rtpSimRunId) return;
      set({ rtpSim: { status: "done", result, error: result.error } });
    } catch (e: any) {
      if (runId !== rtpSimRunId) return;
      set({ rtpSim: { status: "error", result: null, error: e.message } });
    }
  },

  // ── Bulk Run Orchestration ────────────────────────────────────
  bulkRunning: false,
  bulkProgress: null,

  runAllTests: async (host) => {
    if (!host) return;
    const batchId = ++bulkBatchToken;
    set({ bulkRunning: true, bulkProgress: { completed: 0, total: 20 } });
    const s = get();
    let completed = 0;
    const tick = () => { completed++; set({ bulkProgress: { completed, total: 20 } }); };

    try {
      await Promise.allSettled([
        // Latency & Quality
        s.runPing(host, 20).then(tick),
        s.runJitterTest(host).then(tick),
        s.runPacketLossTest(host).then(tick),
        s.runMtu(host).then(tick),
        // Routing & DNS
        s.runTraceroute(host).then(tick),
        s.runDns(host).then(tick),
        // Port Analysis (skip — needs entries)
        // Performance
        s.runSpeedTest(false).then(tick),
        s.runBandwidthTest(host).then(tick),
        s.runRtpSim(host).then(tick),
        // VoIP & SIP
        s.runVoipDscp().catch(() => api.networkDscpTest(host)).then(tick),
        s.runStun().then(tick),
        s.runStunQuality().then(tick),
        s.runTurnTest(host).then(tick),
        // Environment
        s.runHealthCheck().then(tick),
        s.fetchNetInfo().then(tick),
        s.fetchWifi().then(tick),
      ]);
    } finally {
      if (batchId === bulkBatchToken) {
        set({ bulkRunning: false, bulkProgress: null });
      }
    }
  },

  runGroup: async (group, host) => {
    if (!host) return;
    const s = get();
    switch (group) {
      case "latency":
        await Promise.allSettled([
          s.runPing(host, 20),
          s.runJitterTest(host),
          s.runPacketLossTest(host),
          s.runMtu(host),
        ]);
        break;
      case "routing":
        await Promise.allSettled([
          s.runTraceroute(host),
          s.runDns(host),
        ]);
        break;
      case "performance":
        await Promise.allSettled([
          s.runSpeedTest(false),
          s.runBandwidthTest(host),
        ]);
        break;
      case "voip":
        set({ voipTarget: host });
        await Promise.allSettled([
          s.runRtpSim(host),
          s.runStun(),
          s.runStunQuality(),
          s.runTurnTest(host),
          api.networkDscpTest(host).then(r => set({ voipDscp: { status: "done", result: r, error: r.error } })),
        ]);
        break;
      case "environment":
        await Promise.allSettled([
          s.runHealthCheck(),
          s.fetchNetInfo(),
          s.fetchWifi(),
        ]);
        break;
    }
  },

  // ── VoIP Assessment ─────────────────────────────────────────────
  voipTarget: "",
  setVoipTarget: (host) => set({ voipTarget: host }),
  voipRunning: false,
  voipProbeMethod: "auto" as ProbeMethod,
  setVoipProbeMethod: (method) => set({ voipProbeMethod: method }),

  // VoIP state
  voipPing: idle(),
  voipMos: idle(),
  voipPortScan: idle(),
  voipCustomPorts: "5060, 5061, 8443",
  setVoipCustomPorts: (ports) => set({ voipCustomPorts: ports }),
  voipProtoMode: "both" as "both" | "tcp" | "udp",
  setVoipProtoMode: (mode) => set({ voipProtoMode: mode }),
  voipDns: idle(),
  voipDscp: idle(),
  voipStun: idle(),

  stunQuality: idle(),
  stunQualityPackets: [],
  addStunQualityPacket: (pkt) =>
    set((s) => ({ stunQualityPackets: [...s.stunQualityPackets, pkt] })),
  clearStunQualityPackets: () => set({ stunQualityPackets: [] }),

  sipProbe: idle(),
  sipProbePackets: [],
  addSipProbePacket: (pkt) =>
    set((s) => ({ sipProbePackets: [...s.sipProbePackets, pkt] })),
  clearSipProbePackets: () => set({ sipProbePackets: [] }),

  // ── Helper: calculate MOS from ping result ──────────────────────
  _mosfromPing: (ping: PingResult) => {
    // Calculate jitter from consecutive RTT differences (RFC 3550 style)
    const rtts = ping.probes.filter((p) => p.rtt_ms !== null).map((p) => p.rtt_ms as number);
    let jitter = 0;
    if (rtts.length >= 2) {
      let sum = 0;
      for (let i = 1; i < rtts.length; i++) sum += Math.abs(rtts[i]! - rtts[i - 1]!);
      jitter = sum / (rtts.length - 1);
    }
    return { latency: ping.avg_ms, jitter, loss: ping.packet_loss_pct };
  },

  // ── Full Assessment ─────────────────────────────────────────────
  runVoipAssessment: async () => {
    const { host, port: userPort } = parseHostPort(get().voipTarget);
    if (!host) return;
    const assessmentId = ++voipAssessmentRunId;
    set({ voipRunning: true });

    const customInput = get().voipCustomPorts.trim();
    const protoMode = get().voipProtoMode;
    const sipPorts = customInput
      ? parsePortsFromInput(customInput, protoMode)
      : buildSipPortList(userPort);

    const [pingR] = await Promise.allSettled([
      (async () => {
        set({ voipPing: { status: "running", result: null, error: null } });
        const r = await api.networkPing(host, 50);
        if (assessmentId !== voipAssessmentRunId) return r;
        set({ voipPing: { status: "done", result: r, error: r.error } });
        return r;
      })(),
      (async () => {
        set({ voipPortScan: { status: "running", result: null, error: null } });
        const r = await api.networkPortScan(host, sipPorts);
        if (assessmentId !== voipAssessmentRunId) return;
        set({ voipPortScan: { status: "done", result: r, error: r.error } });
      })(),
      (async () => {
        set({ voipDns: { status: "running", result: null, error: null } });
        const r = await api.networkDnsLookup(host);
        if (assessmentId !== voipAssessmentRunId) return;
        set({ voipDns: { status: "done", result: r, error: r.error } });
      })(),
      (async () => {
        set({ voipDscp: { status: "running", result: null, error: null } });
        const r = await api.networkDscpTest(host);
        if (assessmentId !== voipAssessmentRunId) return;
        set({ voipDscp: { status: "done", result: r, error: r.error } });
      })(),
      (async () => {
        set({ voipStun: { status: "running", result: null, error: null } });
        const r = await api.networkStunTest();
        if (assessmentId !== voipAssessmentRunId) return;
        set({ voipStun: { status: "done", result: r, error: r.error } });
      })(),
      (async () => {
        set({ stunQuality: { status: "running", result: null, error: null }, stunQualityPackets: [] });
        const r = await api.networkStunQuality();
        if (assessmentId !== voipAssessmentRunId) return;
        set({ stunQuality: { status: "done", result: r, error: r.error } });
      })(),
    ]);

    const ping = pingR.status === "fulfilled" ? pingR.value : null;
    if (assessmentId !== voipAssessmentRunId) {
      set({ voipRunning: false });
      return;
    }
    if (ping && ping.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- store helper not on public type
      const { latency, jitter, loss } = (get() as any)._mosfromPing(ping);
      const mosRun = ++voipMosRunId;
      try {
        const mosResult = await api.networkCalculateMos(latency, jitter, loss);
        if (assessmentId !== voipAssessmentRunId || mosRun !== voipMosRunId) {
          set({ voipRunning: false });
          return;
        }
        set({ voipMos: { status: "done", result: mosResult, error: null } });
      } catch (e: any) {
        if (assessmentId !== voipAssessmentRunId || mosRun !== voipMosRunId) {
          set({ voipRunning: false });
          return;
        }
        set({ voipMos: { status: "error", result: null, error: e.message } });
      }
    }

    set({ voipRunning: false });
  },

  // ── Individual tool runners ─────────────────────────────────────

  runVoipPing: async () => {
    const { host } = parseHostPort(get().voipTarget);
    if (!host) return;
    const runId = ++voipPingRunId;
    set({ voipPing: { status: "running", result: null, error: null } });
    try {
      const r = await api.networkPing(host, 50);
      if (runId !== voipPingRunId) return;
      set({ voipPing: { status: "done", result: r, error: r.error } });
      if (r.success) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- store helper not on public type
        const { latency, jitter, loss } = (get() as any)._mosfromPing(r);
        const mosRun = ++voipMosRunId;
        try {
          const mos = await api.networkCalculateMos(latency, jitter, loss);
          if (runId !== voipPingRunId || mosRun !== voipMosRunId) return;
          set({ voipMos: { status: "done", result: mos, error: null } });
        } catch {
          /* ignore */
        }
      }
    } catch (e: any) {
      if (runId !== voipPingRunId) return;
      set({ voipPing: { status: "error", result: null, error: e.message } });
    }
  },

  runVoipPortScan: async (customPorts) => {
    const { host, port: userPort } = parseHostPort(get().voipTarget);
    if (!host) return;
    const customInput = get().voipCustomPorts.trim();
    const protoMode = get().voipProtoMode;
    const sipPorts = customPorts
      ?? (customInput ? parsePortsFromInput(customInput, protoMode) : buildSipPortList(userPort));
    const runId = ++voipPortScanRunId;
    set({ voipPortScan: { status: "running", result: null, error: null } });
    try {
      const r = await api.networkPortScan(host, sipPorts);
      if (runId !== voipPortScanRunId) return;
      set({ voipPortScan: { status: "done", result: r, error: r.error } });
    } catch (e: any) {
      if (runId !== voipPortScanRunId) return;
      set({ voipPortScan: { status: "error", result: null, error: e.message } });
    }
  },

  runVoipDns: async () => {
    const { host } = parseHostPort(get().voipTarget);
    if (!host) return;
    const runId = ++voipDnsRunId;
    set({ voipDns: { status: "running", result: null, error: null } });
    try {
      const r = await api.networkDnsLookup(host);
      if (runId !== voipDnsRunId) return;
      set({ voipDns: { status: "done", result: r, error: r.error } });
    } catch (e: any) {
      if (runId !== voipDnsRunId) return;
      set({ voipDns: { status: "error", result: null, error: e.message } });
    }
  },

  runVoipDscp: async () => {
    const { host } = parseHostPort(get().voipTarget);
    if (!host) return;
    const runId = ++voipDscpRunId;
    set({ voipDscp: { status: "running", result: null, error: null } });
    try {
      const r = await api.networkDscpTest(host);
      if (runId !== voipDscpRunId) return;
      set({ voipDscp: { status: "done", result: r, error: r.error } });
    } catch (e: any) {
      if (runId !== voipDscpRunId) return;
      set({ voipDscp: { status: "error", result: null, error: e.message } });
    }
  },

  runVoipStun: async () => {
    const runId = ++voipStunRunId;
    set({ voipStun: { status: "running", result: null, error: null } });
    try {
      const r = await api.networkStunTest();
      if (runId !== voipStunRunId) return;
      set({ voipStun: { status: "done", result: r, error: r.error } });
    } catch (e: any) {
      if (runId !== voipStunRunId) return;
      set({ voipStun: { status: "error", result: null, error: e.message } });
    }
  },

  runStunQuality: async (server, count, intervalMs) => {
    const runId = ++stunQualityRunId;
    set({ stunQuality: { status: "running", result: null, error: null }, stunQualityPackets: [] });
    try {
      const r = await api.networkStunQuality(server, undefined, count, intervalMs);
      if (runId !== stunQualityRunId) return;
      set({ stunQuality: { status: "done", result: r, error: r.error } });
    } catch (e: any) {
      if (runId !== stunQualityRunId) return;
      set({ stunQuality: { status: "error", result: null, error: e.message } });
    }
  },

  runSipProbe: async (port, count, method, ctx) => {
    const { host, port: userPort } = parseHostPort(get().voipTarget);
    if (!host) return;
    const m = method ?? get().voipProbeMethod;
    const effectivePort = port ?? userPort ?? 5060;
    const runId = ++sipProbeRunId;
    set({ sipProbe: { status: "running", result: null, error: null }, sipProbePackets: [] });
    try {
      if (ctx) {
        const res = await dispatchSipProbe(ctx, host, effectivePort, m);
        if (runId !== sipProbeRunId) return;
        set((s) => ({
          sipProbe: { status: "done", result: res.result, error: res.result.error },
          lastSource: { ...s.lastSource, sipProbe: { source: res.source, agentId: res.agentId } },
        }));
      } else {
        const r = await api.networkSipProbe(host, effectivePort, count ?? 20, 200, m);
        if (runId !== sipProbeRunId) return;
        set({ sipProbe: { status: "done", result: r, error: r.error } });
      }
    } catch (e: any) {
      if (runId !== sipProbeRunId) return;
      set({ sipProbe: { status: "error", result: null, error: e.message } });
    }
  },

  // ── Speed Test ──────────────────────────────────────────────────
  speedTest: idle(),
  speedTestProgress: null,
  speedTestCachedAt: null,
  setSpeedTestProgress: (evt) => set({ speedTestProgress: evt }),

  runSpeedTest: async (forceRefresh, source) => {
    const SPEED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    // Explicit/manual runs should default to a fresh measurement.
    // Internal callers can pass false to allow cached reads.
    const shouldForceRefresh = forceRefresh ?? true;
    const normalizedSource = source?.trim();
    const { speedTest, speedTestCachedAt } = get();
    const canUseCache = !shouldForceRefresh && !normalizedSource;
    if (canUseCache && speedTest.result && speedTestCachedAt && Date.now() - speedTestCachedAt < SPEED_CACHE_TTL) {
      return;
    }
    const runId = ++speedTestRunId;
    set({
      speedTest: { status: "running", result: speedTest.result, error: null },
      speedTestProgress: null,
    });
    try {
      const result = await api.networkSpeedTest(normalizedSource);
      if (runId !== speedTestRunId) return;
      set({ speedTest: { status: "done", result, error: result.error }, speedTestProgress: null, speedTestCachedAt: Date.now() });
    } catch (e: any) {
      if (runId !== speedTestRunId) return;
      set({
        speedTest: { status: "error", result: speedTest.result, error: e.message },
        speedTestProgress: null,
      });
    }
  },

  // ── Route Comparison ───────────────────────────────────────────
  routeTargetA: "",
  routeTargetB: "",
  setRouteTargetA: (host) => set({ routeTargetA: host }),
  setRouteTargetB: (host) => set({ routeTargetB: host }),
  routeResultA: idle(),
  routeResultB: idle(),
  routeComparing: false,

  runRouteComparison: async () => {
    const { routeTargetA, routeTargetB } = get();
    if (!routeTargetA || !routeTargetB) return;
    const runId = ++routeCompareRunId;
    set({
      routeComparing: true,
      routeResultA: { status: "running", result: null, error: null },
      routeResultB: { status: "running", result: null, error: null },
    });
    try {
      const [rA, rB] = await Promise.all([
        api.networkTraceroute(routeTargetA),
        api.networkTraceroute(routeTargetB),
      ]);
      if (runId !== routeCompareRunId) return;
      set({
        routeResultA: { status: "done", result: rA, error: rA.error },
        routeResultB: { status: "done", result: rB, error: rB.error },
        routeComparing: false,
      });
    } catch (e: any) {
      if (runId !== routeCompareRunId) return;
      set({
        routeResultA: { status: "error", result: null, error: e.message },
        routeResultB: { status: "error", result: null, error: e.message },
        routeComparing: false,
      });
    }
  },

  // ── Monitor ─────────────────────────────────────────────────────
  monitorTarget: "8.8.8.8",
  setMonitorTarget: (host) => set({ monitorTarget: host }),
  monitorRunning: false,
  monitorSamples: [],

  startMonitor: async (host, durationSecs, intervalMs) => {
    set({ monitorRunning: true, monitorSamples: [] });
    try {
      await api.networkStartMonitor(host, durationSecs, intervalMs);
    } catch (e: any) {
      set({ monitorRunning: false });
    }
  },

  stopMonitor: async () => {
    try {
      await api.networkStopMonitor();
    } finally {
      set({ monitorRunning: false });
    }
  },

  addMonitorSample: (sample) =>
    set((s) => ({ monitorSamples: [...s.monitorSamples, sample] })),
  clearMonitorSamples: () => set({ monitorSamples: [] }),
  setMonitorRunning: (running) => set({ monitorRunning: running }),

  // ── Environment ─────────────────────────────────────────────────
  netInfo: idle(),
  wifi: idle(),
  wifiCachedAt: null,

  fetchNetInfo: async () => {
    const runId = ++netInfoRunId;
    set({ netInfo: { status: "running", result: null, error: null } });
    try {
      const result = await api.networkGetInterfaces();
      if (runId !== netInfoRunId) return;
      set({ netInfo: { status: "done", result, error: result.error } });
    } catch (e: any) {
      if (runId !== netInfoRunId) return;
      set({ netInfo: { status: "error", result: null, error: e.message } });
    }
  },

  fetchWifi: async (forceRefresh) => {
    const WIFI_CACHE_TTL = 30 * 1000; // 30 seconds
    const { wifi, wifiCachedAt } = get();
    if (!forceRefresh && wifi.result && wifiCachedAt && Date.now() - wifiCachedAt < WIFI_CACHE_TTL) {
      return;
    }
    const runId = ++wifiRunId;
    set({ wifi: { ...wifi, status: "running", error: null } });
    try {
      const result = await api.networkGetWifiInfo();
      if (runId !== wifiRunId) return;
      set({ wifi: { status: "done", result, error: result.error }, wifiCachedAt: Date.now() });
    } catch (e: any) {
      if (runId !== wifiRunId) return;
      set({ wifi: { status: "error", result: wifi.result, error: e.message } });
    }
  },

  requestStopPing: async () => {
    try {
      await api.networkStopPing();
    } catch {
      /* ignore */
    }
  },

  requestStopTraceroute: async () => {
    try {
      await api.networkStopTraceroute();
    } catch {
      /* ignore */
    }
  },

  requestStopMtr: async () => {
    try {
      await api.networkStopMtr();
    } catch {
      /* ignore */
    }
  },

  stopRouteComparison: () => {
    routeCompareRunId++;
    void get().requestStopTraceroute();
    set({
      routeComparing: false,
      routeResultA: idle(),
      routeResultB: idle(),
    });
  },

  dismissPortScan: () => {
    portScanRunId++;
    set((s) =>
      s.portScan.status === "running"
        ? { portScan: { status: "idle", result: s.portScan.result, error: null } }
        : {},
    );
  },

  dismissSpeedTest: () => {
    speedTestRunId++;
    set((s) =>
      s.speedTest.status === "running"
        ? { speedTest: { status: "idle", result: s.speedTest.result, error: null }, speedTestProgress: null }
        : { speedTestProgress: null },
    );
  },

  dismissBandwidthTest: () => {
    bandwidthTestRunId++;
    set((s) =>
      s.bandwidthTest.status === "running"
        ? { bandwidthTest: { status: "idle", result: s.bandwidthTest.result, error: null } }
        : {},
    );
  },

  dismissMtu: () => {
    mtuRunId++;
    set((s) =>
      s.mtu.status === "running"
        ? { mtu: { status: "idle", result: s.mtu.result, error: null } }
        : {},
    );
  },

  dismissJitterTest: () => {
    jitterRunId++;
    set((s) =>
      s.jitterTest.status === "running"
        ? { jitterTest: { status: "idle", result: s.jitterTest.result, error: null } }
        : {},
    );
  },

  dismissPacketLossTest: () => {
    packetLossRunId++;
    set((s) =>
      s.packetLossTest.status === "running"
        ? { packetLossTest: { status: "idle", result: s.packetLossTest.result, error: null } }
        : {},
    );
  },

  dismissTurnTest: () => {
    turnRunId++;
    set((s) =>
      s.turnTest.status === "running"
        ? { turnTest: { status: "idle", result: s.turnTest.result, error: null } }
        : {},
    );
  },

  dismissRtpSim: () => {
    rtpSimRunId++;
    set((s) =>
      s.rtpSim.status === "running"
        ? { rtpSim: { status: "idle", result: s.rtpSim.result, error: null } }
        : {},
    );
  },

  dismissNetworkDns: () => {
    networkDnsRunId++;
    set((s) =>
      s.dns.status === "running"
        ? { dns: { status: "idle", result: s.dns.result, error: null } }
        : {},
    );
  },

  dismissStun: () => {
    stunRunId++;
    set((s) =>
      s.stun.status === "running"
        ? { stun: { status: "idle", result: s.stun.result, error: null } }
        : {},
    );
  },

  dismissStunQuality: () => {
    stunQualityRunId++;
    set((s) =>
      s.stunQuality.status === "running"
        ? { stunQuality: { status: "idle", result: s.stunQuality.result, error: null }, stunQualityPackets: [] }
        : {},
    );
  },

  dismissSipProbe: () => {
    sipProbeRunId++;
    set((s) =>
      s.sipProbe.status === "running"
        ? { sipProbe: { status: "idle", result: s.sipProbe.result, error: null }, sipProbePackets: [] }
        : { sipProbePackets: [] },
    );
  },

  dismissHealthCheck: () => {
    healthRunId++;
    set((s) =>
      s.healthCheck.status === "running"
        ? { healthCheck: { status: "idle", result: s.healthCheck.result, error: null } }
        : {},
    );
  },

  dismissNetInfo: () => {
    netInfoRunId++;
    set((s) =>
      s.netInfo.status === "running"
        ? { netInfo: { status: "idle", result: s.netInfo.result, error: null } }
        : {},
    );
  },

  dismissWifi: () => {
    wifiRunId++;
    set((s) =>
      s.wifi.status === "running"
        ? { wifi: { status: "idle", result: s.wifi.result, error: null } }
        : {},
    );
  },

  dismissVoipPing: () => {
    voipPingRunId++;
    voipMosRunId++;
    set((s) => ({
      voipPing: s.voipPing.status === "running" ? idle() : s.voipPing,
      voipMos: s.voipMos.status === "running" ? idle() : s.voipMos,
    }));
  },

  dismissVoipPortScan: () => {
    voipPortScanRunId++;
    set((s) => (s.voipPortScan.status === "running" ? { voipPortScan: idle() } : {}));
  },

  dismissVoipDns: () => {
    voipDnsRunId++;
    set((s) => (s.voipDns.status === "running" ? { voipDns: idle() } : {}));
  },

  dismissVoipDscp: () => {
    voipDscpRunId++;
    set((s) => (s.voipDscp.status === "running" ? { voipDscp: idle() } : {}));
  },

  dismissVoipStun: () => {
    voipStunRunId++;
    set((s) => (s.voipStun.status === "running" ? { voipStun: idle() } : {}));
  },

  dismissVoipMos: () => {
    voipMosRunId++;
    set((s) => (s.voipMos.status === "running" ? { voipMos: idle() } : {}));
  },

  abortBulkTestSuite: () => {
    bulkBatchToken++;
    set({ bulkRunning: false, bulkProgress: null });
    const s = get();
    void s.requestStopPing();
    void s.requestStopTraceroute();
    s.dismissJitterTest();
    s.dismissPacketLossTest();
    s.dismissMtu();
    s.dismissNetworkDns();
    s.dismissSpeedTest();
    s.dismissBandwidthTest();
    s.dismissRtpSim();
    s.dismissTurnTest();
    s.dismissStun();
    s.dismissStunQuality();
    s.dismissHealthCheck();
    s.dismissNetInfo();
    s.dismissWifi();
    voipDscpRunId++;
    set((st) => (st.voipDscp.status === "running" ? { voipDscp: idle() } : {}));
  },

  stopDiagnosticGroup: (group) => {
    const s = get();
    switch (group) {
      case "latency":
        void s.requestStopPing();
        s.dismissJitterTest();
        s.dismissPacketLossTest();
        s.dismissMtu();
        break;
      case "routing":
        void s.requestStopTraceroute();
        s.dismissNetworkDns();
        break;
      case "performance":
        s.dismissSpeedTest();
        s.dismissBandwidthTest();
        break;
      case "environment":
        s.dismissHealthCheck();
        s.dismissNetInfo();
        s.dismissWifi();
        break;
      case "voip":
        s.dismissRtpSim();
        s.dismissStun();
        s.dismissStunQuality();
        s.dismissTurnTest();
        voipDscpRunId++;
        set((st) => (st.voipDscp.status === "running" ? { voipDscp: idle() } : {}));
        break;
      default:
        break;
    }
  },

  abortVoipAssessment: async () => {
    voipAssessmentRunId++;
    voipPingRunId++;
    voipPortScanRunId++;
    voipDnsRunId++;
    voipDscpRunId++;
    voipStunRunId++;
    stunQualityRunId++;
    voipMosRunId++;
    try {
      await api.networkStopPing();
    } catch {
      /* ignore */
    }
    set((s) => ({
      voipRunning: false,
      voipPing: s.voipPing.status === "running" ? idle() : s.voipPing,
      voipPortScan: s.voipPortScan.status === "running" ? idle() : s.voipPortScan,
      voipDns: s.voipDns.status === "running" ? idle() : s.voipDns,
      voipDscp: s.voipDscp.status === "running" ? idle() : s.voipDscp,
      voipStun: s.voipStun.status === "running" ? idle() : s.voipStun,
      stunQuality: s.stunQuality.status === "running" ? idle() : s.stunQuality,
      stunQualityPackets: s.stunQuality.status === "running" ? [] : s.stunQualityPackets,
      voipMos: s.voipMos.status === "running" ? idle() : s.voipMos,
    }));
  },
}));

function buildNetworkActivityItems(state: NetworkTestState): ActivityMonitorWorkItem[] {
  const rows: ActivityMonitorWorkItem[] = [];
  if (state.monitorRunning) {
    rows.push({
      key: "network-monitor",
      name: "Network monitor",
      detail: "Continuous latency/jitter monitor",
      state: "running",
      cpuPct: 18,
      memMb: 130,
      startedAt: Date.now() - 15_000,
      kind: "network",
      canStop: true,
    });
  }
  if (state.voipRunning) {
    rows.push({
      key: "network-voip",
      name: "VoIP assessment",
      detail: "Running grouped VoIP diagnostics",
      state: "running",
      cpuPct: 22,
      memMb: 160,
      startedAt: Date.now() - 15_000,
      kind: "network",
    });
  }
  if (state.bulkRunning) {
    rows.push({
      key: "network-bulk",
      name: "Bulk network test suite",
      detail: "Running full diagnostics group",
      state: "running",
      cpuPct: 28,
      memMb: 210,
      startedAt: Date.now() - 15_000,
      kind: "network",
    });
  }
  if (state.routeComparing) {
    rows.push({
      key: "network-route",
      name: "Route comparison",
      detail: "Comparing path A/B quality",
      state: "running",
      cpuPct: 16,
      memMb: 120,
      startedAt: Date.now() - 15_000,
      kind: "network",
    });
  }

  const statusMap: Array<[string, string]> = [
    [state.speedTest.status, "Speed test"],
    [state.healthCheck.status, "Health check"],
    [state.ping.status, "Ping test"],
    [state.traceroute.status, "Traceroute"],
    [state.mtu.status, "MTU discovery"],
    [state.dns.status, "DNS test"],
    [state.portScan.status, "Port scan"],
    [state.stun.status, "STUN test"],
    [state.jitterTest.status, "Jitter test"],
    [state.packetLossTest.status, "Packet loss test"],
    [state.bandwidthTest.status, "Bandwidth test"],
    [state.turnTest.status, "TURN test"],
    [state.rtpSim.status, "RTP simulator"],
    [state.voipPing.status, "VoIP ping"],
    [state.voipMos.status, "VoIP MOS"],
    [state.voipPortScan.status, "VoIP port scan"],
    [state.voipDns.status, "VoIP DNS"],
    [state.voipDscp.status, "VoIP DSCP"],
    [state.voipStun.status, "VoIP STUN"],
    [state.stunQuality.status, "STUN quality"],
    [state.sipProbe.status, "SIP probe"],
    [state.netInfo.status, "Network info"],
    [state.wifi.status, "Wi-Fi test"],
    [state.routeResultA.status, "Route path A"],
    [state.routeResultB.status, "Route path B"],
  ];
  for (const [status, label] of statusMap) {
    if (status !== "running") continue;
    rows.push({
      key: `network-${label.toLowerCase().replace(/\s+/g, "-")}`,
      name: label,
      detail: "In progress",
      state: "running",
      cpuPct: 14,
      memMb: 95,
      startedAt: Date.now() - 15_000,
      kind: "network",
    });
  }

  return rows.slice(0, 60);
}

useNetworkTestStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "network-test-store",
    buildNetworkActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "network-test-store",
  buildNetworkActivityItems(useNetworkTestStore.getState()),
);
