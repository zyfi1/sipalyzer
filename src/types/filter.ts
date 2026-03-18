// Simplified filter focused on VOIP protocols
export interface PacketFilter {
  // VOIP protocols - always present, defaults to all VOIP protocols
  protocols: string[]; // SIP, RTP, RTCP, FAX
}