import { describe, expect, it } from "vitest";
import type { ExpertFinding, RtpStreamInfo } from "@/types/packetCapture";
import { buildFindingDisplayFilter, findingMatchesRtpStream } from "@/lib/expertFindingUtils";

function makeStream(overrides: Partial<RtpStreamInfo> = {}): RtpStreamInfo {
  return {
    ssrc: 871850167,
    srcIp: "207.202.16.21",
    srcPort: 34928,
    dstIp: "192.168.1.213",
    dstPort: 10064,
    payloadType: 0,
    codecName: "PCMU",
    packetCount: 148,
    lostPackets: 2,
    lossPercentage: 1.35,
    jitter: 0.3,
    mosScore: 4.0,
    firstPacketTime: "2026-03-12T05:27:22.000Z",
    lastPacketTime: "2026-03-12T05:31:06.000Z",
    ...overrides,
  };
}

function makeMediaFinding(values: string[]): ExpertFinding {
  return {
    id: "f-1",
    ruleId: "rtp-quality-drop",
    severity: "warning",
    category: "media",
    title: "RTP quality degraded",
    description: "Observed MOS 3.50",
    detail: "Potential jitter buffer stress",
    evidence: values.map((value, i) => ({
      evidenceType: "value",
      value,
      label: `e-${i}`,
      packetIndices: [],
    })),
    count: 1,
    firstSeen: "2026-03-12T05:27:22.000Z",
    lastSeen: "2026-03-12T05:31:06.000Z",
  };
}

describe("findingMatchesRtpStream", () => {
  it("does not match a finding for same IPs but different RTP ports", () => {
    const stream = makeStream();
    const finding = makeMediaFinding([
      "Observed MOS 3.50 on stream 207.202.16.21:34928 -> 192.168.1.213:10058",
    ]);

    expect(findingMatchesRtpStream(finding, stream)).toBe(false);
  });

  it("matches when finding references exact RTP endpoint pair", () => {
    const stream = makeStream();
    const finding = makeMediaFinding([
      "Observed MOS 4.00 on stream 207.202.16.21:34928 -> 192.168.1.213:10064",
    ]);

    expect(findingMatchesRtpStream(finding, stream)).toBe(true);
  });

  it("builds endpoint-specific RTP filter even when category is network", () => {
    const finding = makeMediaFinding([
      "Observed packet loss 27.69% on stream 207.202.16.21:34928 -> 192.168.1.213:10058",
    ]);
    finding.category = "network";

    const filter = buildFindingDisplayFilter(finding);
    expect(filter).toContain("udp.srcport == 34928");
    expect(filter).toContain("udp.dstport == 10058");
    expect(filter).not.toBe("udp || tcp");
  });
});
