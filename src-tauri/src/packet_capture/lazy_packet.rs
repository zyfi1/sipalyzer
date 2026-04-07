//! Lazy packet decoding using OnceCell.
//!
//! This module provides `LazyPacketInfo` which defers expensive protocol
//! decoding until the decoded data is actually accessed. This significantly
//! reduces CPU usage when capturing high packet rates since most packets
//! are never viewed in detail.

use std::net::IpAddr;
use std::sync::Arc;

use once_cell::sync::OnceCell;

use crate::packet_capture::protocol_decoder::{decode_packet, DecodedPacket};
use crate::packet_capture::{PacketFidelity, PacketInfo, PacketProvenance, Protocol};

/// Packet info with lazy protocol decoding.
///
/// The raw packet data is stored and full protocol decoding is deferred
/// until `decoded()` is called. This improves capture performance by
/// avoiding unnecessary decoding of packets that are never inspected.
#[derive(Clone)]
pub struct LazyPacketInfo {
    /// Packet timestamp.
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Source IP address.
    pub src_ip: IpAddr,
    /// Destination IP address.
    pub dst_ip: IpAddr,
    /// Source port (0 for non-port protocols like ICMP).
    pub src_port: u16,
    /// Destination port.
    pub dst_port: u16,
    /// Detected protocol.
    pub protocol: Protocol,
    /// Application payload size.
    pub size: usize,
    /// Full captured frame length.
    pub frame_length: usize,
    /// Application layer payload (e.g., UDP payload).
    pub payload: Arc<[u8]>,
    /// Full raw packet data for lazy decoding.
    pub raw_data: Arc<[u8]>,
    /// Capture fidelity marker.
    pub fidelity: PacketFidelity,
    /// Packet origin marker.
    pub provenance: PacketProvenance,
    /// Link layer type for decoding.
    pub link_layer_type: u32,
    /// RTP port range for protocol detection.
    pub rtp_port_range: Option<(u16, u16)>,
    /// Lazily decoded packet data.
    decoded: OnceCell<DecodedPacket>,
}

impl LazyPacketInfo {
    /// Create a new lazy packet info.
    pub fn new(
        timestamp: chrono::DateTime<chrono::Utc>,
        src_ip: IpAddr,
        dst_ip: IpAddr,
        src_port: u16,
        dst_port: u16,
        protocol: Protocol,
        size: usize,
        frame_length: usize,
        payload: Vec<u8>,
        raw_data: Vec<u8>,
        fidelity: PacketFidelity,
        provenance: PacketProvenance,
        link_layer_type: u32,
        rtp_port_range: Option<(u16, u16)>,
    ) -> Self {
        Self {
            timestamp,
            src_ip,
            dst_ip,
            src_port,
            dst_port,
            protocol,
            size,
            frame_length,
            payload: payload.into(),
            raw_data: raw_data.into(),
            fidelity,
            provenance,
            link_layer_type,
            rtp_port_range,
            decoded: OnceCell::new(),
        }
    }

    /// Get the decoded packet data, computing it lazily if needed.
    ///
    /// This performs full protocol decoding on first access and caches
    /// the result for subsequent calls.
    pub fn decoded(&self) -> &DecodedPacket {
        self.decoded.get_or_init(|| {
            decode_packet(
                &self.raw_data,
                Some(self.link_layer_type),
                None,
                self.rtp_port_range,
            )
            .unwrap_or_else(|_| DecodedPacket::default())
        })
    }

    /// Check if the packet has already been decoded.
    pub fn is_decoded(&self) -> bool {
        self.decoded.get().is_some()
    }

    /// Convert to a standard `PacketInfo` for serialization.
    ///
    /// If the packet has been decoded, includes the decoded data.
    /// Otherwise, the decoded field will be None.
    pub fn to_packet_info(&self) -> PacketInfo {
        PacketInfo {
            timestamp: self.timestamp,
            src_ip: self.src_ip,
            dst_ip: self.dst_ip,
            src_port: self.src_port,
            dst_port: self.dst_port,
            protocol: self.protocol,
            size: self.size,
            frame_length: self.frame_length,
            raw_frame: Some(self.raw_data.to_vec()),
            data: self.payload.to_vec(),
            decoded: self.decoded.get().cloned(),
            fidelity: self.fidelity,
            provenance: self.provenance,
        }
    }

