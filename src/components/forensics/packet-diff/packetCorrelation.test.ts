import { describe, expect, it } from "vitest";
import type { PacketInfo } from "@/types/packetCapture";
import { correlationKeysForPacket, voipQualityHint } from "./packetCorrelation";

describe("packetCorrelation", () => {
  it("extracts SIP call and transaction keys", () => {
    const packet: PacketInfo = {
      timestamp: "2020-01-01T00:00:00.000Z",
      srcIp: "10.0.0.1",
      dstIp: "10.0.0.2",
      srcPort: 5060,
      dstPort: 5060,
      protocol: "UDP",
      size: 100,
      summary: "INVITE",
      decoded: {
        application: {
          type: "Sip",
          data: {
            method: "INVITE",
            headers: {},
            via: [],
            rawMessage: "",
            callId: "abc@host",
            cseq: "1 INVITE",
          },
        },
      },
    };
    expect(correlationKeysForPacket(packet)).toEqual(["call:abc@host", "txn:abc@host:1"]);
  });

  it("extracts RTP SSRC key", () => {
    const packet: PacketInfo = {
      timestamp: "2020-01-01T00:00:00.000Z",
      srcIp: "10.0.0.1",
      dstIp: "10.0.0.2",
      srcPort: 10000,
      dstPort: 20000,
      protocol: "UDP",
      size: 172,
      summary: "RTP",
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
            sequenceNumber: 501,
            timestamp: 1000,
            ssrc: 0xdeadbeef,
            csrc: [],
          },
        },
      },
    };
    expect(correlationKeysForPacket(packet)).toEqual(["rtp:3735928559"]);
  });

  it("surfaces RTCP-XR MOS hints when present", () => {
    const packet: PacketInfo = {
      timestamp: "2020-01-01T00:00:00.000Z",
      srcIp: "10.0.0.1",
      dstIp: "10.0.0.2",
      srcPort: 10001,
      dstPort: 20001,
      protocol: "UDP",
      size: 120,
      summary: "RTCP",
      decoded: {
        application: {
          type: "Rtcp",
          data: {
            packets: [
              {
                version: 2,
                padding: false,
                count: 1,
                packetType: 207,
                length: 10,
                ssrc: 111,
                receiverReports: [],
                sdesItems: [],
                byeSsrcs: [],
                voipMetrics: {
                  ssrcSource: 111,
                  lossRate: 0,
                  discardRate: 0,
                  burstDensity: 0,
                  gapDensity: 0,
                  burstDuration: 0,
                  gapDuration: 0,
                  roundTripDelay: 0,
                  endSystemDelay: 0,
                  signalLevel: 0,
                  noiseLevel: 0,
                  rerl: 0,
                  gmin: 0,
                  rFactor: 80,
                  extRFactor: 0,
                  mosLq: 4.1,
                  mosCq: 4.2,
                  rxConfig: 0,
                  jbNominal: 0,
                  jbMaximum: 0,
                  jbAbsMax: 0,
                },
              },
            ],
          },
        },
      },
    };
    const hint = voipQualityHint(packet);
    expect(hint).toContain("MOS-LQ");
    expect(hint).toContain("MOS-CQ");
  });
});
