/**
 * Web Worker for packet filtering and sorting operations.
 *
 * Offloads CPU-intensive filtering and sorting to a background thread,
 * keeping the main UI thread responsive during heavy operations.
 */

import type { PacketInfo } from "@/types/packetCapture";

/** Filter configuration. */
export interface FilterConfig {
  protocols?: string[];
  srcIp?: string;
  dstIp?: string;
  srcPort?: number;
  dstPort?: number;
  minSize?: number;
  maxSize?: number;
  searchText?: string;
  timestampStart?: number;
  timestampEnd?: number;
}

/** Sort configuration. */
export interface SortConfig {
  column: "time" | "srcIp" | "dstIp" | "srcPort" | "dstPort" | "protocol" | "size";
  direction: "asc" | "desc";
}

/** Worker message types. */
export type WorkerMessage =
  | { type: "filter"; packets: PacketInfo[]; filter: FilterConfig }
  | { type: "sort"; packets: PacketInfo[]; sort: SortConfig }
  | { type: "filterAndSort"; packets: PacketInfo[]; filter: FilterConfig; sort: SortConfig }
  | { type: "search"; packets: PacketInfo[]; query: string }
  | { type: "statistics"; packets: PacketInfo[] }
  | { type: "cancel" };

/** Worker response types. */
export type WorkerResponse =
  | { type: "filtered"; packets: PacketInfo[]; totalCount: number; matchCount: number }
  | { type: "sorted"; packets: PacketInfo[] }
  | { type: "searchResults"; matches: number[]; count: number }
  | { type: "statistics"; stats: PacketStatistics }
  | { type: "progress"; percent: number }
  | { type: "error"; message: string }
  | { type: "cancelled" };

/** Packet statistics. */
export interface PacketStatistics {
  totalPackets: number;
  totalBytes: number;
  protocolCounts: Record<string, number>;
  topSrcIps: Array<{ ip: string; count: number }>;
  topDstIps: Array<{ ip: string; count: number }>;
  avgPacketSize: number;
  packetsPerSecond: number;
  timeRange: { start: number; end: number };
}

// Global abort flag for long-running operations
let abortFlag = false;

/**
 * Check if a packet matches the filter criteria.
 */
function matchesFilter(packet: PacketInfo, filter: FilterConfig): boolean {
  // Protocol filter
  if (filter.protocols && filter.protocols.length > 0) {
    const protocol = packet.protocol.toUpperCase();
    if (!filter.protocols.some((p) => p.toUpperCase() === protocol)) {
      return false;
    }
  }

  // Source IP filter
  if (filter.srcIp) {
    const srcIp = packet.srcIp || "";
    if (!srcIp.includes(filter.srcIp)) {
      return false;
    }
  }

  // Destination IP filter
  if (filter.dstIp) {
    const dstIp = packet.dstIp || "";
    if (!dstIp.includes(filter.dstIp)) {
      return false;
    }
  }

  // Port filters
  const srcPort = packet.srcPort || 0;
  const dstPort = packet.dstPort || 0;

  if (filter.srcPort !== undefined && srcPort !== filter.srcPort) {
    return false;
  }

  if (filter.dstPort !== undefined && dstPort !== filter.dstPort) {
    return false;
  }

  // Size filters
  const size = packet.size || packet.frameLength || 0;

  if (filter.minSize !== undefined && size < filter.minSize) {
    return false;
  }

  if (filter.maxSize !== undefined && size > filter.maxSize) {
    return false;
  }

  // Text search
  if (filter.searchText) {
    const searchLower = filter.searchText.toLowerCase();
    const summary = (packet.summary || "").toLowerCase();
    const srcIp = (packet.srcIp || "").toLowerCase();
    const dstIp = (packet.dstIp || "").toLowerCase();
    const protocol = packet.protocol.toLowerCase();

    if (
      !summary.includes(searchLower) &&
      !srcIp.includes(searchLower) &&
      !dstIp.includes(searchLower) &&
      !protocol.includes(searchLower)
    ) {
      return false;
    }
  }

  // Timestamp range
  const timestamp = new Date(packet.timestamp).getTime();

  if (filter.timestampStart !== undefined && timestamp < filter.timestampStart) {
    return false;
  }

  if (filter.timestampEnd !== undefined && timestamp > filter.timestampEnd) {
    return false;
  }

  return true;
}

/**
 * Compare two packets for sorting.
 */
function comparePackets(a: PacketInfo, b: PacketInfo, sort: SortConfig): number {
  let comparison = 0;

  switch (sort.column) {
    case "time":
      comparison =
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      break;
    case "srcIp":
      comparison = (a.srcIp || "").localeCompare(b.srcIp || "");
      break;
    case "dstIp":
      comparison = (a.dstIp || "").localeCompare(b.dstIp || "");
      break;
    case "srcPort":
      comparison = (a.srcPort || 0) - (b.srcPort || 0);
      break;
    case "dstPort":
      comparison = (a.dstPort || 0) - (b.dstPort || 0);
      break;
    case "protocol":
      comparison = a.protocol.localeCompare(b.protocol);
      break;
    case "size":
      comparison = (a.size || a.frameLength || 0) - (b.size || b.frameLength || 0);
      break;
  }

  return sort.direction === "desc" ? -comparison : comparison;
}

/**
 * Filter packets with progress reporting.
 */