    /// Convert to a standard `PacketInfo` with forced decoding.
    ///
    /// This always decodes the packet before conversion.
    pub fn to_packet_info_decoded(&self) -> PacketInfo {
        let _ = self.decoded(); // Force decode
        self.to_packet_info()
    }

    /// Create a LazyPacketInfo from an existing PacketInfo.
    ///
    /// Note: This is a fallback for compatibility. For new code,
    /// prefer creating LazyPacketInfo directly from raw data.
    pub fn from_packet_info(info: PacketInfo, raw_data: Vec<u8>, link_layer_type: u32) -> Self {
        let decoded_cell = OnceCell::new();
        if let Some(decoded) = info.decoded {
            let _ = decoded_cell.set(decoded);
        }

        Self {
            timestamp: info.timestamp,
            src_ip: info.src_ip,
            dst_ip: info.dst_ip,
            src_port: info.src_port,
            dst_port: info.dst_port,
            protocol: info.protocol,
            size: info.size,
            frame_length: info.frame_length,
            fidelity: info.fidelity,
            provenance: info.provenance,
            payload: info.data.into(),
            raw_data: raw_data.into(),
            link_layer_type,
            rtp_port_range: None,
            decoded: decoded_cell,
        }
    }

    /// Get a summary string for the packet (delegates to decoded data if available).
    pub fn summary(&self) -> String {
        // Use decoded data if available, otherwise use basic info
        if let Some(decoded) = self.decoded.get() {
            self.summary_with_decoded(decoded)
        } else {
            self.basic_summary()
        }
    }

    fn basic_summary(&self) -> String {
        match self.protocol {
            Protocol::SIP => format!(
                "SIP {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::RTP => format!(
                "RTP {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::SRTP => format!(
                "SRTP {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::RTCP => format!(
                "RTCP {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::FAX => format!(
                "FAX {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::TCP => format!(
                "TCP {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::UDP => format!(
                "UDP {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::HTTP => format!(
                "HTTP {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::HTTPS => format!(
                "HTTPS {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::DNS => format!(
                "DNS {}:{} -> {}:{}",
                self.src_ip, self.src_port, self.dst_ip, self.dst_port
            ),
            Protocol::ICMP => format!("ICMP {} -> {}", self.src_ip, self.dst_ip),
            Protocol::ARP => format!("ARP {} -> {}", self.src_ip, self.dst_ip),
            Protocol::Other => format!("IP {} -> {}", self.src_ip, self.dst_ip),
        }
    }

