import { describe, expect, it } from "vitest";
import type { PacketInfo } from "@/types/packetCapture";
import { buildPacketDiffRows, computePacketDiffPairingHealth, structuralPacketSignature } from "./packetDiffEngine";

describe("computePacketDiffPairingHealth", () => {
  it("aggregates row statuses", () => {
    const h = computePacketDiffPairingHealth([
      { key: "1", left: {} as never, right: {} as never, leftIndex: 0, rightIndex: 0, status: "exact" },
      { key: "2", left: {} as never, right: {} as never, leftIndex: 1, rightIndex: 1, status: "changed" },
      { key: "3", left: {} as never, right: null, leftIndex: 2, rightIndex: null, status: "left_only" },
      { key: "4", left: null, right: {} as never, leftIndex: null, rightIndex: 3, status: "right_only" },
    ]);
    expect(h.totalRows).toBe(4);
    expect(h.pairedRows).toBe(2);
    expect(h.orphanRows).toBe(2);
    expect(h.pairedFraction).toBe(0.5);
    expect(h.orphanFraction).toBe(0.5);
    expect(h.exactAmongPairedFraction).toBe(0.5);
    expect(h.changedAmongPairedFraction).toBe(0.5);
  });
});

describe("structuralPacketSignature", () => {
  it("ignores summary text so the same RTP header is not a false mismatch", () => {
    const base: PacketInfo = {
      timestamp: "2020-01-01T00:00:00.000Z",
      srcIp: "10.0.0.1",
      dstIp: "10.0.0.2",
      srcPort: 10000,
      dstPort: 20000,
      protocol: "UDP",
      size: 200,
      summary: "RTP version 2",
      decoded: {
        application: {
          type: "Rtp",
          data: {
            version: 2,
            padding: false,
            extension: false,
            csrcCount: 0,
            marker: false,
            payloadType: 0,
            sequenceNumber: 42,
            timestamp: 1000,
            ssrc: 99,
            csrc: [],
          },
        },
      },
    };
    const otherSummary = { ...base, summary: "Different dissect label", size: 172 };
    expect(structuralPacketSignature(base)).toBe(structuralPacketSignature(otherSummary));
  });

  it("pairs timestamp mode using protocol similarity, not only time", () => {
    const t0 = "2020-01-01T00:00:00.000Z";
    const t1 = "2020-01-01T00:00:00.010Z";
    const sip: PacketInfo = {
      timestamp: t0,
      srcIp: "10.0.0.1",
      dstIp: "10.0.0.2",
      srcPort: 5060,
      dstPort: 5060,
      protocol: "UDP",
      size: 100,
      summary: "SIP",
      originalIndex: 0,
      decoded: {
        application: {
          type: "Sip",
          data: {
            method: "OPTIONS",
            headers: {},
            callId: "x",
            cseq: "1 OPTIONS",
            via: [],
            rawMessage: "",
          },
        },
      },
    };
    const rtp: PacketInfo = {
      timestamp: t1,
      srcIp: "10.0.0.1",
      dstIp: "10.0.0.2",
      srcPort: 10000,
      dstPort: 20000,
      protocol: "UDP",
      size: 172,
      summary: "RTP",
      originalIndex: 1,
      decoded: {
        application: {
          type: "Rtp",
          data: {
            version: 2,
            padding: false,
            extension: false,
            csrcCount: 0,
            marker: false,
            payloadType: 0,
            sequenceNumber: 1,
            timestamp: 0,
            ssrc: 1,
            csrc: [],
          },
        },
      },
    };
    const sip2: PacketInfo = {
      ...sip,
      timestamp: t1,
      originalIndex: 2,
      decoded: {
        application: {
          type: "Sip",
          data: {
            method: "OPTIONS",
            headers: {},
            callId: "x",
            cseq: "2 OPTIONS",
            via: [],
            rawMessage: "",
          },
        },
      },
    };
    const rows = buildPacketDiffRows([sip], [rtp, sip2], {
      mode: "timestamp",
      timestampWindowMs: 50,
      maxRows: 20,
    });
    expect(rows[0]!.right?.originalIndex).toBe(2);
    expect(rows.some((r) => r.right?.originalIndex === 1)).toBe(true);
  });
});
