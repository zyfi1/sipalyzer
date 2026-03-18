import type { PacketInfo } from "@/types/packetCapture";

export type PacketDiffAlignmentMode = "index" | "timestamp" | "flow";
export type PacketDiffRowStatus = "exact" | "changed" | "left_only" | "right_only";

export interface PacketDiffRow {
  key: string;
  left: PacketInfo | null;
  right: PacketInfo | null;
  leftIndex: number | null;
  rightIndex: number | null;
  status: PacketDiffRowStatus;
}

export interface BuildPacketDiffRowsOptions {
  mode: PacketDiffAlignmentMode;
  timestampWindowMs: number;
  maxRows: number;
  showMismatchesOnly?: boolean;
}

function packetSignature(packet: PacketInfo): string {
  const app = packet.decoded?.application;
  let appSig = "na";
  if (app?.type === "Sip") {
    const d = app.data;
    appSig = d.method ? `sip:${d.method}:${d.cseq ?? ""}` : `sip:${d.responseCode ?? ""}:${d.cseq ?? ""}`;
  } else if (app?.type === "SipOverWs") {
    const d = app.data.sip;
    appSig = d.method ? `ws-sip:${d.method}:${d.cseq ?? ""}` : `ws-sip:${d.responseCode ?? ""}:${d.cseq ?? ""}`;
  } else if (app?.type === "Rtp" || app?.type === "Srtp") {
    appSig = `${app.type.toLowerCase()}:${app.data.payloadType}:${app.data.sequenceNumber}`;
  } else if (app?.type === "Rtcp") {
    appSig = `rtcp:${app.data.packets.map((p) => p.packetType).join(",")}`;
  } else if (app) {
    appSig = app.type.toLowerCase();
  }
  return [
    packet.protocol,
    packet.srcIp,
    packet.srcPort,
    packet.dstIp,
    packet.dstPort,
    packet.frameLength ?? packet.size,
    appSig,
    packet.summary,
  ].join("|");
}

function toTimestampMs(packet: PacketInfo): number {
  const parsed = Date.parse(packet.timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function rowStatus(left: PacketInfo | null, right: PacketInfo | null): PacketDiffRowStatus {
  if (left && right) {
    return packetSignature(left) === packetSignature(right) ? "exact" : "changed";
  }
  if (left) return "left_only";
  return "right_only";
}

function makeRow(left: PacketInfo | null, right: PacketInfo | null, ordinal: number): PacketDiffRow {
  return {
    key: `pkt-${ordinal}-${left?.originalIndex ?? "na"}-${right?.originalIndex ?? "na"}`,
    left,
    right,
    leftIndex: left?.originalIndex ?? null,
    rightIndex: right?.originalIndex ?? null,
    status: rowStatus(left, right),
  };
}

function finalizeRows(rows: PacketDiffRow[], options: BuildPacketDiffRowsOptions): PacketDiffRow[] {
  const filtered = options.showMismatchesOnly ? rows.filter((row) => row.status !== "exact") : rows;
  return filtered.slice(0, options.maxRows);
}

function buildRowsByIndex(leftPackets: PacketInfo[], rightPackets: PacketInfo[]): PacketDiffRow[] {
  const max = Math.max(leftPackets.length, rightPackets.length);
  const rows: PacketDiffRow[] = [];
  for (let i = 0; i < max; i += 1) {
    const left = leftPackets[i] ?? null;
    const right = rightPackets[i] ?? null;
    if (!left && !right) continue;
    rows.push(makeRow(left, right, i));
  }
  return rows;
}

function buildRowsByTimestamp(
  leftPackets: PacketInfo[],
  rightPackets: PacketInfo[],
  windowMs: number,
): PacketDiffRow[] {
  const rows: PacketDiffRow[] = [];
  const usedRight = new Set<number>();

  for (let i = 0; i < leftPackets.length; i += 1) {
    const left = leftPackets[i];
    if (!left) continue;
    const leftTs = toTimestampMs(left);
    let bestRightIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (let j = 0; j < rightPackets.length; j += 1) {
      if (usedRight.has(j)) continue;
      const right = rightPackets[j];
      if (!right) continue;
      const rightTs = toTimestampMs(right);
      if (!Number.isFinite(leftTs) || !Number.isFinite(rightTs)) continue;
      const delta = Math.abs(rightTs - leftTs);
      if (delta <= windowMs && delta < bestDelta) {
        bestDelta = delta;
        bestRightIndex = j;
      }
    }

    if (bestRightIndex >= 0) {
      usedRight.add(bestRightIndex);
      rows.push(makeRow(left, rightPackets[bestRightIndex] ?? null, rows.length));
    } else {
      rows.push(makeRow(left, null, rows.length));
    }
  }

  for (let j = 0; j < rightPackets.length; j += 1) {
    if (usedRight.has(j)) continue;
    rows.push(makeRow(null, rightPackets[j] ?? null, rows.length));
  }

  return rows;
}

function buildRowsByFlow(leftPackets: PacketInfo[], rightPackets: PacketInfo[]): PacketDiffRow[] {
  const rows: PacketDiffRow[] = [];
  const rightBySig = new Map<string, number[]>();
  const usedRight = new Set<number>();

  for (let j = 0; j < rightPackets.length; j += 1) {
    const right = rightPackets[j];
    if (!right) continue;
    const sig = packetSignature(right);
    const bucket = rightBySig.get(sig);
    if (bucket) {
      bucket.push(j);
    } else {
      rightBySig.set(sig, [j]);
    }
  }

  for (let i = 0; i < leftPackets.length; i += 1) {
    const left = leftPackets[i];
    if (!left) continue;
    const sig = packetSignature(left);
    const candidates = rightBySig.get(sig) ?? [];
    const rightIdx = candidates.shift();
    if (typeof rightIdx === "number") {
      usedRight.add(rightIdx);
      rows.push(makeRow(left, rightPackets[rightIdx] ?? null, rows.length));
    } else {
      rows.push(makeRow(left, null, rows.length));
    }
  }

  for (let j = 0; j < rightPackets.length; j += 1) {
    if (usedRight.has(j)) continue;
    rows.push(makeRow(null, rightPackets[j] ?? null, rows.length));
  }

  return rows;
}

export function buildPacketDiffRows(
  leftPackets: PacketInfo[],
  rightPackets: PacketInfo[],
  options: BuildPacketDiffRowsOptions,
): PacketDiffRow[] {
  switch (options.mode) {
    case "index":
      return finalizeRows(buildRowsByIndex(leftPackets, rightPackets), options);
    case "timestamp":
      return finalizeRows(
        buildRowsByTimestamp(leftPackets, rightPackets, Math.max(0, options.timestampWindowMs)),
        options,
      );
    case "flow":
      return finalizeRows(buildRowsByFlow(leftPackets, rightPackets), options);
    default: {
      const neverMode: never = options.mode;
      throw new Error(`Unsupported packet diff mode: ${neverMode}`);
    }
  }
}
