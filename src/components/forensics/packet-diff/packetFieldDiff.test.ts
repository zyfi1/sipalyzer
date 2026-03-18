import { describe, expect, it } from "vitest";
import type { PacketInfo } from "@/types/packetCapture";
import { diffPacketFields } from "./packetFieldDiff";

function makeBasePacket(overrides: Partial<PacketInfo>): PacketInfo {
  return {
    timestamp: "2026-03-15T21:00:00.000Z",
    srcIp: "10.0.0.10",
    dstIp: "10.0.0.20",
    srcPort: 5060,
    dstPort: 5060,
    protocol: "SIP",
    size: 420,
    summary: "SIP INVITE",
    ...overrides,
  };
}

describe("diffPacketFields", () => {
  it("shows changed SIP fields and keeps stable fields as same", () => {
    const left = makeBasePacket({
      decoded: {
        application: {
          type: "Sip",
          data: {
            method: "INVITE",
            headers: { "Call-ID": "abc@left" },
            callId: "abc@left",
            cseq: "1 INVITE",
            via: [],
            rawMessage: "INVITE ...",
          },
        },
      },
    });
    const right = makeBasePacket({
      summary: "SIP 486 Busy Here",
      decoded: {
        application: {
          type: "Sip",
          data: {
            responseCode: 486,
            responseText: "Busy Here",
            headers: { "Call-ID": "abc@left" },
            callId: "abc@left",
            cseq: "1 INVITE",
            via: [],
            rawMessage: "SIP/2.0 486 Busy Here",
          },
        },
      },
    });

    const rows = diffPacketFields(left, right);
    const methodRow = rows.find((row) => row.key === "sip.method");
    const responseCodeRow = rows.find((row) => row.key === "sip.responseCode");
    const callIdRow = rows.find((row) => row.key === "sip.callId");

    expect(methodRow?.status).toBe("changed");
    expect(methodRow?.left).toBe("INVITE");
    expect(methodRow?.right).toBe("—");
    expect(responseCodeRow?.status).toBe("changed");
    expect(responseCodeRow?.right).toBe("486");
    expect(callIdRow?.status).toBe("same");
  });

  it("handles one-sided packets as left_only/right_only fields", () => {
    const left = makeBasePacket({
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
            sequenceNumber: 1024,
            timestamp: 90000,
            ssrc: 777,
            csrc: [],
          },
        },
      },
    });

    const rows = diffPacketFields(left, null);
    const rtpSeq = rows.find((row) => row.key === "rtp.sequenceNumber");
    const protocol = rows.find((row) => row.key === "packet.protocol");

    expect(rtpSeq?.status).toBe("left_only");
    expect(protocol?.status).toBe("left_only");
  });
});
