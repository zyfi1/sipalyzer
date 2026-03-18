import type { PacketFilter } from "@/types/filter";

export interface QuickFilterPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  filter: Partial<PacketFilter>;
}

// VOIP-focused filter presets
export const QUICK_FILTER_PRESETS: QuickFilterPreset[] = [
  {
    id: "all-voip",
    name: "All VOIP",
    description: "All VOIP protocols (SIP, RTP, RTCP, FAX)",
    icon: "Phone",
    color: "blue",
    filter: {
      protocols: ["SIP", "RTP", "RTCP", "FAX"],
    },
  },
  {
    id: "sip-only",
    name: "SIP Only",
    description: "SIP signaling packets",
    icon: "Phone",
    color: "blue",
    filter: {
      protocols: ["SIP"],
    },
  },
  {
    id: "rtp-rtcp",
    name: "Media Streams",
    description: "RTP and RTCP media packets",
    icon: "Radio",
    color: "green",
    filter: {
      protocols: ["RTP", "RTCP"],
    },
  },
  {
    id: "sip-rtp",
    name: "SIP + RTP",
    description: "SIP signaling and RTP media",
    icon: "Phone",
    color: "teal",
    filter: {
      protocols: ["SIP", "RTP"],
    },
  },
];

export function applyQuickFilter(
  _currentFilter: PacketFilter,
  preset: QuickFilterPreset
): PacketFilter {
  // Simplified: only protocols are supported
  return {
    protocols: preset.filter.protocols || [],
  };
}

export function isPresetActive(
  currentFilter: PacketFilter,
  preset: QuickFilterPreset
): boolean {
  // Only check protocols since that's all we support now
  if (preset.filter.protocols && Array.isArray(preset.filter.protocols)) {
    return preset.filter.protocols.every(protocol => 
      currentFilter.protocols.includes(protocol)
    ) && preset.filter.protocols.length === currentFilter.protocols.length;
  }
  return false;
}
