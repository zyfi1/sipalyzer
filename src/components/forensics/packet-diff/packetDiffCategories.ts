import type { PacketInfo } from "@/types/packetCapture";

/** Traffic groups for “what to show” in the diff list (OR semantics per row). */
export const PACKET_TRAFFIC_GROUPS = [
  { id: "signaling", label: "SIP" },
  { id: "media", label: "RTP / SRTP" },
  { id: "rtcp", label: "RTCP" },
  { id: "dns", label: "DNS" },
  { id: "fax", label: "T.38" },
  { id: "other", label: "Other" },
] as const;

export type PacketTrafficGroupId = (typeof PACKET_TRAFFIC_GROUPS)[number]["id"];

const ALL_GROUP_IDS: ReadonlySet<PacketTrafficGroupId> = new Set(
  PACKET_TRAFFIC_GROUPS.map((g) => g.id),
);

export function trafficGroupForPacket(packet: PacketInfo | null | undefined): PacketTrafficGroupId {
  if (!packet) return "other";
  const t = packet.decoded?.application?.type;
  switch (t) {
    case "Sip":
    case "SipOverWs":
      return "signaling";
    case "Rtp":
    case "Srtp":
      return "media";
    case "Rtcp":
      return "rtcp";
    case "Dns":
      return "dns";
    case "T38":
      return "fax";
    default:
      return "other";
  }
}

function rowTrafficGroups(row: { left: PacketInfo | null; right: PacketInfo | null }): Set<PacketTrafficGroupId> {
  const s = new Set<PacketTrafficGroupId>();
  s.add(trafficGroupForPacket(row.left));
  s.add(trafficGroupForPacket(row.right));
  return s;
}

/**
 * Keep rows that touch at least one enabled traffic group (left packet, right packet, or both).
 */
export function filterRowsByTrafficGroups<T extends { left: PacketInfo | null; right: PacketInfo | null }>(
  rows: T[],
  enabled: ReadonlySet<PacketTrafficGroupId>,
): T[] {
  if (enabled.size === 0 || enabled.size === ALL_GROUP_IDS.size) {
    return rows;
  }
  return rows.filter((row) => {
    for (const g of rowTrafficGroups(row)) {
      if (enabled.has(g)) return true;
    }
    return false;
  });
}

export function defaultTrafficGroupSelection(): Set<PacketTrafficGroupId> {
  return new Set(ALL_GROUP_IDS);
}
