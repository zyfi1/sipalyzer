use std::net::{IpAddr, Ipv4Addr};
use crate::packet_capture::{
    PacketFidelity, PacketProvenance, Protocol, PacketInfo, protocol_decoder,
};

/// Efficient, single-pass packet parser
/// Handles all link layer types and protocols correctly
pub struct PacketParser {
    link_layer_type: u32,
    rtp_port_range: Option<(u16, u16)>,
}

impl PacketParser {
    #[allow(dead_code)]
    pub fn new(link_layer_type: u32) -> Self {
        Self { 
            link_layer_type,
            rtp_port_range: None, // Default: use hardcoded range
        }
    }

    pub fn with_rtp_port_range(link_layer_type: u32, rtp_port_range: Option<(u16, u16)>) -> Self {
        Self {
            link_layer_type,
            rtp_port_range,
        }
    }

    /// Get the link layer type.
    pub fn link_layer_type(&self) -> u32 {
        self.link_layer_type
    }

    /// One row per frame when we cannot extract IPv4/IPv6 (Wi‑Fi L2, ARP, odd VLAN stacks, etc.).
    /// Keeps live ring buffers and packet counts moving; empty `FilterConfig` still matches these.
    fn opaque_raw_frame(&self, packet: &pcap::Packet, packet_count: Option<u64>) -> PacketInfo {
        let raw = packet.data.to_vec();
        PacketInfo {
            timestamp: self.parse_timestamp(&packet.header),
            src_ip: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            dst_ip: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            src_port: 0,
            dst_port: 0,
            protocol: Protocol::Other,
            size: raw.len(),
            frame_length: raw.len(),
            raw_frame: Some(raw.clone()),
            data: raw,
            decoded: protocol_decoder::decode_packet(
                packet.data,
                Some(self.link_layer_type),
                packet_count,
                self.rtp_port_range,
            )
            .ok(),
            fidelity: PacketFidelity::Authoritative,
            provenance: PacketProvenance::LocalCapture,
        }
    }

