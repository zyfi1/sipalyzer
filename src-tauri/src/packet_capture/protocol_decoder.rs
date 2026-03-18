use anyhow::Result;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use crate::packet_capture::{sip_parser, rtp_analyzer, rtcp_parser, dns_parser, t38_parser, websocket_parser};

/// Per-flow TCP SIP reassembly buffer.
struct TcpSipBuffer {
    data: Vec<u8>,
    last_seen: std::time::Instant,
}

type FlowKey = (IpAddr, u16, IpAddr, u16);

fn make_flow_key(src_ip: IpAddr, src_port: u16, dst_ip: IpAddr, dst_port: u16) -> FlowKey {
    if (src_ip, src_port) < (dst_ip, dst_port) {
        (src_ip, src_port, dst_ip, dst_port)
    } else {
        (dst_ip, dst_port, src_ip, src_port)
    }
}

static TCP_SIP_BUFFERS: Lazy<Mutex<HashMap<FlowKey, TcpSipBuffer>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const TCP_SIP_MAX_BUFFER: usize = 65536;
const TCP_SIP_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DecodedPacket {
    pub ethernet: Option<EthernetHeader>,
    pub ip: Option<IpHeader>,
    pub udp: Option<UdpHeader>,
    pub tcp: Option<TcpHeader>,
    pub application: ApplicationLayer,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EthernetHeader {
    pub dst_mac: String,
    pub src_mac: String,
    pub ethertype: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IpHeader {
    pub version: u8,
    pub header_length: u8,
    pub tos: u8,
    pub total_length: u16,
    pub identification: u16,
    pub flags: u8,
    pub fragment_offset: u16,
    pub ttl: u8,
    pub protocol: u8,
    pub checksum: u16,
    pub src_ip: IpAddr,
    pub dst_ip: IpAddr,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UdpHeader {
    pub src_port: u16,
    pub dst_port: u16,
    pub length: u16,
    pub checksum: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TcpHeader {
    pub src_port: u16,
    pub dst_port: u16,
    pub sequence: u32,
    pub acknowledgment: u32,
    pub data_offset: u8,
    pub flags: u8,
    pub window: u16,
    pub checksum: u16,
    pub urgent_pointer: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ApplicationLayer {
    Sip(sip_parser::ParsedSipMessage),
    /// SIP message transported over WebSocket
    SipOverWs {
        ws_frame: websocket_parser::WebSocketFrame,
        sip: sip_parser::ParsedSipMessage,
    },
    Rtp(rtp_analyzer::RtpHeader),
    Srtp(rtp_analyzer::RtpHeader),
    Rtcp(rtcp_parser::RtcpCompoundPacket),
    Dns(dns_parser::DnsMessage),
    T38(t38_parser::T38UdpTLPacket),
    WebSocket(websocket_parser::WebSocketFrame),
    Unknown(Vec<u8>),
}

pub fn decode_packet(
    data: &[u8],
    link_layer_type: Option<u32>,
    packet_count: Option<u64>,
    rtp_port_range: Option<(u16, u16)>,
) -> Result<DecodedPacket> {
    // Safety check: ensure we have minimum data
    if data.is_empty() {
        return Err(anyhow::anyhow!("Empty packet data"));
    }

    let mut decoded = DecodedPacket {
        ethernet: None,
        ip: None,
        udp: None,
        tcp: None,
        application: ApplicationLayer::Unknown(data.to_vec()),
    };

    let mut offset = 0;

    // Decode based on link layer type
    // MUST match packet_parser.rs extract_ip_layer_owned() exactly!
    match link_layer_type {
        Some(1) | None => {
            // Ethernet with optional VLAN tag (802.1Q / QinQ)
            if data.len() >= 14 {
                let mut ethertype = u16::from_be_bytes([data[12], data[13]]);
                let mut eth_offset = 14usize;
                // Handle 802.1Q VLAN tagging (ethertype 0x8100) — skip 4-byte VLAN header
                // Also handle QinQ (0x88A8) double-tagging
                while (ethertype == 0x8100 || ethertype == 0x88A8) && data.len() >= eth_offset + 4 {
                    ethertype = u16::from_be_bytes([data[eth_offset + 2], data[eth_offset + 3]]);
                    eth_offset += 4;
                }
                decoded.ethernet = Some(EthernetHeader {
                    dst_mac: format_mac(&data[0..6]),
                    src_mac: format_mac(&data[6..12]),
                    ethertype,
                });
                offset = eth_offset;
            }
        }
        Some(0) => {
            // DLT_NULL: BSD loopback encapsulation (4-byte header with address family)
            if data.len() >= 24 {
                let af_le = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                let af_be = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                if (af_le == 2 || af_be == 2) && (data[4] & 0xF0) == 0x40 {
                    offset = 4;  // IPv4
                } else if (af_le == 30 || af_be == 30) && data.len() >= 44 && (data[4] & 0xF0) == 0x60 {
                    offset = 4;  // IPv6
                } else {
                    return Err(anyhow::anyhow!("Invalid BSD loopback header"));
                }
            } else {
                return Err(anyhow::anyhow!("BSD loopback packet too short"));
            }
        }
        Some(113) => {
            // DLT_LINUX_SLL: Linux cooked capture (16-byte header) or Raw IP
            if data.len() >= 16 {
                let protocol = u16::from_be_bytes([data[14], data[15]]);
                if protocol == 0x0800 && data.len() >= 36 && (data[16] & 0xF0) == 0x40 {
                    offset = 16;  // IPv4 after SLL header
                } else if protocol == 0x86dd && data.len() >= 56 && (data[16] & 0xF0) == 0x60 {
                    offset = 16;  // IPv6 after SLL header
                } else if data.len() >= 20 && (data[0] & 0xF0) == 0x40 {
                    offset = 0;  // Raw IPv4
                } else if data.len() >= 40 && (data[0] & 0xF0) == 0x60 {
                    offset = 0;  // Raw IPv6
                } else {
                    return Err(anyhow::anyhow!("Cannot determine IP offset for type 113"));
                }
            } else if data.len() >= 20 && (data[0] & 0xF0) == 0x40 {
                offset = 0;  // Raw IPv4
            } else {
                return Err(anyhow::anyhow!("Packet too short for type 113"));
            }
        }
        Some(147) => {
            // DLT_NULL on some systems (BSD loopback) - same as type 0
            if data.len() >= 24 {
                let af_le = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                let af_be = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                if (af_le == 2 || af_be == 2) && (data[4] & 0xF0) == 0x40 {
                    offset = 4;
                } else if (af_le == 30 || af_be == 30) && data.len() >= 44 && (data[4] & 0xF0) == 0x60 {
                    offset = 4;
                } else {
                    return Err(anyhow::anyhow!("Invalid loopback header for type 147"));
                }
            } else {
                return Err(anyhow::anyhow!("Loopback packet too short"));
            }
        }
        Some(12) => {
            // DLT_IEEE802_11: 802.11 WiFi - not supported
            return Err(anyhow::anyhow!("802.11 WiFi not supported"));
        }
        _ => {
            // Unknown type - auto-detect format (same logic as packet_parser.rs)
            if data.len() >= 20 && (data[0] & 0xF0) == 0x40 {
                offset = 0;  // Raw IPv4
            } else if data.len() >= 40 && (data[0] & 0xF0) == 0x60 {
                offset = 0;  // Raw IPv6
            } else if data.len() >= 14 {
                // Try Ethernet (with optional VLAN tags)
                let mut ethertype = u16::from_be_bytes([data[12], data[13]]);
                let mut eth_offset = 14usize;
                while (ethertype == 0x8100 || ethertype == 0x88A8) && data.len() >= eth_offset + 4 {
                    ethertype = u16::from_be_bytes([data[eth_offset + 2], data[eth_offset + 3]]);
                    eth_offset += 4;
                }
                if ethertype == 0x0800 && data.len() >= eth_offset + 20 && (data[eth_offset] & 0xF0) == 0x40 {
                    decoded.ethernet = Some(EthernetHeader {
                        dst_mac: format_mac(&data[0..6]),
                        src_mac: format_mac(&data[6..12]),
                        ethertype,
                    });
                    offset = eth_offset;
                } else if ethertype == 0x86dd && data.len() >= eth_offset + 40 && (data[eth_offset] & 0xF0) == 0x60 {
                    decoded.ethernet = Some(EthernetHeader {
                        dst_mac: format_mac(&data[0..6]),
                        src_mac: format_mac(&data[6..12]),
                        ethertype,
                    });
                    offset = eth_offset;
                } else if data.len() >= 24 {
                    // Try BSD loopback
                    let af_le = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                    let af_be = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                    if (af_le == 2 || af_be == 2) && (data[4] & 0xF0) == 0x40 {
                        offset = 4;
                    } else if (af_le == 30 || af_be == 30) && data.len() >= 44 && (data[4] & 0xF0) == 0x60 {
                        offset = 4;
                    } else {
                        return Err(anyhow::anyhow!("Cannot determine link layer format"));
                    }
                } else {
                    return Err(anyhow::anyhow!("Cannot determine link layer format"));
                }
            } else {
                return Err(anyhow::anyhow!("Cannot determine link layer format"));
            }
        }
    }

    // Decode IP header - IPv4 or IPv6
    if data.len() >= offset + 20 {
        let ip_data = &data[offset..];
        let version = (ip_data[0] >> 4) & 0x0F;
        if version == 4 && ip_data.len() >= 20 {
            decoded.ip = Some(IpHeader {
                version: 4,
                header_length: (ip_data[0] & 0x0F) * 4,
                tos: ip_data.get(1).copied().unwrap_or(0),
                total_length: u16::from_be_bytes([
                    ip_data.get(2).copied().unwrap_or(0),
                    ip_data.get(3).copied().unwrap_or(0)
                ]),
                identification: u16::from_be_bytes([
                    ip_data.get(4).copied().unwrap_or(0),
                    ip_data.get(5).copied().unwrap_or(0)
                ]),
                flags: (ip_data.get(6).copied().unwrap_or(0) >> 5) & 0x07,
                fragment_offset: u16::from_be_bytes([
                    ip_data.get(6).copied().unwrap_or(0),
                    ip_data.get(7).copied().unwrap_or(0)
                ]) & 0x1FFF,
                ttl: ip_data.get(8).copied().unwrap_or(0),
                protocol: ip_data.get(9).copied().unwrap_or(0),
                checksum: u16::from_be_bytes([
                    ip_data.get(10).copied().unwrap_or(0),
                    ip_data.get(11).copied().unwrap_or(0)
                ]),
                src_ip: IpAddr::V4(std::net::Ipv4Addr::new(
                    ip_data.get(12).copied().unwrap_or(0),
                    ip_data.get(13).copied().unwrap_or(0),
                    ip_data.get(14).copied().unwrap_or(0),
                    ip_data.get(15).copied().unwrap_or(0),
                )),
                dst_ip: IpAddr::V4(std::net::Ipv4Addr::new(
                    ip_data.get(16).copied().unwrap_or(0),
                    ip_data.get(17).copied().unwrap_or(0),
                    ip_data.get(18).copied().unwrap_or(0),
                    ip_data.get(19).copied().unwrap_or(0),
                )),
            });
        } else if version == 6 && ip_data.len() >= 40 {
            // IPv6: walk extension header chain to find actual transport protocol
            let (transport_proto, transport_offset) = skip_ipv6_extension_headers(ip_data);
            decoded.ip = Some(IpHeader {
                version: 6,
                header_length: transport_offset as u8,
                tos: 0,
                total_length: 0,
                identification: 0,
                flags: 0,
                fragment_offset: 0,
                ttl: ip_data.get(7).copied().unwrap_or(0),
                protocol: transport_proto,
                checksum: 0,
                src_ip: IpAddr::V6(std::net::Ipv6Addr::from([
                    ip_data.get(8).copied().unwrap_or(0),
                    ip_data.get(9).copied().unwrap_or(0),
                    ip_data.get(10).copied().unwrap_or(0),
                    ip_data.get(11).copied().unwrap_or(0),
                    ip_data.get(12).copied().unwrap_or(0),
                    ip_data.get(13).copied().unwrap_or(0),
                    ip_data.get(14).copied().unwrap_or(0),
                    ip_data.get(15).copied().unwrap_or(0),
                    ip_data.get(16).copied().unwrap_or(0),
                    ip_data.get(17).copied().unwrap_or(0),
                    ip_data.get(18).copied().unwrap_or(0),
                    ip_data.get(19).copied().unwrap_or(0),
                    ip_data.get(20).copied().unwrap_or(0),
                    ip_data.get(21).copied().unwrap_or(0),
                    ip_data.get(22).copied().unwrap_or(0),
                    ip_data.get(23).copied().unwrap_or(0),
                ])),
                dst_ip: IpAddr::V6(std::net::Ipv6Addr::from([
                    ip_data.get(24).copied().unwrap_or(0),
                    ip_data.get(25).copied().unwrap_or(0),
                    ip_data.get(26).copied().unwrap_or(0),
                    ip_data.get(27).copied().unwrap_or(0),
                    ip_data.get(28).copied().unwrap_or(0),
                    ip_data.get(29).copied().unwrap_or(0),
                    ip_data.get(30).copied().unwrap_or(0),
                    ip_data.get(31).copied().unwrap_or(0),
                    ip_data.get(32).copied().unwrap_or(0),
                    ip_data.get(33).copied().unwrap_or(0),
                    ip_data.get(34).copied().unwrap_or(0),
                    ip_data.get(35).copied().unwrap_or(0),
                    ip_data.get(36).copied().unwrap_or(0),
                    ip_data.get(37).copied().unwrap_or(0),
                    ip_data.get(38).copied().unwrap_or(0),
                    ip_data.get(39).copied().unwrap_or(0),
                ])),
            });
        }
    }

    let ip_header_len = decoded.ip.as_ref()
        .map(|ip| ip.header_length as usize)
        .unwrap_or(20);
        let transport_offset = offset + ip_header_len;

        // Decode transport layer
        let ip_protocol = decoded.ip.as_ref()
            .map(|ip| ip.protocol)
            .unwrap_or(0);
        match ip_protocol {
            17 => {
                // UDP
                if data.len() >= transport_offset + 8 {
                    let udp_data = &data[transport_offset..];
                    // Safe bounds check
                    if udp_data.len() >= 8 {
                        decoded.udp = Some(UdpHeader {
                            src_port: u16::from_be_bytes([
                                udp_data.get(0).copied().unwrap_or(0),
                                udp_data.get(1).copied().unwrap_or(0)
                            ]),
                            dst_port: u16::from_be_bytes([
                                udp_data.get(2).copied().unwrap_or(0),
                                udp_data.get(3).copied().unwrap_or(0)
                            ]),
                            length: u16::from_be_bytes([
                                udp_data.get(4).copied().unwrap_or(0),
                                udp_data.get(5).copied().unwrap_or(0)
                            ]),
                            checksum: u16::from_be_bytes([
                                udp_data.get(6).copied().unwrap_or(0),
                                udp_data.get(7).copied().unwrap_or(0)
                            ]),
                        });
                    }

                    // Decode application layer
                    let app_offset = transport_offset + 8;
                    if data.len() > app_offset {
                        let app_data = &data[app_offset..];
                        if let Some(udp) = decoded.udp.as_ref() {
                            // Check both source and destination ports for DNS (DNS can be on either port 53)
                            let is_dns_port = udp.src_port == 53 || udp.dst_port == 53;
                            decoded.application = decode_application_layer(app_data, udp.src_port, udp.dst_port, is_dns_port, packet_count, rtp_port_range);
                        }
                        // If UDP header missing, leave application as Unknown (already set in initializer)
                    }
                }
            }
            6 => {
                // TCP
                if data.len() >= transport_offset + 20 {
                    let tcp_data = &data[transport_offset..];
                    // Safe bounds check for TCP header
                    if tcp_data.len() >= 20 {
                        let data_offset = ((tcp_data.get(12).copied().unwrap_or(0) >> 4) & 0x0F) * 4;
                        // Ensure data_offset is reasonable (between 20 and 60 bytes)
                        let safe_data_offset = data_offset.max(20).min(60) as usize;
                        decoded.tcp = Some(TcpHeader {
                            src_port: u16::from_be_bytes([
                                tcp_data.get(0).copied().unwrap_or(0),
                                tcp_data.get(1).copied().unwrap_or(0)
                            ]),
                            dst_port: u16::from_be_bytes([
                                tcp_data.get(2).copied().unwrap_or(0),
                                tcp_data.get(3).copied().unwrap_or(0)
                            ]),
                            sequence: u32::from_be_bytes([
                                tcp_data.get(4).copied().unwrap_or(0),
                                tcp_data.get(5).copied().unwrap_or(0),
                                tcp_data.get(6).copied().unwrap_or(0),
                                tcp_data.get(7).copied().unwrap_or(0)
                            ]),
                            acknowledgment: u32::from_be_bytes([
                                tcp_data.get(8).copied().unwrap_or(0),
                                tcp_data.get(9).copied().unwrap_or(0),
                                tcp_data.get(10).copied().unwrap_or(0),
                                tcp_data.get(11).copied().unwrap_or(0)
                            ]),
                            data_offset: (tcp_data.get(12).copied().unwrap_or(0) >> 4) & 0x0F,
                            flags: tcp_data.get(13).copied().unwrap_or(0),
                            window: u16::from_be_bytes([
                                tcp_data.get(14).copied().unwrap_or(0),
                                tcp_data.get(15).copied().unwrap_or(0)
                            ]),
                            checksum: u16::from_be_bytes([
                                tcp_data.get(16).copied().unwrap_or(0),
                                tcp_data.get(17).copied().unwrap_or(0)
                            ]),
                            urgent_pointer: u16::from_be_bytes([
                                tcp_data.get(18).copied().unwrap_or(0),
                                tcp_data.get(19).copied().unwrap_or(0)
                            ]),
                        });

                        // Decode application layer (SIP over TCP)
                        let app_offset = transport_offset + safe_data_offset;
                        if data.len() > app_offset {
                            let app_data = &data[app_offset..];
                            if let Some(tcp) = decoded.tcp.as_ref() {
                                let is_dns_port = tcp.src_port == 53 || tcp.dst_port == 53;
                                let result = decode_application_layer(app_data, tcp.src_port, tcp.dst_port, is_dns_port, packet_count, rtp_port_range);
                                decoded.application = match result {
                                    ApplicationLayer::Unknown(_) => {
                                        if let Some(ref ip) = decoded.ip {
                                            if let Some(reassembled) = try_reassemble_tcp_sip(
                                                app_data, ip.src_ip, tcp.src_port, ip.dst_ip, tcp.dst_port,
                                            ) {
                                                decode_application_layer(&reassembled, tcp.src_port, tcp.dst_port, is_dns_port, packet_count, rtp_port_range)
                                            } else {
                                                ApplicationLayer::Unknown(app_data.to_vec())
                                            }
                                        } else {
                                            ApplicationLayer::Unknown(app_data.to_vec())
                                        }
                                    }
                                    other => other,
                                };
                            }
                        }
                    }
                }
            }
            _ => {}
        }

    Ok(decoded)
}

fn decode_application_layer(data: &[u8], src_port: u16, dst_port: u16, is_dns_port: bool, _packet_count: Option<u64>, rtp_port_range: Option<(u16, u16)>) -> ApplicationLayer {
    // Try DNS first if on port 53 or looks like DNS
    // DNS has a very specific structure and should be checked early
    if is_dns_port || (data.len() >= 12 && is_dns_packet(data)) {
        match dns_parser::parse_dns_message(data) {
            Ok(dns) => {
                if dns.queries.len() > 0 || dns.answers.len() > 0 || dns.questions > 0 || dns.answer_rrs > 0 {
                    return ApplicationLayer::Dns(dns);
                }
            }
            Err(_) => {}
        }
    }

    // STUN guard: STUN binding requests/responses start with specific message types
    // and have a 32-bit magic cookie 0x2112A442 at bytes 4-7 (RFC 5389 §6).
    // Check STUN *before* T.38 to prevent STUN being misidentified as UDPTL.
    let is_stun = data.len() >= 20 && data[4] == 0x21 && data[5] == 0x12 && data[6] == 0xA4 && data[7] == 0x42;

    // T.38 / UDPTL (FAX over IP): content-based detection — skip if STUN
    if !is_stun && t38_parser::looks_like_udptl(data) && data.len() >= 5 {
        if let Some(t38) = t38_parser::parse_udptl(data) {
            return ApplicationLayer::T38(t38);
        }
    }

    // Content-based SIP detection to skip RTP if data looks like SIP
    let looks_like_sip = if data.len() >= 4 {
        let text = String::from_utf8_lossy(&data[..data.len().min(200)]);
        let text_upper = text.to_uppercase();
        text_upper.starts_with("REGISTER ") || text_upper.starts_with("INVITE ") ||
        text_upper.starts_with("ACK ") || text_upper.starts_with("BYE ") ||
        text_upper.starts_with("CANCEL ") || text_upper.starts_with("OPTIONS ") ||
        text_upper.starts_with("PRACK ") || text_upper.starts_with("UPDATE ") ||
        text_upper.starts_with("INFO ") || text_upper.starts_with("REFER ") ||
        text_upper.starts_with("NOTIFY ") || text_upper.starts_with("SUBSCRIBE ") ||
        text_upper.starts_with("PUBLISH ") || text_upper.starts_with("MESSAGE ") ||
        text_upper.starts_with("SIP/2.0") || text_upper.contains("VIA: SIP/2.0")
    } else {
        false
    };

    // Skip RTP/RTCP for SIP, STUN, or well-known non-RTP ports (HTTPS/QUIC on 443).
    // UDP 443 is QUIC/HTTP3; encrypted payloads can randomly match RTP header bits.
    let is_well_known_non_rtp_port = dst_port == 443 || src_port == 443
        || dst_port == 80 || src_port == 80;

    // Port range gate: only consider RTP/RTCP on ports within the expected range
    // (default 10000-60000). Excludes random UDP on low ports (NTP/123, SNMP/161, etc.)
    // that can accidentally match the minimal RTP header pattern.
    let outside_rtp_range = if let Some((lo, hi)) = rtp_port_range {
        (src_port < lo || src_port > hi) && (dst_port < lo || dst_port > hi)
    } else {
        false
    };

    // DTLS records (content types 20-25, version 0xFEFF or 0xFEFD) often share ports
    // with RTP in WebRTC; their first byte (20-25) with version=2 bit can false-match.
    let is_dtls = data.len() >= 13
        && data[0] >= 20 && data[0] <= 25
        && data[1] == 0xFE
        && (data[2] == 0xFF || data[2] == 0xFD);

    let should_skip_rtp = looks_like_sip || is_stun || is_well_known_non_rtp_port
        || outside_rtp_range || is_dtls;

    // RTP/RTCP have very specific binary header formats
    if !should_skip_rtp && data.len() >= 12 {
        // Check for RTCP first (packet type 200-211, more specific than RTP)
        if rtcp_parser::is_rtcp(data) {
            if let Ok(rtcp) = rtcp_parser::parse_rtcp_compound(data) {
                return ApplicationLayer::Rtcp(rtcp);
            }
        }

        // Try RTP — parse_rtp_header now validates CSRC and extension lengths
        if let Ok(rtp) = rtp_analyzer::parse_rtp_header(data) {
            if rtp.version == 2 {
                // Accept all valid payload types except RTCP-conflict range (72-76, per RFC 3550 §5.2)
                let is_valid_pt = rtp.payload_type <= 71 || rtp.payload_type >= 77;
                let has_valid_ssrc = rtp.ssrc != 0xFFFFFFFF;

                if is_valid_pt && has_valid_ssrc {
                    let mut rtp = rtp;
                    let codec = rtp_analyzer::get_codec_name(rtp.payload_type);
                    if codec == "telephone-event" || rtp.payload_type == 101 {
                        let header_len = 12 + (rtp.csrc_count as usize) * 4
                            + rtp.extension_length.map(|l| l as usize).unwrap_or(0);
                        if data.len() > header_len {
                            rtp.dtmf_event = rtp_analyzer::parse_dtmf_event(&data[header_len..]);
                        }
                    }
                    return ApplicationLayer::Rtp(rtp);
                }
            }
        }
    }

    // Try SIP detection - content-based only, no port restrictions

    // Quick check: SIP messages must start with valid SIP methods or "SIP/"
    if data.len() >= 4 {
        // Use from_utf8_lossy to handle any non-UTF8 bytes gracefully
        let text_lossy = String::from_utf8_lossy(&data[..data.len().min(200)]);
        let text_upper = text_lossy.to_uppercase();
        let has_sip_signature = text_upper.starts_with("REGISTER ")
                || text_upper.starts_with("INVITE ")
                || text_upper.starts_with("ACK ")
                || text_upper.starts_with("BYE ")
                || text_upper.starts_with("CANCEL ")
                || text_upper.starts_with("OPTIONS ")
                || text_upper.starts_with("PRACK ")
                || text_upper.starts_with("UPDATE ")
                || text_upper.starts_with("INFO ")
                || text_upper.starts_with("REFER ")
                || text_upper.starts_with("NOTIFY ")
                || text_upper.starts_with("SUBSCRIBE ")
                || text_upper.starts_with("PUBLISH ")
                || text_upper.starts_with("MESSAGE ")
                || text_upper.starts_with("SIP/2.0")
                || text_upper.contains("VIA: SIP/2.0")
                || text_upper.contains("FROM: <SIP:")
                || text_upper.contains("TO: <SIP:")
                || (text_upper.contains("CSEQ:") && (text_upper.contains("REGISTER") || text_upper.contains("INVITE")))
                || (text_upper.contains("CALL-ID:") || text_upper.contains("CALLID:"));
        // Also keep a strict UTF-8 result for the SIP parser (which requires valid UTF-8)
        let text_result = String::from_utf8(data[..data.len().min(200)].to_vec());
        
        if has_sip_signature {
            match sip_parser::parse_sip_message(data) {
                Ok(sip) => {
                    if sip.method.is_some() || sip.response_code.is_some() {
                        return ApplicationLayer::Sip(sip);
                    } else {
                        // Parser returned a message but couldn't extract method/code — try raw extraction
                        let method = extract_sip_method_from_raw(&text_result);
                        let mut sip_with_method = sip;
                        if method.is_some() {
                            sip_with_method.method = method;
                        }
                        return ApplicationLayer::Sip(sip_with_method);
                    }
                }
                Err(_) => {
                    // Parser failed but strong SIP signature — create minimal SIP structure
                    if has_sip_signature {
                        let data_str = String::from_utf8_lossy(data);
                        let method = extract_sip_method_from_raw(&text_result);
                        let minimal_sip = sip_parser::ParsedSipMessage {
                            method,
                            response_code: None,
                            response_text: None,
                            request_uri: None,
                            from: None,
                            to: None,
                            call_id: None,
                            cseq: None,
                            via: Vec::new(),
                            contact: None,
                            body: None,
                            content_type: None,
                            content_length: None,
                            headers: std::collections::HashMap::new(),
                            raw_message: data_str.to_string(),
                        };
                        return ApplicationLayer::Sip(minimal_sip);
                    }
                }
            }
        }
    }

    // Try WebSocket detection - content-based only, no port restrictions
    if websocket_parser::is_websocket_frame(data) && data.len() >= 2 {
        if let Ok(ws_frame) = websocket_parser::parse_websocket_frame(data) {
            // Check if WebSocket payload contains SIP
            if ws_frame.is_sip_payload() {
                if let Ok(sip) = sip_parser::parse_sip_message(&ws_frame.payload) {
                    if sip.method.is_some() || sip.response_code.is_some() {
                        return ApplicationLayer::SipOverWs { ws_frame, sip };
                    }
                }
            }
            // Return WebSocket frame even if not SIP
            return ApplicationLayer::WebSocket(ws_frame);
        }
    }

    ApplicationLayer::Unknown(data.to_vec())
}

/// Extract a SIP method from the first line of raw text data.
/// Preserves wire casing (RFC 3261: methods are case-sensitive).
fn extract_sip_method_from_raw(text_result: &Result<String, std::string::FromUtf8Error>) -> Option<String> {
    let text = text_result.as_ref().ok()?;
    let first_line = text.lines().next()?.trim();
    let method_token = first_line.split_whitespace().next()?;
    // Validate it looks like a SIP method (all uppercase letters per RFC 3261 ABNF)
    let upper = method_token.to_uppercase();
    match upper.as_str() {
        "REGISTER" | "INVITE" | "ACK" | "BYE" | "CANCEL" | "OPTIONS" |
        "PRACK" | "UPDATE" | "INFO" | "REFER" | "NOTIFY" | "SUBSCRIBE" |
        "PUBLISH" | "MESSAGE" => Some(method_token.to_string()),
        _ => None,
    }
}

fn format_mac(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join(":")
}

fn has_sip_start(data: &[u8]) -> bool {
    if data.len() < 4 { return false; }
    let s = String::from_utf8_lossy(&data[..data.len().min(20)]).to_uppercase();
    s.starts_with("SIP/2.0") || s.starts_with("REGISTER ") || s.starts_with("INVITE ")
        || s.starts_with("ACK ") || s.starts_with("BYE ") || s.starts_with("CANCEL ")
        || s.starts_with("OPTIONS ") || s.starts_with("PRACK ") || s.starts_with("UPDATE ")
        || s.starts_with("INFO ") || s.starts_with("REFER ") || s.starts_with("NOTIFY ")
        || s.starts_with("SUBSCRIBE ") || s.starts_with("PUBLISH ") || s.starts_with("MESSAGE ")
}

/// Check if a SIP message in `data` is complete (has header/body separator and full body).
fn is_sip_complete(data: &[u8]) -> bool {
    let text = match std::str::from_utf8(data) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let sep_pos = match text.find("\r\n\r\n") {
        Some(p) => p,
        None => return false,
    };
    let header_section = &text[..sep_pos];
    let body_start = sep_pos + 4;
    let mut content_length: Option<usize> = None;
    for line in header_section.lines() {
        let lower = line.to_lowercase();
        if lower.starts_with("content-length:") || lower.starts_with("l:") {
            if let Some(val) = line.splitn(2, ':').nth(1) {
                content_length = val.trim().parse().ok();
            }
        }
    }
    match content_length {
        Some(cl) => data.len() >= body_start + cl,
        None => true,
    }
}

/// Attempt TCP SIP reassembly. Returns Some(complete_message) or None.
fn try_reassemble_tcp_sip(
    payload: &[u8],
    src_ip: IpAddr, src_port: u16,
    dst_ip: IpAddr, dst_port: u16,
) -> Option<Vec<u8>> {
    let key = make_flow_key(src_ip, src_port, dst_ip, dst_port);
    let mut buffers = TCP_SIP_BUFFERS.lock().ok()?;

    // Evict stale buffers
    let now = std::time::Instant::now();
    buffers.retain(|_, buf| now.duration_since(buf.last_seen).as_secs() < TCP_SIP_TIMEOUT_SECS);

    if let Some(buf) = buffers.get_mut(&key) {
        if buf.data.len() + payload.len() > TCP_SIP_MAX_BUFFER {
            buffers.remove(&key);
            return None;
        }
        buf.data.extend_from_slice(payload);
        buf.last_seen = now;
        if is_sip_complete(&buf.data) {
            let complete = buf.data.clone();
            buffers.remove(&key);
            return Some(complete);
        }
        return None;
    }

    if has_sip_start(payload) && !is_sip_complete(payload) {
        buffers.insert(key, TcpSipBuffer {
            data: payload.to_vec(),
            last_seen: now,
        });
        return None;
    }

    None
}

/// Walk IPv6 extension header chain to find the transport protocol and its offset.
/// Returns (transport_protocol, offset_from_ipv6_start).
fn skip_ipv6_extension_headers(data: &[u8]) -> (u8, usize) {
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

/// Heuristic check for DNS packet structure (RFC 1035 §4.1.1).
/// DNS header: ID(2) Flags(2) QDCOUNT(2) ANCOUNT(2) NSCOUNT(2) ARCOUNT(2)
fn is_dns_packet(data: &[u8]) -> bool {
    if data.len() < 12 {
        return false;
    }
    let flags = u16::from_be_bytes([data[2], data[3]]);
    // Opcode is bits 1-4 of the flags byte (RFC 1035 §4.1.1)
    let opcode = (flags >> 11) & 0x0F;
    // Valid opcodes: 0=QUERY, 1=IQUERY, 2=STATUS, 4=NOTIFY, 5=UPDATE
    if opcode > 5 || opcode == 3 {
        return false;
    }
    // RCODE (response code) is bits 0-3 of the second flags byte; values > 10 are unusual
    let rcode = flags & 0x0F;
    if rcode > 10 {
        return false;
    }
    // Reasonable question/answer counts
    let questions = u16::from_be_bytes([data[4], data[5]]);
    let answers = u16::from_be_bytes([data[6], data[7]]);
    questions <= 100 && answers <= 1000
}
