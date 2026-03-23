import { describe, expect, it } from "vitest";
import { buildNetworkTimelineAndFindings } from "@/lib/troubleshooting/networkInsights";
import type { NetworkSyncPayload } from "@/lib/troubleshooting/networkInsights";

function basePayload(): NetworkSyncPayload {
  return {
    voipTarget: "sip.example.com",
    healthCheck: { status: "idle", result: null, error: null },
    voipPing: { status: "idle", result: null, error: null },
    voipMos: { status: "idle", result: null, error: null },
    voipPortScan: { status: "idle", result: null, error: null },
    voipDns: { status: "idle", result: null, error: null },
    voipDscp: { status: "idle", result: null, error: null },
    voipStun: { status: "idle", result: null, error: null },
    stunQuality: { status: "idle", result: null, error: null },
    sipProbe: { status: "idle", result: null, error: null },
    ping: { status: "idle", result: null, error: null },
    dns: { status: "idle", result: null, error: null },
    traceroute: { status: "idle", result: null, error: null },
    portScan: { status: "idle", result: null, error: null },
    jitterTest: { status: "idle", result: null, error: null },
    packetLossTest: { status: "idle", result: null, error: null },
    speedTest: { status: "idle", result: null, error: null },
  };
}

describe("buildNetworkTimelineAndFindings", () => {
  it("flags all SIP ports closed", () => {
    const p = basePayload();
    p.voipPortScan = {
      status: "done",
      error: null,
      result: {
        host: "sip.example.com",
        success: true,
        error: null,
        results: [
          { port: 5060, protocol: "udp", label: null, status: "filtered", response_ms: null },
          { port: 5060, protocol: "tcp", label: null, status: "closed", response_ms: null },
          { port: 5061, protocol: "tcp", label: null, status: "closed", response_ms: null },
          { port: 8443, protocol: "tcp", label: null, status: "closed", response_ms: null },
        ],
      },
    };
    const { findings } = buildNetworkTimelineAndFindings(p, "2026-03-17T12:00:00.000Z");
    expect(findings.some((f) => f.id === "net-find-sip-ports-closed")).toBe(true);
  });

  it("emits network_test timeline rows for VoIP MOS", () => {
    const p = basePayload();
    p.voipMos = {
      status: "done",
      error: null,
      result: {
        r_factor: 75,
        mos: 4.2,
        quality: "good",
        latency_ms: 22,
        jitter_ms: 4,
        packet_loss_pct: 0.2,
      },
    };
    const { timeline } = buildNetworkTimelineAndFindings(p, "2026-03-17T12:00:00.000Z");
    const row = timeline.find((e) => e.id === "net-voip-mos");
    expect(row?.kind).toBe("network_test");
    expect(row?.success).toBe(true);
  });
});