    /// Parse a raw packet into PacketInfo
    /// Single-pass, efficient parsing with proper error handling
    pub fn parse(&self, packet: &pcap::Packet, packet_count: Option<u64>) -> Option<PacketInfo> {
        if packet.data.is_empty() {
            return None;
        }

        // 802.11 (DLT 12) and radiotap (DLT 127): no IP extraction path yet.
        if matches!(self.link_layer_type, 12 | 127) {
            return Some(self.opaque_raw_frame(packet, packet_count));
        }

        // Extract IP layer based on link layer type (returns owned Vec to avoid lifetime issues)
        let ip_data = match self.extract_ip_layer_owned(packet.data) {
            Some(data) => data,
            None => {
                // Ethernet (DLT 1): ARP, LLDP, Q‑in‑Q stacks we did not peel, or Npcap edge formats
                // used to yield None here → zero packets in the live buffer despite a busy NIC.
                if self.link_layer_type == 1 {
                    return Some(self.opaque_raw_frame(packet, packet_count));
                }
                return None;
            }
        };

        if ip_data.len() < 20 {
            if self.link_layer_type == 1 {
                return Some(self.opaque_raw_frame(packet, packet_count));
            }
            return None;
        }

        let ip_version = (ip_data[0] >> 4) & 0x0F;
        let (src_ip, dst_ip, ip_protocol, _ip_header_len, transport_start) = if ip_version == 4 {
            // IPv4
            let src_ip = IpAddr::V4(std::net::Ipv4Addr::new(
                ip_data[12], ip_data[13], ip_data[14], ip_data[15],
            ));
            let dst_ip = IpAddr::V4(std::net::Ipv4Addr::new(
                ip_data[16], ip_data[17], ip_data[18], ip_data[19],
            ));
            let ip_header_len = ((ip_data[0] & 0x0F) * 4) as usize;
            (src_ip, dst_ip, ip_data[9], ip_header_len, ip_header_len)
        } else if ip_version == 6 && ip_data.len() >= 40 {
            // IPv6: walk extension header chain to find transport protocol
            let src_ip = IpAddr::V6(std::net::Ipv6Addr::from([
                ip_data[8], ip_data[9], ip_data[10], ip_data[11],
                ip_data[12], ip_data[13], ip_data[14], ip_data[15],
                ip_data[16], ip_data[17], ip_data[18], ip_data[19],
                ip_data[20], ip_data[21], ip_data[22], ip_data[23],
            ]));
            let dst_ip = IpAddr::V6(std::net::Ipv6Addr::from([
                ip_data[24], ip_data[25], ip_data[26], ip_data[27],
                ip_data[28], ip_data[29], ip_data[30], ip_data[31],
                ip_data[32], ip_data[33], ip_data[34], ip_data[35],
                ip_data[36], ip_data[37], ip_data[38], ip_data[39],
            ]));
            let (transport_proto, transport_offset) = Self::skip_ipv6_ext_headers(&ip_data);
            (src_ip, dst_ip, transport_proto, transport_offset, transport_offset)
        } else {
            if self.link_layer_type == 1 {
                return Some(self.opaque_raw_frame(packet, packet_count));
            }
            return None;
        };

        // Parse transport layer and detect protocol
        let transport_data = &ip_data[transport_start..];
        let (src_port, dst_port, payload, detected_protocol) = match ip_protocol {
            17 => match self.parse_udp(transport_data, src_ip, dst_ip) {
                Some(p) => p,
                None if self.link_layer_type == 1 => {
                    return Some(self.opaque_raw_frame(packet, packet_count));
                }
                None => return None,
            },
            6 => match self.parse_tcp(transport_data, src_ip, dst_ip) {
                Some(p) => p,
                None if self.link_layer_type == 1 => {
                    return Some(self.opaque_raw_frame(packet, packet_count));
                }
                None => return None,
            },
            1 => {
                // ICMP (IPv4 only; IPv6 ICMPv6 would be next_header 58)
                return Some(PacketInfo {
                    timestamp: self.parse_timestamp(&packet.header),
                    src_ip,
                    dst_ip,
                    src_port: 0,
                    dst_port: 0,
                    protocol: Protocol::ICMP,
                    size: ip_data.len().saturating_sub(transport_start),
                    frame_length: packet.data.len(),
                    raw_frame: Some(packet.data.to_vec()),
                    data: if ip_data.len() > transport_start { ip_data[transport_start..].to_vec() } else { Vec::new() },
                    decoded: protocol_decoder::decode_packet(packet.data, Some(self.link_layer_type), packet_count, self.rtp_port_range).ok(),
                    fidelity: crate::packet_capture::PacketFidelity::Authoritative,
                    provenance: crate::packet_capture::PacketProvenance::LocalCapture,
                });
            }
            _ => {
                // Other protocols (or IPv6 extension headers not yet parsed)
                return Some(PacketInfo {
                    timestamp: self.parse_timestamp(&packet.header),
                    src_ip,
                    dst_ip,
                    src_port: 0,
                    dst_port: 0,
                    protocol: Protocol::Other,
                    size: ip_data.len().saturating_sub(transport_start),
                    frame_length: packet.data.len(),
                    raw_frame: Some(packet.data.to_vec()),
                    data: if ip_data.len() > transport_start { ip_data[transport_start..].to_vec() } else { Vec::new() },
                    decoded: protocol_decoder::decode_packet(packet.data, Some(self.link_layer_type), packet_count, self.rtp_port_range).ok(),
                    fidelity: crate::packet_capture::PacketFidelity::Authoritative,
                    provenance: crate::packet_capture::PacketProvenance::LocalCapture,
                });
            }
        };

        // Decode full packet for application layer detection
        // This is the SINGLE SOURCE OF TRUTH for protocol detection
        let decoded = protocol_decoder::decode_packet(packet.data, Some(self.link_layer_type), packet_count, self.rtp_port_range).ok();
        
        // Determine protocol from decoded application layer
        // Priority: decoded > payload-based fallback > transport protocol
        let mut final_protocol = if let Some(ref decoded_packet) = decoded {
            match &decoded_packet.application {
                protocol_decoder::ApplicationLayer::Sip(_) => Protocol::SIP,
                protocol_decoder::ApplicationLayer::Rtp(_) => Protocol::RTP,
                protocol_decoder::ApplicationLayer::Srtp(_) => Protocol::SRTP,
                protocol_decoder::ApplicationLayer::Rtcp(_) => Protocol::RTCP,
                protocol_decoder::ApplicationLayer::SipOverWs { .. } => Protocol::SIP,
                protocol_decoder::ApplicationLayer::WebSocket(_) => Protocol::TCP,
                protocol_decoder::ApplicationLayer::Dns(_) => Protocol::DNS,
                protocol_decoder::ApplicationLayer::T38(_) => Protocol::FAX,
                protocol_decoder::ApplicationLayer::Unknown(_) => {
                    // Decoder returned Unknown - try payload-based detection as fallback
                    // Use detect_with_ports to check BOTH src and dst ports for accurate detection
                    if !payload.is_empty() {
                        let fallback = Protocol::detect_with_ports(src_port, dst_port, &payload);
                        if fallback != Protocol::Other {
                            fallback
                        } else {
                            // Final fallback to transport protocol
                            detected_protocol
                        }
                    } else {
                        detected_protocol
                    }
                }
            }
        } else {
            // Decoding failed - try payload-based detection
            // Use detect_with_ports to check BOTH src and dst ports for accurate detection
            if !payload.is_empty() {
                let fallback = Protocol::detect_with_ports(src_port, dst_port, &payload);
                if fallback != Protocol::Other {
                    fallback
                } else {
                    detected_protocol
                }
            } else {
                detected_protocol
            }
        };

        // Safety net: if the protocol is NOT SIP but the payload clearly IS SIP,
        // override the protocol. This catches cases where the decoder misclassified
        // (e.g., SIP response mistaken for RTP due to UTF-8 encoding edge cases).
        if final_protocol != Protocol::SIP && !payload.is_empty() && Protocol::is_sip(&payload) {
            tracing::info!("SIP safety net triggered: overriding {:?} → SIP for packet with ports {}→{}", final_protocol, src_port, dst_port);
            final_protocol = Protocol::SIP;
        }

        Some(PacketInfo {
            timestamp: self.parse_timestamp(&packet.header),
            src_ip,
            dst_ip,
            src_port,
            dst_port,
            protocol: final_protocol,
            size: payload.len(),
            frame_length: packet.data.len(),
            raw_frame: Some(packet.data.to_vec()),
            data: payload,
            decoded,
            fidelity: crate::packet_capture::PacketFidelity::Authoritative,
            provenance: crate::packet_capture::PacketProvenance::LocalCapture,
        })
    }

