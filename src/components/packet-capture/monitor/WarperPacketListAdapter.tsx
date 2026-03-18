/**
 * Adapter component that wraps WarperPacketList with double-click support.
 * 
 * Note: The Warper list provides high-performance 120 FPS virtualization
 * but has limited context menu support compared to PacketListView.
 * Use for high-performance scenarios, fall back to PacketListView for full features.
 */

import { useCallback } from "react";
import { WarperPacketList } from "./WarperPacketList";
import type { PacketInfo } from "@/types/packetCapture";

interface WarperPacketListAdapterProps {
  packets: PacketInfo[];
  selectedPacketIndex: number | null;
  onSelectPacket: (index: number) => void;
  autoScroll: boolean;
  onOpenInSipLadder?: () => void;
  /** Windowed mode: total packets in capture */
  totalPacketCount?: number | null;
  /** Windowed mode: start index of current window */
  windowStart?: number;
  /** Windowed mode: load window at offset */
  onRequestWindow?: (offset: number) => void;
}

export function WarperPacketListAdapter({
  packets,
  selectedPacketIndex,
  onSelectPacket,
  autoScroll,
  onOpenInSipLadder,
  totalPacketCount,
  windowStart = 0,
  onRequestWindow,
}: WarperPacketListAdapterProps) {
  // Handle double-click to open in SIP ladder
  const handleDoubleClick = useCallback((packet: PacketInfo, _index: number) => {
    // If it's a SIP packet, open in SIP ladder
    const isSip = packet.protocol === "SIP" || 
      packet.decoded?.application?.type === "Sip";
    if (isSip && onOpenInSipLadder) {
      onOpenInSipLadder();
    }
  }, [onOpenInSipLadder]);

  return (
    <WarperPacketList
      packets={packets}
      selectedIndex={selectedPacketIndex}
      onSelect={onSelectPacket}
      autoScroll={autoScroll}
      totalCount={totalPacketCount || undefined}
      windowOffset={windowStart}
      onRequestWindow={onRequestWindow}
      onDoubleClick={handleDoubleClick}
      className="flex-1"
    />
  );
}

export default WarperPacketListAdapter;
