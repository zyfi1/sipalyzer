import type { PacketInfo, RtpHeader } from "@/types/packetCapture";
import type { PacketDiffRow } from "./packetDiffEngine";

/** Minimum consecutive exact RTP rows (same stream key) to fold into one banner. */
export const DEFAULT_RTP_COLLAPSE_MIN_RUN = 12;

export type PacketDiffVisibleItem =
  | { kind: "single"; row: PacketDiffRow }
  | { kind: "collapsed"; id: string; rows: PacketDiffRow[] };

/**
 * For exact RTP/SRTP matches, stream identity on capture A (left) — consecutive rows with the same key can be collapsed.
 */
export function rtpExactStreamKey(row: PacketDiffRow): string | null {
  if (row.status !== "exact" || !row.left || !row.right) return null;
  const L = row.left.decoded?.application;
  const R = row.right.decoded?.application;
  if (!L || !R) return null;
  if (L.type !== R.type) return null;
  if (L.type !== "Rtp" && L.type !== "Srtp") return null;
  const lHdr = L.data as RtpHeader;
  const rHdr = R.data as RtpHeader;
  if (lHdr.ssrc !== rHdr.ssrc || lHdr.payloadType !== rHdr.payloadType) return null;
  return `${L.type}|${lHdr.ssrc}|${lHdr.payloadType}`;
}

function collapsedIdForRun(run: PacketDiffRow[]): string {
  return `rtp-run:${run[0]!.key}:${run[run.length - 1]!.key}:${run.length}`;
}

export function buildRtpCollapsedItems(
  rows: PacketDiffRow[],
  options: { enabled: boolean; minRun: number },
): PacketDiffVisibleItem[] {
  if (!options.enabled || rows.length === 0) {
    return rows.map((row) => ({ kind: "single" as const, row }));
  }

  const minRun = Math.max(2, options.minRun);
  const out: PacketDiffVisibleItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const key = rtpExactStreamKey(rows[i]!);
    if (key === null) {
      out.push({ kind: "single", row: rows[i]! });
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < rows.length && rtpExactStreamKey(rows[j]!) === key) {
      j += 1;
    }
    const run = rows.slice(i, j);
    if (run.length >= minRun) {
      out.push({ kind: "collapsed", id: collapsedIdForRun(run), rows: run });
    } else {
      for (const row of run) {
        out.push({ kind: "single", row });
      }
    }
    i = j;
  }
  return out;
}

function packetSide(row: PacketDiffRow, side: "left" | "right"): PacketInfo | null {
  return side === "left" ? row.left : row.right;
}

function parseTs(p: PacketInfo | null): number | null {
  if (!p) return null;
  const t = Date.parse(p.timestamp);
  return Number.isFinite(t) ? t : null;
}

/** One visible row after applying expand state to collapsed runs. */
export interface PacketDiffFlatRow {
  displayKey: string;
  row: PacketDiffRow;
  collapsed: Extract<PacketDiffVisibleItem, { kind: "collapsed" }> | null;
  /** Present on rows materialized from an expanded collapsed run (for “collapse again”). */
  expandedFromCollapsedId?: string;
}

/**
 * Flatten visible items for rendering. Collapsed runs become one row unless expanded.
 */
export function flattenVisibleItems(
  items: PacketDiffVisibleItem[],
  expandedCollapsedIds: ReadonlySet<string>,
): PacketDiffFlatRow[] {
  const flat: PacketDiffFlatRow[] = [];
  for (const item of items) {
    if (item.kind === "single") {
      flat.push({ displayKey: item.row.key, row: item.row, collapsed: null });
      continue;
    }
    if (expandedCollapsedIds.has(item.id)) {
      for (const row of item.rows) {
        flat.push({
          displayKey: row.key,
          row,
          collapsed: null,
          expandedFromCollapsedId: item.id,
        });
      }
    } else {
      flat.push({ displayKey: item.id, row: item.rows[0]!, collapsed: item });
    }
  }
  return flat;
}

/**
 * Inter-arrival deltas for a flattened list; uses last packet of previous visible row → first of current (per side).
 */
export function computeInterArrivalDeltasForFlat(
  flat: PacketDiffFlatRow[],
  side: "left" | "right",
): (number | null)[] {
  const deltas: (number | null)[] = [];
  let prevLastTs: number | null = null;

  for (const entry of flat) {
    let first: PacketInfo | null;
    let last: PacketInfo | null;

    if (entry.collapsed) {
      const rows = entry.collapsed.rows;
      first = packetSide(rows[0]!, side);
      last = packetSide(rows[rows.length - 1]!, side);
    } else {
      const p = packetSide(entry.row, side);
      first = p;
      last = p;
    }

    const firstTs = parseTs(first);
    if (firstTs === null) {
      deltas.push(null);
      continue;
    }

    deltas.push(prevLastTs === null ? null : firstTs - prevLastTs);

    const lastTs = parseTs(last);
    prevLastTs = lastTs ?? firstTs;
  }

  return deltas;
}

export function collapsedRunSummary(rows: PacketDiffRow[]): {
  label: string;
  codecLabel: string;
  seqRange: string;
  frameRangeA: string;
  frameRangeB: string;
} | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const L = first.left?.decoded?.application;
  if (!L || (L.type !== "Rtp" && L.type !== "Srtp")) return null;
  const seq0 = L.data.sequenceNumber;
  const Llast = last.left?.decoded?.application;
  const seq1 =
    Llast && (Llast.type === "Rtp" || Llast.type === "Srtp")
      ? Llast.data.sequenceNumber
      : seq0;
  const typ = L.type.toUpperCase();
  return {
    label: `${rows.length} × ${typ} (exact)`,
    codecLabel: `SSRC ${L.data.ssrc} · PT ${L.data.payloadType}`,
    seqRange: seq0 === seq1 ? `seq ${seq0}` : `seq ${seq0}–${seq1}`,
    frameRangeA: frameRangeForSide(rows, "left"),
    frameRangeB: frameRangeForSide(rows, "right"),
  };
}

function frameRangeForSide(rows: PacketDiffRow[], side: "left" | "right"): string {
  const firstIdx = side === "left" ? rows[0]!.leftIndex : rows[0]!.rightIndex;
  const lastIdx = side === "left" ? rows[rows.length - 1]!.leftIndex : rows[rows.length - 1]!.rightIndex;
  if (typeof firstIdx !== "number" || typeof lastIdx !== "number") return "—";
  const a = firstIdx + 1;
  const b = lastIdx + 1;
  return a === b ? `#${a}` : `#${a}–#${b}`;
}