function filterPackets(packets: PacketInfo[], filter: FilterConfig): PacketInfo[] {
  const result: PacketInfo[] = [];
  const reportInterval = Math.max(1000, Math.floor(packets.length / 10));

  for (let i = 0; i < packets.length; i++) {
    if (abortFlag) {
      break;
    }

    const pkt = packets[i];
    if (pkt && matchesFilter(pkt, filter)) {
      result.push(pkt);
    }

    // Report progress
    if (i % reportInterval === 0) {
      self.postMessage({
        type: "progress",
        percent: Math.round((i / packets.length) * 100),
      } as WorkerResponse);
    }
  }

  return result;
}

/**
 * Sort packets with progress reporting.
 */
function sortPackets(packets: PacketInfo[], sort: SortConfig): PacketInfo[] {
  // Use a stable sort
  const indexed = packets.map((p, i) => ({ packet: p, index: i }));

  indexed.sort((a, b) => {
    const result = comparePackets(a.packet, b.packet, sort);
    return result !== 0 ? result : a.index - b.index;
  });

  return indexed.map((item) => item.packet);
}

/**
 * Search packets for matching text.
 */
function searchPackets(packets: PacketInfo[], query: string): number[] {
  const queryLower = query.toLowerCase();
  const matches: number[] = [];
  const reportInterval = Math.max(1000, Math.floor(packets.length / 10));

  for (let i = 0; i < packets.length; i++) {
    if (abortFlag) {
      break;
    }

    const packet = packets[i];
    if (!packet) continue;
    const summary = (packet.summary || "").toLowerCase();
    const srcIp = (packet.srcIp || "").toLowerCase();
    const dstIp = (packet.dstIp || "").toLowerCase();
    const protocol = packet.protocol.toLowerCase();

    if (
      summary.includes(queryLower) ||
      srcIp.includes(queryLower) ||
      dstIp.includes(queryLower) ||
      protocol.includes(queryLower)
    ) {
      matches.push(i);
    }

    if (i % reportInterval === 0) {
      self.postMessage({
        type: "progress",
        percent: Math.round((i / packets.length) * 100),
      } as WorkerResponse);
    }
  }

  return matches;
}

/**
 * Calculate packet statistics.
 */
function calculateStatistics(packets: PacketInfo[]): PacketStatistics {
  if (packets.length === 0) {
    return {
      totalPackets: 0,
      totalBytes: 0,
      protocolCounts: {},
      topSrcIps: [],
      topDstIps: [],
      avgPacketSize: 0,
      packetsPerSecond: 0,
      timeRange: { start: 0, end: 0 },
    };
  }

  const protocolCounts: Record<string, number> = {};
  const srcIpCounts: Record<string, number> = {};
  const dstIpCounts: Record<string, number> = {};
  let totalBytes = 0;
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const packet of packets) {
    // Protocol counts
    const protocol = packet.protocol;
    protocolCounts[protocol] = (protocolCounts[protocol] || 0) + 1;

    // IP counts
    const srcIp = packet.srcIp || "";
    const dstIp = packet.dstIp || "";
    srcIpCounts[srcIp] = (srcIpCounts[srcIp] || 0) + 1;
    dstIpCounts[dstIp] = (dstIpCounts[dstIp] || 0) + 1;

    // Bytes
    totalBytes += packet.size || packet.frameLength || 0;

    // Time range
    const timestamp = new Date(packet.timestamp).getTime();
    minTime = Math.min(minTime, timestamp);
    maxTime = Math.max(maxTime, timestamp);
  }

  // Top IPs
  const topSrcIps = Object.entries(srcIpCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));

  const topDstIps = Object.entries(dstIpCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));

  // Packets per second
  const durationSeconds = Math.max(1, (maxTime - minTime) / 1000);
  const packetsPerSecond = packets.length / durationSeconds;

  return {
    totalPackets: packets.length,
    totalBytes,
    protocolCounts,
    topSrcIps,
    topDstIps,
    avgPacketSize: Math.round(totalBytes / packets.length),
    packetsPerSecond: Math.round(packetsPerSecond * 10) / 10,
    timeRange: { start: minTime, end: maxTime },
  };
}

/**
 * Handle incoming messages.
 */
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  abortFlag = false;

  try {
    switch (message.type) {
      case "filter": {
        const filtered = filterPackets(message.packets, message.filter);
        self.postMessage({
          type: "filtered",
          packets: filtered,
          totalCount: message.packets.length,
          matchCount: filtered.length,
        } as WorkerResponse);
        break;
      }

      case "sort": {
        const sorted = sortPackets(message.packets, message.sort);
        self.postMessage({
          type: "sorted",
          packets: sorted,
        } as WorkerResponse);
        break;
      }

      case "filterAndSort": {
        const filtered = filterPackets(message.packets, message.filter);
        const sorted = sortPackets(filtered, message.sort);
        self.postMessage({
          type: "filtered",
          packets: sorted,
          totalCount: message.packets.length,
          matchCount: sorted.length,
        } as WorkerResponse);
        break;
      }

      case "search": {
        const matches = searchPackets(message.packets, message.query);
        self.postMessage({
          type: "searchResults",
          matches,
          count: matches.length,
        } as WorkerResponse);
        break;
      }

      case "statistics": {
        const stats = calculateStatistics(message.packets);
        self.postMessage({
          type: "statistics",
          stats,
        } as WorkerResponse);
        break;
      }

      case "cancel": {
        abortFlag = true;
        self.postMessage({ type: "cancelled" } as WorkerResponse);
        break;
      }
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    } as WorkerResponse);
  }
};

// Export for TypeScript type checking
export {};