    fn extract_ip_layer_owned(&self, data: &[u8]) -> Option<Vec<u8>> {
        let offset = match self.link_layer_type {
            1 => {
                // Ethernet: IPv4 (0x0800) or IPv6 (0x86dd), with optional VLAN tag (802.1Q)
                if data.len() >= 14 {
                    let mut ethertype = u16::from_be_bytes([data[12], data[13]]);
                    let mut offset = 14usize;
                    // Handle 802.1Q VLAN tagging (ethertype 0x8100) — skip 4-byte VLAN header
                    // Also handle QinQ (0x88A8) double-tagging
                    while (ethertype == 0x8100 || ethertype == 0x88A8) && data.len() >= offset + 4 {
                        ethertype = u16::from_be_bytes([data[offset + 2], data[offset + 3]]);
                        offset += 4;
                    }
                    if ethertype == 0x0800 && data.len() >= offset + 20 && (data[offset] & 0xF0) == 0x40 {
                        offset
                    } else if ethertype == 0x86dd && data.len() >= offset + 40 && (data[offset] & 0xF0) == 0x60 {
                        offset
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
            0 => {
                // DLT_NULL: BSD loopback encapsulation (4-byte header with address family)
                // On macOS/BSD loopback interfaces (lo0), packets have a 4-byte header
                // containing the address family in host byte order
                if data.len() >= 24 {
                    // Address family is in host byte order (little-endian on Intel, big-endian on PPC)
                    let af_le = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                    let af_be = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                    // AF_INET = 2, AF_INET6 = 30 on macOS/BSD
                    if (af_le == 2 || af_be == 2) && (data[4] & 0xF0) == 0x40 {
                        4  // IPv4
                    } else if (af_le == 30 || af_be == 30) && data.len() >= 44 && (data[4] & 0xF0) == 0x60 {
                        4  // IPv6
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
            113 => {
                // DLT_LINUX_SLL: Linux cooked capture (16-byte header)
                // Also used on some macOS interfaces as Raw IP
                if data.len() >= 16 {
                    // Check if it looks like Linux cooked capture
                    let protocol = u16::from_be_bytes([data[14], data[15]]);
                    if protocol == 0x0800 && data.len() >= 36 && (data[16] & 0xF0) == 0x40 {
                        16  // IPv4 after 16-byte SLL header
                    } else if protocol == 0x86dd && data.len() >= 56 && (data[16] & 0xF0) == 0x60 {
                        16  // IPv6 after 16-byte SLL header
                    } else if data.len() >= 20 && (data[0] & 0xF0) == 0x40 {
                        // Fallback: Raw IP (starts directly with IP header)
                        0
                    } else if data.len() >= 40 && (data[0] & 0xF0) == 0x60 {
                        // Raw IPv6
                        0
                    } else {
                        return None;
                    }
                } else if data.len() >= 20 && (data[0] & 0xF0) == 0x40 {
                    // Short packet, try raw IP
                    0
                } else {
                    return None;
                }
            }
            147 => {
                // DLT_NULL on some systems (BSD loopback)
                // Same as type 0 - 4-byte address family header
                if data.len() >= 24 {
                    let af_le = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                    let af_be = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                    if (af_le == 2 || af_be == 2) && (data[4] & 0xF0) == 0x40 {
                        4
                    } else if (af_le == 30 || af_be == 30) && data.len() >= 44 && (data[4] & 0xF0) == 0x60 {
                        4
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
            12 => {
                // DLT_IEEE802_11: 802.11 WiFi - complex header, skip for now
                // Would need to parse 802.11 MAC header + possible radiotap
                return None;
            }
            _ => {
                // Unknown link layer type - try to auto-detect format
                // Priority: Raw IP > Ethernet > BSD loopback
                if data.len() >= 20 && (data[0] & 0xF0) == 0x40 {
                    // Starts with IPv4 header
                    0
                } else if data.len() >= 40 && (data[0] & 0xF0) == 0x60 {
                    // Starts with IPv6 header
                    0
                } else if data.len() >= 34 && data[12] == 0x08 && data[13] == 0x00 && (data[14] & 0xF0) == 0x40 {
                    // Ethernet with IPv4
                    14
                } else if data.len() >= 54 && data[12] == 0x86 && data[13] == 0xdd && (data[14] & 0xF0) == 0x60 {
                    // Ethernet with IPv6
                    14
                } else if data.len() >= 24 {
                    // Try BSD loopback (4-byte header)
                    let af_le = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                    let af_be = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                    if (af_le == 2 || af_be == 2) && (data[4] & 0xF0) == 0x40 {
                        4
                    } else if (af_le == 30 || af_be == 30) && data.len() >= 44 && (data[4] & 0xF0) == 0x60 {
                        4
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
        };
        
        Some(data[offset..].to_vec())
    }


    fn parse_udp(&self, udp_data: &[u8], _src_ip: IpAddr, _dst_ip: IpAddr) -> Option<(u16, u16, Vec<u8>, Protocol)> {
        if udp_data.len() < 8 {
            return None;
        }

        let src_port = u16::from_be_bytes([udp_data[0], udp_data[1]]);
        let dst_port = u16::from_be_bytes([udp_data[2], udp_data[3]]);
        let payload = if udp_data.len() > 8 {
            udp_data[8..].to_vec()
        } else {
            Vec::new()
        };

        // Simple protocol detection - detailed detection happens via protocol_decoder
        // This is just for fallback when decoder returns Unknown
        let protocol = if dst_port == 53 || src_port == 53 {
            Protocol::DNS
        } else {
            // Return UDP as base protocol - the main parse() function will override
            // with the correct protocol from protocol_decoder
            Protocol::UDP
        };

        Some((src_port, dst_port, payload, protocol))
    }

    fn parse_tcp(&self, tcp_data: &[u8], _src_ip: IpAddr, _dst_ip: IpAddr) -> Option<(u16, u16, Vec<u8>, Protocol)> {
        if tcp_data.len() < 20 {
            return None;
        }

        let src_port = u16::from_be_bytes([tcp_data[0], tcp_data[1]]);
        let dst_port = u16::from_be_bytes([tcp_data[2], tcp_data[3]]);
        let data_offset = ((tcp_data[12] >> 4) & 0x0F) * 4;
        
        let payload = if tcp_data.len() >= data_offset as usize {
            tcp_data[data_offset as usize..].to_vec()
        } else {
            Vec::new()
        };

        // Quick protocol detection based on port
        let protocol = if dst_port == 80 || src_port == 80 {
            if Self::is_http(&payload) {
                Protocol::HTTP
            } else {
                Protocol::TCP
            }
        } else if dst_port == 443 || src_port == 443 {
            Protocol::HTTPS
        } else {
            Protocol::TCP
        };

        Some((src_port, dst_port, payload, protocol))
    }

    fn parse_timestamp(&self, header: &pcap::PacketHeader) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::from_timestamp(
            header.ts.tv_sec.into(),
            (header.ts.tv_usec as u32) * 1000,
        ).unwrap_or_else(|| chrono::Utc::now())
    }

    fn skip_ipv6_ext_headers(data: &[u8]) -> (u8, usize) {
        if data.len() < 40 {
            return (data.get(6).copied().unwrap_or(0), 40);
        }
        let mut next_header = data[6];
        let mut offset = 40usize;
        for _ in 0..10 {
            match next_header {
                0 | 43 | 60 | 135 => {
                    if offset + 2 > data.len() { break; }
                    let ext_len = (data[offset + 1] as usize + 1) * 8;
                    next_header = data[offset];
                    offset += ext_len;
                }
                44 => {
                    if offset + 8 > data.len() { break; }
                    next_header = data[offset];
                    offset += 8;
                }
                51 => {
                    if offset + 2 > data.len() { break; }
                    let ext_len = (data[offset + 1] as usize + 2) * 4;
                    next_header = data[offset];
                    offset += ext_len;
                }
                _ => break,
            }
            if offset >= data.len() { break; }
        }
        (next_header, offset)
    }

    fn is_http(data: &[u8]) -> bool {
        if data.len() < 4 {
            return false;
        }
        let start = String::from_utf8_lossy(&data[..data.len().min(10)]);
        let start_upper = start.to_uppercase();
        start_upper.starts_with("GET ") ||
        start_upper.starts_with("POST ") ||
        start_upper.starts_with("PUT ") ||
        start_upper.starts_with("DELETE ") ||
        start_upper.starts_with("HEAD ") ||
        start_upper.starts_with("OPTIONS ") ||
        start_upper.starts_with("PATCH ") ||
        start_upper.starts_with("HTTP/")
    }
}
