import { create } from "zustand";
import * as dnsApi from "@/api/dns";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import type { ExecutionContext } from "@/stores/executionContextStore";
import {
  dispatchDns,
  dispatchDnsSipResolve,
  dispatchDnsReverse,
  dispatchDnsDig,
  dispatchDnsGeoIp,
} from "@/lib/executionDispatch";
import type { DnsResult } from "@/types/networkTest";
import type {
  DnsRecord,
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

// ── Helpers ─────────────────────────────────────────────────────────────

/** Convert DnsResult (from dispatchDns/networkDnsLookup) to DnsRecordSet for display. */
function dnsResultToRecordSet(r: DnsResult): DnsRecordSet {
  const records: DnsRecord[] = [];
  const domain = r.domain;
  r.a_records.forEach((v) =>
    records.push({ name: domain, record_type: "A", ttl: 0, data: { type: "A", value: v } })
  );
  r.aaaa_records.forEach((v) =>
    records.push({ name: domain, record_type: "AAAA", ttl: 0, data: { type: "AAAA", value: v } })
  );
  r.srv_records.forEach((s) =>
    records.push({
      name: domain,
      record_type: "SRV",
      ttl: 0,
      data: {
        type: "SRV",
        value: {
          service: s.service,
          priority: s.priority,
          weight: s.weight,
          port: s.port,
          target: s.target,
        },
      },
    })
  );
  r.naptr_records.forEach((n) =>
    records.push({
      name: domain,
      record_type: "NAPTR",
      ttl: 0,
      data: {
        type: "NAPTR",
        value: {
          order: n.order,
          preference: n.preference,
          flags: n.flags,
          service: n.service,
          regexp: n.regexp,
          replacement: n.replacement,
        },
      },
    })
  );
  return {
    domain,
    record_type: "A",
    server: null,
    records,
    resolution_ms: r.resolution_ms,
    success: r.success,
    error: r.error,
  };
}

// ── State helpers ───────────────────────────────────────────────────────

interface TestState<T> {
  status: "idle" | "running" | "done" | "error";
  result: T | null;
  error: string | null;
}

function idle<T>(): TestState<T> {
  return { status: "idle", result: null, error: null };
}

// ── Store ───────────────────────────────────────────────────────────────

interface DnsTestState {
  // Lookup
  lookup: TestState<DnsRecordSet>;
  lookupDomain: string;
  lookupRecordType: DnsRecordType;
  lookupServer: string;
  lookupTransport: "udp" | "tcp";

  // SIP Resolution
  sipResolve: TestState<SipResolutionChain>;
  sipResolveDomain: string;
  sipResolveServer: string;

  // Reverse DNS
  reverse: TestState<ReverseDnsResult>;
  reverseIp: string;
  reverseServer: string;
  reverseFcrdns: boolean;
  reverseBatch: TestState<BatchReverseDnsResult>;

  // Dig
  dig: TestState<RawDnsResponse>;
  digDomain: string;
  digRecordType: string;
  digServer: string;
  digUseTcp: boolean;
  digRd: boolean;
  digCd: boolean;
  digAd: boolean;

  // GeoIP
  geoip: TestState<GeoIpResult>;
  geoipIp: string;
  geoipBatch: TestState<BatchGeoIpResult>;

  // ASN
  asn: TestState<AsnResult>;

  // Multi-site
  multiSite: TestState<MultiSiteDnsComparison>;

  /** Source info for last execution context metadata. */
  lastSource: Record<string, { source: "local" | "remote"; agentId?: string }>;

  // ── Actions ──

  // Lookup
  setLookupDomain: (v: string) => void;
  setLookupRecordType: (v: DnsRecordType) => void;
  setLookupServer: (v: string) => void;
  setLookupTransport: (v: "udp" | "tcp") => void;
  runLookup: (ctx?: ExecutionContext) => Promise<void>;

  // SIP Resolution
  setSipResolveDomain: (v: string) => void;
  setSipResolveServer: (v: string) => void;
  runSipResolve: (ctx?: ExecutionContext) => Promise<void>;

  // Reverse DNS
  setReverseIp: (v: string) => void;
  setReverseServer: (v: string) => void;
  setReverseFcrdns: (v: boolean) => void;
  runReverse: (ctx?: ExecutionContext) => Promise<void>;
  runReverseBatch: (ips: string[]) => Promise<void>;

  // Dig
  setDigDomain: (v: string) => void;
  setDigRecordType: (v: string) => void;
  setDigServer: (v: string) => void;
  setDigUseTcp: (v: boolean) => void;
  setDigRd: (v: boolean) => void;
  setDigCd: (v: boolean) => void;
  setDigAd: (v: boolean) => void;
  runDig: (ctx?: ExecutionContext) => Promise<void>;

  // GeoIP
  setGeoipIp: (v: string) => void;
  runGeoip: (ctx?: ExecutionContext) => Promise<void>;
  runGeoipBatch: (ips: string[]) => Promise<void>;
  runAsnLookup: (ip: string) => Promise<void>;

  // Multi-site
  runMultiSite: (config: MultiSiteConfig) => Promise<void>;

  // Clear
  clearAll: () => void;
}

export const useDnsTestStore = create<DnsTestState>((set, get) => ({
  // ── Initial state ──
  lookup: idle(),
  lookupDomain: "",
  lookupRecordType: "A",
  lookupServer: "",
  lookupTransport: "udp",

  sipResolve: idle(),
  sipResolveDomain: "",
  sipResolveServer: "",

  reverse: idle(),
  reverseIp: "",
  reverseServer: "",
  reverseFcrdns: true,
  reverseBatch: idle(),

  dig: idle(),
  digDomain: "",
  digRecordType: "A",
  digServer: "",
  digUseTcp: false,
  digRd: true,
  digCd: false,
  digAd: false,

  geoip: idle(),
  geoipIp: "",
  geoipBatch: idle(),

  asn: idle(),

  multiSite: idle(),

  lastSource: {},

  // ── Setters ──
  setLookupDomain: (v) => set({ lookupDomain: v }),
  setLookupRecordType: (v) => set({ lookupRecordType: v }),
  setLookupServer: (v) => set({ lookupServer: v }),
  setLookupTransport: (v) => set({ lookupTransport: v }),

  setSipResolveDomain: (v) => set({ sipResolveDomain: v }),
  setSipResolveServer: (v) => set({ sipResolveServer: v }),

  setReverseIp: (v) => set({ reverseIp: v }),
  setReverseServer: (v) => set({ reverseServer: v }),
  setReverseFcrdns: (v) => set({ reverseFcrdns: v }),

  setDigDomain: (v) => set({ digDomain: v }),
  setDigRecordType: (v) => set({ digRecordType: v }),
  setDigServer: (v) => set({ digServer: v }),
  setDigUseTcp: (v) => set({ digUseTcp: v }),
  setDigRd: (v) => set({ digRd: v }),
  setDigCd: (v) => set({ digCd: v }),
  setDigAd: (v) => set({ digAd: v }),

  setGeoipIp: (v) => set({ geoipIp: v }),

  // ── Actions ──

  runLookup: async (ctx) => {
    const { lookupDomain, lookupRecordType, lookupServer, lookupTransport } = get();
    if (!lookupDomain.trim()) return;
    set({ lookup: { status: "running", result: null, error: null } });
    try {
      const domain = lookupDomain.trim();
      let result: DnsRecordSet;
      let source: "local" | "remote";
      let agentId: string | undefined;
      if (ctx) {
        const res = await dispatchDns(ctx, domain);
        result = dnsResultToRecordSet(res.result);
        source = res.source;
        agentId = res.agentId;
      } else {
        result = await dnsApi.dnsLookup(
          domain,
          lookupRecordType,
          lookupServer.trim() || undefined,
          undefined,
          lookupTransport
        );
        source = "local";
        agentId = undefined;
      }
      set((s) => ({
        lookup: { status: "done", result, error: result.error },
        lastSource: { ...s.lastSource, lookup: { source, agentId } },
      }));
    } catch (e: any) {
      set({ lookup: { status: "error", result: null, error: e.message } });
    }
  },

  runSipResolve: async (ctx) => {
    const { sipResolveDomain, sipResolveServer } = get();
    if (!sipResolveDomain.trim()) return;
    set({ sipResolve: { status: "running", result: null, error: null } });
    try {
      const domain = sipResolveDomain.trim();
      const server = sipResolveServer.trim() || undefined;
      let result: any;
      let source: "local" | "remote" = "local";
      let agentId: string | undefined;
      if (ctx) {
        const res = await dispatchDnsSipResolve(
          ctx, domain,
          () => dnsApi.dnsSipResolve(domain, server),
        );
        result = res.result;
        source = res.source;
        agentId = res.agentId;
      } else {
        result = await dnsApi.dnsSipResolve(domain, server);
      }
      set((s) => ({
        sipResolve: { status: "done", result, error: result.error },
        lastSource: { ...s.lastSource, sipResolve: { source, agentId } },
      }));
    } catch (e: any) {
      set({ sipResolve: { status: "error", result: null, error: e.message } });
    }
  },

  runReverse: async (ctx) => {
    const { reverseIp, reverseServer, reverseFcrdns } = get();
    if (!reverseIp.trim()) return;
    set({ reverse: { status: "running", result: null, error: null } });
    try {
      const ip = reverseIp.trim();
      const server = reverseServer.trim() || undefined;
      let result: any;
      let source: "local" | "remote" = "local";
      let agentId: string | undefined;
      if (ctx) {
        const res = await dispatchDnsReverse(
          ctx, ip,
          () => dnsApi.dnsReverse(ip, server, undefined, reverseFcrdns),
        );
        result = res.result;
        source = res.source;
        agentId = res.agentId;
      } else {
        result = await dnsApi.dnsReverse(ip, server, undefined, reverseFcrdns);
      }
      set((s) => ({
        reverse: { status: "done", result, error: result.error },
        lastSource: { ...s.lastSource, reverse: { source, agentId } },
      }));
    } catch (e: any) {
      set({ reverse: { status: "error", result: null, error: e.message } });
    }
  },

  runReverseBatch: async (ips: string[]) => {
    const { reverseServer, reverseFcrdns } = get();
    set({ reverseBatch: { status: "running", result: null, error: null } });
    try {
      const result = await dnsApi.dnsReverseBatch(
        ips,
        reverseServer.trim() || undefined,
        undefined,
        reverseFcrdns
      );
      set({ reverseBatch: { status: "done", result, error: null } });
    } catch (e: any) {
      set({ reverseBatch: { status: "error", result: null, error: e.message } });
    }
  },

  runDig: async (ctx) => {
    const { digDomain, digRecordType, digServer, digUseTcp, digRd, digCd, digAd } = get();
    if (!digDomain.trim()) return;
    set({ dig: { status: "running", result: null, error: null } });
    try {
      const hostname = digDomain.trim();
      const server = digServer.trim() || undefined;
      let result: any;
      let source: "local" | "remote" = "local";
      let agentId: string | undefined;
      if (ctx) {
        const res = await dispatchDnsDig(
          ctx, hostname, digRecordType, server,
          () => dnsApi.dnsDig(hostname, digRecordType, server, undefined, digUseTcp, digRd, digCd, digAd),
        );
        result = res.result;
        source = res.source;
        agentId = res.agentId;
      } else {
        result = await dnsApi.dnsDig(hostname, digRecordType, server, undefined, digUseTcp, digRd, digCd, digAd);
      }
      set((s) => ({
        dig: { status: "done", result, error: result.error },
        lastSource: { ...s.lastSource, dig: { source, agentId } },
      }));
    } catch (e: any) {
      set({ dig: { status: "error", result: null, error: e.message } });
    }
  },

  runGeoip: async (ctx) => {
    const { geoipIp } = get();
    if (!geoipIp.trim()) return;
    set({ geoip: { status: "running", result: null, error: null } });
    try {
      const ip = geoipIp.trim();
      let result: any;
      let source: "local" | "remote" = "local";
      let agentId: string | undefined;
      if (ctx) {
        const res = await dispatchDnsGeoIp(
          ctx, ip,
          () => dnsApi.dnsGeoIp(ip),
        );
        result = res.result;
        source = res.source;
        agentId = res.agentId;
      } else {
        result = await dnsApi.dnsGeoIp(ip);
      }
      set((s) => ({
        geoip: { status: "done", result, error: result.error },
        lastSource: { ...s.lastSource, geoip: { source, agentId } },
      }));
    } catch (e: any) {
      set({ geoip: { status: "error", result: null, error: e.message } });
    }
  },

  runGeoipBatch: async (ips: string[]) => {
    set({ geoipBatch: { status: "running", result: null, error: null } });
    try {
      const result = await dnsApi.dnsGeoIpBatch(ips);
      set({ geoipBatch: { status: "done", result, error: null } });
    } catch (e: any) {
      set({ geoipBatch: { status: "error", result: null, error: e.message } });
    }
  },

  runAsnLookup: async (ip: string) => {
    set({ asn: { status: "running", result: null, error: null } });
    try {
      const result = await dnsApi.dnsAsnLookup(ip);
      set({ asn: { status: "done", result, error: result.error } });
    } catch (e: any) {
      set({ asn: { status: "error", result: null, error: e.message } });
    }
  },

  runMultiSite: async (config: MultiSiteConfig) => {
    set({ multiSite: { status: "running", result: null, error: null } });
    try {
      const result = await dnsApi.dnsMultiSite(config);
      set({ multiSite: { status: "done", result, error: null } });
    } catch (e: any) {
      set({ multiSite: { status: "error", result: null, error: e.message } });
    }
  },

  clearAll: () =>
    set({
      lookup: idle(),
      sipResolve: idle(),
      reverse: idle(),
      reverseBatch: idle(),
      dig: idle(),
      geoip: idle(),
      geoipBatch: idle(),
      asn: idle(),
      multiSite: idle(),
    }),
}));

function buildDnsActivityItems(state: DnsTestState): ActivityMonitorWorkItem[] {
  const statusMap: Array<[string, string]> = [
    [state.lookup.status, "DNS lookup"],
    [state.sipResolve.status, "SIP DNS resolve"],
    [state.reverse.status, "Reverse DNS"],
    [state.reverseBatch.status, "Reverse DNS batch"],
    [state.dig.status, "DNS dig"],
    [state.geoip.status, "GeoIP lookup"],
    [state.geoipBatch.status, "GeoIP batch"],
    [state.asn.status, "ASN lookup"],
    [state.multiSite.status, "Multi-site DNS"],
  ];
  const rows: ActivityMonitorWorkItem[] = [];
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
  return rows;
}

useDnsTestStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "dns-test-store",
    buildDnsActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "dns-test-store",
  buildDnsActivityItems(useDnsTestStore.getState()),
);
