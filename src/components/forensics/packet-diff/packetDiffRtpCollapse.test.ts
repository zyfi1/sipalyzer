import { describe, expect, it } from "vitest";
import type { PacketDiffRow } from "./packetDiffEngine";
import {
  buildRtpCollapsedItems,
  collapsedRunSummary,
  DEFAULT_RTP_COLLAPSE_MIN_RUN,
  flattenVisibleItems,
  rtpExactStreamKey,
} from "./packetDiffRtpCollapse";

function rtpRow(key: string, seq: number, ssrc = 111, pt = 0): PacketDiffRow {
  const mkPacket = (seqN: number) => ({
    timestamp: `2020-01-01T00:00:${String(seqN % 60).padStart(2, "0")}.000Z`,
    srcIp: "10.0.0.1",
    dstIp: "10.0.0.2",
    srcPort: 10000,
    dstPort: 20000,
    protocol: "UDP",
    size: 172,
    summary: "RTP",
    originalIndex: seqN,
    decoded: {
      application: {
        type: "Rtp" as const,
        data: {
          version: 2,
          padding: false,
          extension: false,
          csrcCount: 0,
          marker: false,
          payloadType: pt,
          sequenceNumber: seqN,
          timestamp: seqN * 100,
          ssrc,
          csrc: [],
        },
      },
    },
  });
  const left = mkPacket(seq);
  const right = { ...left, originalIndex: seq + 1000 };
  return {
    key,
    left,
    right,
    leftIndex: left.originalIndex,
    rightIndex: right.originalIndex,
    status: "exact",
  };
}

describe("packetDiffRtpCollapse", () => {
  it("detects RTP exact stream keys", () => {
    const row = rtpRow("a", 1);
    expect(rtpExactStreamKey(row)).toBe("Rtp|111|0");
  });

  it("does not collapse short runs", () => {
    const rows = Array.from({ length: 5 }, (_, i) => rtpRow(`r${i}`, i));
    const items = buildRtpCollapsedItems(rows, { enabled: true, minRun: DEFAULT_RTP_COLLAPSE_MIN_RUN });
    expect(items).toHaveLength(5);
    expect(items.every((x) => x.kind === "single")).toBe(true);
  });

  it("collapses long exact RTP runs with same stream key", () => {
    const rows = Array.from({ length: 15 }, (_, i) => rtpRow(`r${i}`, i));
    const items = buildRtpCollapsedItems(rows, { enabled: true, minRun: 12 });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("collapsed");
    if (items[0]!.kind === "collapsed") {
      expect(items[0]!.rows).toHaveLength(15);
    }
  });

  it("breaks runs when stream key changes", () => {
    const a = Array.from({ length: 8 }, (_, i) => rtpRow(`a${i}`, i, 111, 0));
    const b = Array.from({ length: 8 }, (_, i) => rtpRow(`b${i}`, i + 100, 222, 0));
    const rows = [...a, ...b];
    const items = buildRtpCollapsedItems(rows, { enabled: true, minRun: 8 });
    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe("collapsed");
    expect(items[1]!.kind).toBe("collapsed");
  });

  it("flattens collapsed runs when expanded", () => {
    const rows = Array.from({ length: 12 }, (_, i) => rtpRow(`r${i}`, i));
    const items = buildRtpCollapsedItems(rows, { enabled: true, minRun: 12 });
    const id = items[0]!.kind === "collapsed" ? items[0]!.id : "";
    const flat = flattenVisibleItems(items, new Set([id]));
    expect(flat).toHaveLength(12);
    expect(flat.every((f) => f.collapsed === null)).toBe(true);
    expect(flat.every((f) => f.expandedFromCollapsedId === id)).toBe(true);
  });

  it("summarizes collapsed run", () => {
    const rows = Array.from({ length: 12 }, (_, i) => rtpRow(`r${i}`, 100 + i));
    const s = collapsedRunSummary(rows);
    expect(s).not.toBeNull();
    expect(s!.label).toContain("12");
    expect(s!.seqRange).toContain("100");
    expect(s!.seqRange).toContain("111");
  });
});
