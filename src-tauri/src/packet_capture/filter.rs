use std::net::IpAddr;
use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterConfig {
    pub protocols: Vec<String>,
    pub src_ip_ranges: Vec<String>, // CIDR notation
    pub dst_ip_ranges: Vec<String>,
    pub src_ports: Vec<u16>,
    pub dst_ports: Vec<u16>,
    pub port_ranges: Vec<(u16, u16)>, // (min, max)
    #[serde(default)]
    pub rtp_port_range: Option<(u16, u16)>, // Optional RTP port range for detection (min, max)
}

impl Default for FilterConfig {
    /// Default = no filters: all packets are kept (BPF is None, matches() is true for every packet).
    /// Used for per-test and per-call captures (registration test, softphone call, fax send) so the
    /// capture contains everything on the interface for the duration; the user can then filter in the UI.
    fn default() -> Self {
        Self {
            protocols: Vec::new(),
            src_ip_ranges: Vec::new(),
            dst_ip_ranges: Vec::new(),
            src_ports: Vec::new(),
            dst_ports: Vec::new(),
            port_ranges: Vec::new(),
            rtp_port_range: None,
        }
    }
}

impl FilterConfig {
    /// Returns true if the packet should be kept (stored, written to PCAP, counted in stats).
    /// Each non-empty filter list is ANDed: packet must match protocol (if set), src/dst IP (if set), and ports (if set).
    /// Empty list for a dimension means no filter for that dimension (accept all).
    pub fn matches(&self, packet: &crate::packet_capture::PacketInfo) -> bool {
        // Protocol filter - if protocols list is empty, accept all
        if !self.protocols.is_empty() {
            let protocol_str = match packet.protocol {
                crate::packet_capture::Protocol::SIP => "SIP",
                crate::packet_capture::Protocol::RTP => "RTP",
                crate::packet_capture::Protocol::SRTP => "SRTP",
                crate::packet_capture::Protocol::RTCP => "RTCP",
                crate::packet_capture::Protocol::FAX => "FAX",
                crate::packet_capture::Protocol::TCP => "TCP",
                crate::packet_capture::Protocol::UDP => "UDP",
                crate::packet_capture::Protocol::HTTP => "HTTP",
                crate::packet_capture::Protocol::HTTPS => "HTTPS",
                crate::packet_capture::Protocol::DNS => "DNS",
                crate::packet_capture::Protocol::ICMP => "ICMP",
                crate::packet_capture::Protocol::ARP => "ARP",
                crate::packet_capture::Protocol::Other => "OTHER",
            };

            // Check if protocol matches (case-insensitive)
            // Also handle transport protocol fallback for VOIP protocols
            let matches = self.protocols.iter().any(|p| {
                p.eq_ignore_ascii_case(protocol_str) ||
                // Allow UDP filter to match SIP/RTP/RTCP/FAX (they use UDP transport)
                (p.eq_ignore_ascii_case("UDP") && matches!(
                    packet.protocol,
                    crate::packet_capture::Protocol::SIP |
                    crate::packet_capture::Protocol::RTP |
                    crate::packet_capture::Protocol::RTCP |
                    crate::packet_capture::Protocol::FAX |
                    crate::packet_capture::Protocol::DNS
                )) ||
                // Allow TCP filter to match HTTP/HTTPS (they use TCP transport)
                (p.eq_ignore_ascii_case("TCP") && matches!(
                    packet.protocol,
                    crate::packet_capture::Protocol::HTTP |
                    crate::packet_capture::Protocol::HTTPS
                ))
            });

            if !matches {
                return false;
            }
        }

        // Source IP filter
        if !self.src_ip_ranges.is_empty() {
            let matches = self.src_ip_ranges.iter().any(|range| {
                if let Ok(network) = range.parse::<IpNetwork>() {
                    network.contains(packet.src_ip)
                } else if let Ok(ip) = range.parse::<IpAddr>() {
                    ip == packet.src_ip
                } else {
                    false
                }
            });
            if !matches {
                return false;
            }
        }

        // Destination IP filter
        if !self.dst_ip_ranges.is_empty() {
            let matches = self.dst_ip_ranges.iter().any(|range| {
                if let Ok(network) = range.parse::<IpNetwork>() {
                    network.contains(packet.dst_ip)
                } else if let Ok(ip) = range.parse::<IpAddr>() {
                    ip == packet.dst_ip
                } else {
                    false
                }
            });
            if !matches {
                return false;
            }
        }

        // Source port filter
        if !self.src_ports.is_empty() && !self.src_ports.contains(&packet.src_port) {
            return false;
        }

        // Destination port filter
        if !self.dst_ports.is_empty() && !self.dst_ports.contains(&packet.dst_port) {
            return false;
        }

        // Port range filter
        if !self.port_ranges.is_empty() {
            let matches_port = self.port_ranges.iter().any(|(min, max)| {
                (packet.src_port >= *min && packet.src_port <= *max)
                    || (packet.dst_port >= *min && packet.dst_port <= *max)
            });
            if !matches_port {
                return false;
            }
        }

        true
    }
}
