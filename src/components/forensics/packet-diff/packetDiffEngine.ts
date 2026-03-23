import type { PacketInfo } from "@/types/packetCapture";
import {
  filterRowsByTrafficGroups,
  PACKET_TRAFFIC_GROUPS,
  type PacketTrafficGroupId,
} from "./packetDiffCategories";

export type PacketDiffAlignmentMode = "index" | "timestamp" | "flow" | "rtp_ssrc_seq";
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
  /** Hide exact rows that look like idle TCP ACK churn. */
  hideRepetitiveTcpAcks?: boolean;
  /** Subset of traffic groups to keep; omit or use full set to show everything. */
  trafficGroupsEnabled?: ReadonlySet<PacketTrafficGroupId>;
}

/** Row cap and list filters applied after alignment (traffic, problems-only, TCP ACK, max rows). */
export type PacketDiffVisibilityOptions = Pick<
  BuildPacketDiffRowsOptions,
  "maxRows" | "showMismatchesOnly" | "hideRepetitiveTcpAcks" | "trafficGroupsEnabled"
>;

/** Summary of how well capture A rows found a partner on B (before table filters). */
export interface PacketDiffPairingHealth {
  totalRows: number;
  exact: number;
  changed: number;
  leftOnly: number;
  rightOnly: number;
  pairedRows: number;
  orphanRows: number;
  pairedFraction: number;
  orphanFraction: number;
  exactAmongPairedFraction: number;
  changedAmongPairedFraction: number;
}

export function computePacketDiffPairingHealth(rows: PacketDiffRow[]): PacketDiffPairingHealth {
  let exact = 0;
  let changed = 0;
  let leftOnly = 0;
  let rightOnly = 0;
  for (const row of rows) {
    if (row.status === "exact") exact += 1;
    else if (row.status === "changed") changed += 1;
    else if (row.status === "left_only") leftOnly += 1;
    else rightOnly += 1;
  }
  const totalRows = rows.length;
  const pairedRows = exact + changed;
  const orphanRows = leftOnly + rightOnly;
  return {
    totalRows,
    exact,
    changed,
    leftOnly,
    rightOnly,
    pairedRows,
    orphanRows,
    pairedFraction: totalRows === 0 ? 0 : pairedRows / totalRows,
    orphanFraction: totalRows === 0 ? 0 : orphanRows / totalRows,
    exactAmongPairedFraction: pairedRows === 0 ? 1 : exact / pairedRows,
    changedAmongPairedFraction: pairedRows === 0 ? 0 : changed / pairedRows,
  };
}

/**
 * Structural fingerprint for pairing and for exact vs changed.
 * Omits `summary` (parser-text varies) and wire length (often noise for UDP/RTP).
 */
export function structuralPacketSignature(packet: PacketInfo): string {
  const app = packet.decoded?.application;
  let appPart = "na";
  if (app?.type === "Sip") {
    const d = app.data;
    const cid = (d.callId ?? "").replace(/\s+/g, " ").trim();
    if (d.method) {
      appPart = `sip:req:${(d.method ?? "").toUpperCase()}:cseq:${d.cseq ?? ""}:cid:${cid}`;
    } else {
      appPart = `sip:res:${d.responseCode ?? ""}:cseq:${d.cseq ?? ""}:cid:${cid}`;
    }
  } else if (app?.type === "SipOverWs") {
    const d = app.data.sip;
    const cid = (d.callId ?? "").replace(/\s+/g, " ").trim();
    if (d.method) {
      appPart = `wsip:req:${(d.method ?? "").toUpperCase()}:cseq:${d.cseq ?? ""}:cid:${cid}`;
    } else {
      appPart = `wsip:res:${d.responseCode ?? ""}:cseq:${d.cseq ?? ""}:cid:${cid}`;
    }
  } else if (app?.type === "Rtp" || app?.type === "Srtp") {
    appPart = `${app.type}:${app.data.ssrc}:${app.data.payloadType}:${app.data.sequenceNumber}:${app.data.timestamp}`;
  } else if (app?.type === "Rtcp") {
    appPart = `rtcp:${app.data.packets.map((p) => `${p.packetType}:${p.ssrc}`).join(";")}`;
  } else if (app?.type === "Dns") {
    const q = app.data.queries[0]?.name ?? "";
    appPart = `dns:${app.data.isResponse ? "res" : "q"}:${q}:${app.data.responseCode}`;
  } else if (app?.type === "T38") {
    appPart = `t38:${app.data.seq}:${app.data.ifpType ?? ""}`;
  } else if (app?.type === "WebSocket") {
    appPart = `wsframe:${app.data.opcode ?? "?"}`;
  } else if (app?.type === "Unknown") {
    appPart = `unknown:${packet.size}`;
  }

  return [
    (packet.protocol ?? "").toUpperCase(),
    packet.srcIp,
    String(packet.srcPort),
    packet.dstIp,
    String(packet.dstPort),
    appPart,
  ].join("|");
}