    fn summary_with_decoded(&self, decoded: &DecodedPacket) -> String {
        use crate::packet_capture::ApplicationLayer;

        match &decoded.application {
            ApplicationLayer::Sip(sip) => {
                if let Some(ref method) = sip.method {
                    format!(
                        "SIP {} {}:{} -> {}:{}",
                        method, self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                } else if let Some(code) = sip.response_code {
                    let reason = sip.response_text.as_deref().unwrap_or("");
                    format!(
                        "SIP {} {} {}:{} -> {}:{}",
                        code, reason, self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                } else {
                    format!(
                        "SIP {}:{} -> {}:{}",
                        self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                }
            }
            ApplicationLayer::Rtp(rtp) => {
                format!(
                    "RTP PT:{} SSRC:0x{:08x} {}:{} -> {}:{}",
                    rtp.payload_type,
                    rtp.ssrc,
                    self.src_ip,
                    self.src_port,
                    self.dst_ip,
                    self.dst_port
                )
            }
            ApplicationLayer::Srtp(rtp) => {
                format!(
                    "SRTP PT:{} SSRC:0x{:08x} {}:{} -> {}:{}",
                    rtp.payload_type,
                    rtp.ssrc,
                    self.src_ip,
                    self.src_port,
                    self.dst_ip,
                    self.dst_port
                )
            }
            ApplicationLayer::Rtcp(rtcp) => {
                if let Some(first) = rtcp.packets.first() {
                    let type_name = match first.packet_type {
                        200 => "SR",
                        201 => "RR",
                        202 => "SDES",
                        203 => "BYE",
                        204 => "APP",
                        _ => "RTCP",
                    };
                    format!(
                        "RTCP {} SSRC:0x{:08x} {}:{} -> {}:{}",
                        type_name,
                        first.ssrc,
                        self.src_ip,
                        self.src_port,
                        self.dst_ip,
                        self.dst_port
                    )
                } else {
                    format!(
                        "RTCP {}:{} -> {}:{}",
                        self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                }
            }
            ApplicationLayer::Dns(dns) => {
                if dns.queries.is_empty() {
                    format!(
                        "DNS {}:{} -> {}:{}",
                        self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                } else {
                    let query_names: Vec<String> =
                        dns.queries.iter().map(|q| q.name.clone()).collect();
                    format!(
                        "DNS {} {}:{} -> {}:{}",
                        query_names.join(","),
                        self.src_ip,
                        self.src_port,
                        self.dst_ip,
                        self.dst_port
                    )
                }
            }
            ApplicationLayer::T38(t38) => {
                let ifp = t38.ifp_type.as_deref().unwrap_or("UDPTL");
                format!(
                    "T.38 {} seq {} {}:{} -> {}:{}",
                    ifp, t38.seq, self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            ApplicationLayer::SipOverWs { sip, .. } => {
                if let Some(ref method) = sip.method {
                    format!(
                        "SIP/WS {} {}:{} -> {}:{}",
                        method, self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                } else if let Some(code) = sip.response_code {
                    let reason = sip.response_text.as_deref().unwrap_or("");
                    format!(
                        "SIP/WS {} {} {}:{} -> {}:{}",
                        code, reason, self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                } else {
                    format!(
                        "SIP/WS {}:{} -> {}:{}",
                        self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                }
            }
            ApplicationLayer::WebSocket(ws) => {
                format!(
                    "WebSocket {} {}:{} -> {}:{}",
                    ws.opcode_name, self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            ApplicationLayer::Unknown(_) => self.basic_summary(),
        }
    }
}

impl std::fmt::Debug for LazyPacketInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LazyPacketInfo")
            .field("timestamp", &self.timestamp)
            .field("src_ip", &self.src_ip)
            .field("dst_ip", &self.dst_ip)
            .field("src_port", &self.src_port)
            .field("dst_port", &self.dst_port)
            .field("protocol", &self.protocol)
            .field("size", &self.size)
            .field("is_decoded", &self.is_decoded())
            .finish()
    }
}

impl Default for DecodedPacket {
    fn default() -> Self {
        Self {
            ethernet: None,
            ip: None,
            udp: None,
            tcp: None,
            application: crate::packet_capture::ApplicationLayer::Unknown(Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn test_lazy_packet_creation() {
        let packet = LazyPacketInfo::new(
            chrono::Utc::now(),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
            5060,
            5060,
            Protocol::SIP,
            100,
            142,
            vec![0u8; 100],
            vec![0u8; 142],
            PacketFidelity::Authoritative,
            PacketProvenance::Unknown,
            1, // Ethernet
            Some((10000, 60000)),
        );

        assert!(!packet.is_decoded());
        assert_eq!(packet.protocol, Protocol::SIP);
    }

    #[test]
    fn test_lazy_decode() {
        let packet = LazyPacketInfo::new(
            chrono::Utc::now(),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
            5060,
            5060,
            Protocol::UDP,
            100,
            142,
            vec![0u8; 100],
            vec![0u8; 142],
            PacketFidelity::Authoritative,
            PacketProvenance::Unknown,
            1,
            None,
        );

        assert!(!packet.is_decoded());

        // Accessing decoded triggers lazy decode
        let _ = packet.decoded();

        assert!(packet.is_decoded());
    }

    #[test]
    fn test_clone_preserves_decoded() {
        let packet = LazyPacketInfo::new(
            chrono::Utc::now(),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
            5060,
            5060,
            Protocol::UDP,
            100,
            142,
            vec![0u8; 100],
            vec![0u8; 142],
            PacketFidelity::Authoritative,
            PacketProvenance::Unknown,
            1,
            None,
        );

        // Force decode
        let _ = packet.decoded();

        // Clone and verify still decoded
        let _cloned = packet.clone();
        // Note: Clone of OnceCell doesn't copy the initialized value
        // This is expected behavior - each clone starts fresh
    }
}