function toTimestampMs(packet: PacketInfo): number {
  const parsed = Date.parse(packet.timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Prefer same protocol, 5-tuple, and app type; then smallest time delta. */
function timestampPairScore(left: PacketInfo, right: PacketInfo, deltaMs: number): number {
  let score = -deltaMs;
  if (left.protocol === right.protocol) score += 8_000;
  if (left.srcIp === right.srcIp && left.dstIp === right.dstIp) score += 4_000;
  if (left.srcPort === right.srcPort && left.dstPort === right.dstPort) score += 2_000;
  const la = left.decoded?.application?.type;
  const ra = right.decoded?.application?.type;
  if (la && ra && la === ra) score += 1_500;
  return score;
}

function rowStatus(left: PacketInfo | null, right: PacketInfo | null): PacketDiffRowStatus {
  if (left && right) {
    return structuralPacketSignature(left) === structuralPacketSignature(right) ? "exact" : "changed";
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

function isRepetitiveTcpAckExactRow(row: PacketDiffRow): boolean {
  if (row.status !== "exact") return false;
  const left = row.left;
  const right = row.right;
  if (!left || !right) return false;
  const proto = (left.protocol ?? "").toUpperCase();
  if (!proto.includes("TCP")) return false;
  const ackOnly = (p: typeof left) => {
    const s = (p.summary ?? "").toUpperCase();
    return (
      s.includes("ACK") &&
      !s.includes("PSH") &&
      !s.includes("SYN") &&
      !s.includes("FIN") &&
      !s.includes("RST")
    );
  };
  return ackOnly(left) && ackOnly(right);
}

const TRAFFIC_GROUP_TOTAL = PACKET_TRAFFIC_GROUPS.length;

export interface PacketDiffVisibilitySliceResult {
  rows: PacketDiffRow[];
  truncatedByMaxRows: boolean;
}

export function applyPacketDiffVisibilityFiltersWithCapMeta(
  rows: PacketDiffRow[],
  options: PacketDiffVisibilityOptions,
): PacketDiffVisibilitySliceResult {
  let filtered = rows;
  const tg = options.trafficGroupsEnabled;
  if (tg && tg.size > 0 && tg.size < TRAFFIC_GROUP_TOTAL) {
    filtered = filterRowsByTrafficGroups(filtered, tg);
  }
  if (options.showMismatchesOnly) {
    filtered = filtered.filter((row) => row.status !== "exact");
  }
  if (options.hideRepetitiveTcpAcks) {
    filtered = filtered.filter((row) => !isRepetitiveTcpAckExactRow(row));
  }
  const truncatedByMaxRows = filtered.length > options.maxRows;
  return {
    rows: filtered.slice(0, options.maxRows),
    truncatedByMaxRows,
  };
}

export function applyPacketDiffVisibilityFilters(
  rows: PacketDiffRow[],
  options: PacketDiffVisibilityOptions,
): PacketDiffRow[] {
  return applyPacketDiffVisibilityFiltersWithCapMeta(rows, options).rows;
}

export function alignPacketDiffRows(
  leftPackets: PacketInfo[],
  rightPackets: PacketInfo[],
  params: Pick<BuildPacketDiffRowsOptions, "mode" | "timestampWindowMs">,
): PacketDiffRow[] {
  switch (params.mode) {
    case "index":
      return buildRowsByIndex(leftPackets, rightPackets);
    case "timestamp":
      return buildRowsByTimestamp(leftPackets, rightPackets, params.timestampWindowMs);
    case "flow":
      return buildRowsByFlow(leftPackets, rightPackets);
    case "rtp_ssrc_seq":
      return buildRowsByRtpSsrcSeq(leftPackets, rightPackets);
    default: {
      const neverMode: never = params.mode;
      throw new Error(`Unsupported packet diff mode: ${neverMode}`);
    }
  }
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
  const win = Math.max(0, windowMs);

  for (let i = 0; i < leftPackets.length; i += 1) {
    const left = leftPackets[i];
    if (!left) continue;
    const leftTs = toTimestampMs(left);
    let bestRightIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let j = 0; j < rightPackets.length; j += 1) {
      if (usedRight.has(j)) continue;
      const right = rightPackets[j];
      if (!right) continue;
      const rightTs = toTimestampMs(right);
      if (!Number.isFinite(leftTs) || !Number.isFinite(rightTs)) continue;
      const delta = Math.abs(rightTs - leftTs);
      if (delta > win) continue;
      const score = timestampPairScore(left, right, delta);
      if (score > bestScore) {
        bestScore = score;
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

function rtpSsrcSeqKey(packet: PacketInfo): string | null {
  const app = packet.decoded?.application;
  if (app?.type === "Rtp" || app?.type === "Srtp") {
    return `rtp|${app.data.ssrc}|${app.data.sequenceNumber}|${app.data.payloadType}`;
  }
  return null;
}

function dequeueUnused(queue: number[] | undefined, usedRight: Set<number>): number {
  if (!queue) return -1;
  while (queue.length > 0) {
    const j = queue.shift()!;
    if (!usedRight.has(j)) return j;
  }
  return -1;
}

/**
 * RTP/SRTP: match by SSRC + RTP seq + PT. Everything else: structural signature FIFO (same as flow).
 */
function buildRowsByRtpSsrcSeq(leftPackets: PacketInfo[], rightPackets: PacketInfo[]): PacketDiffRow[] {
  const rows: PacketDiffRow[] = [];
  const rtpQueues = new Map<string, number[]>();
  for (let j = 0; j < rightPackets.length; j += 1) {
    const right = rightPackets[j];
    if (!right) continue;
    const rk = rtpSsrcSeqKey(right);
    if (!rk) continue;
    const bucket = rtpQueues.get(rk);
    if (bucket) bucket.push(j);
    else rtpQueues.set(rk, [j]);
  }

  const rightBySig = new Map<string, number[]>();
  for (let j = 0; j < rightPackets.length; j += 1) {
    const right = rightPackets[j];
    if (!right) continue;
    const sig = structuralPacketSignature(right);
    const bucket = rightBySig.get(sig);
    if (bucket) bucket.push(j);
    else rightBySig.set(sig, [j]);
  }

  const usedRight = new Set<number>();

  for (let i = 0; i < leftPackets.length; i += 1) {
    const left = leftPackets[i];
    if (!left) continue;
    const rtpKey = rtpSsrcSeqKey(left);
    if (rtpKey) {
      const queue = rtpQueues.get(rtpKey);
      const matched = dequeueUnused(queue, usedRight);
      if (matched >= 0) {
        usedRight.add(matched);
        rows.push(makeRow(left, rightPackets[matched] ?? null, rows.length));
      } else {
        rows.push(makeRow(left, null, rows.length));
      }
      continue;
    }

    const sig = structuralPacketSignature(left);
    const candidates = rightBySig.get(sig);
    const matched = dequeueUnused(candidates, usedRight);
    if (matched >= 0) {
      usedRight.add(matched);
      rows.push(makeRow(left, rightPackets[matched] ?? null, rows.length));
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
    const sig = structuralPacketSignature(right);
    const bucket = rightBySig.get(sig);
    if (bucket) bucket.push(j);
    else rightBySig.set(sig, [j]);
  }

  for (let i = 0; i < leftPackets.length; i += 1) {
    const left = leftPackets[i];
    if (!left) continue;
    const sig = structuralPacketSignature(left);
    const candidates = rightBySig.get(sig);
    const matched = dequeueUnused(candidates, usedRight);
    if (matched >= 0) {
      usedRight.add(matched);
      rows.push(makeRow(left, rightPackets[matched] ?? null, rows.length));
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
  const aligned = alignPacketDiffRows(leftPackets, rightPackets, {
    mode: options.mode,
    timestampWindowMs: options.timestampWindowMs,
  });
  return applyPacketDiffVisibilityFiltersWithCapMeta(aligned, {
    maxRows: options.maxRows,
    showMismatchesOnly: options.showMismatchesOnly,
    hideRepetitiveTcpAcks: options.hideRepetitiveTcpAcks,
    trafficGroupsEnabled: options.trafficGroupsEnabled,
  }).rows;
}
