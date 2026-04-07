use std::net::IpAddr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Protocol {
    SIP,
    RTP,
    SRTP,
    RTCP,
    FAX,
    TCP,
    UDP,
    HTTP,
    HTTPS,
    DNS,
    ICMP,
    ARP,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PacketFidelity {
    /// Parsed from a real captured frame.
    Authoritative,
    /// Synthesized or inferred packet representation.
    Simulated,
}

impl Default for PacketFidelity {
    fn default() -> Self {
        Self::Authoritative
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PacketProvenance {
    LocalCapture,
    PipelineCapture,
    RemoteCapture,
    AgentRawFrameInjection,
    AgentPacketInfoInjection,
    Unknown,
}

impl Default for PacketProvenance {
    fn default() -> Self {
        Self::Unknown
    }
}

impl Protocol {
    /// Detect protocol from port and payload data.
    /// Accepts dst_port for backwards compatibility - use detect_with_ports for full detection.
    #[allow(unused_variables)]
    pub fn detect(dst_port: u16, data: &[u8]) -> Self {
        Self::detect_with_ports(0, dst_port, data)
    }

    /// Detect protocol from both source and destination ports and payload data.
    /// Detection is purely content/payload-based - no port restrictions.
    #[allow(unused_variables)]
    pub fn detect_with_ports(src_port: u16, dst_port: u16, data: &[u8]) -> Self {
        // SIP: content-based detection (SIP methods or "SIP/2.0" response)
        if Self::is_sip(data) {
            return Protocol::SIP;
        }

        // RTCP: content-based detection (version=2, packet type 200-211)
        // Check RTCP before RTP since RTCP is more specific
        if Self::is_rtcp(data) {
            return Protocol::RTCP;
        }

        // RTP: content-based detection (version=2, valid payload type, valid header structure)
        if Self::is_rtp(data) {
            return Protocol::RTP;
        }

        // FAX/T.38: content-based detection (UDPTL structure)
        if Self::is_fax_content_based(data) {
            return Protocol::FAX;
        }

        Protocol::Other
    }

    pub fn is_sip(data: &[u8]) -> bool {
        if data.len() < 4 {
            return false;
        }

        // SIP messages start with method or "SIP/"
        // Try to find the start of the SIP message (skip any leading whitespace/null bytes)
        let mut start_idx = 0;
        while start_idx < data.len().min(10)
            && (data[start_idx] == 0 || data[start_idx].is_ascii_whitespace())
        {
            start_idx += 1;
        }

        if start_idx >= data.len() {
            return false;
        }

        // Check a larger window to catch SIP messages (increased from 50 to 200 bytes)
        let check_len = (data.len() - start_idx).min(200);
        let start = String::from_utf8_lossy(&data[start_idx..start_idx + check_len]);
        let start_upper = start.trim().to_uppercase();

        // SIP methods (check if any line starts with these) - must be at start of line
        let is_sip_method = start_upper.starts_with("REGISTER ")
            || start_upper.starts_with("INVITE ")
            || start_upper.starts_with("ACK ")
            || start_upper.starts_with("BYE ")
            || start_upper.starts_with("CANCEL ")
            || start_upper.starts_with("OPTIONS ")
            || start_upper.starts_with("PRACK ")
            || start_upper.starts_with("UPDATE ")
            || start_upper.starts_with("INFO ")
            || start_upper.starts_with("REFER ")
            || start_upper.starts_with("NOTIFY ")
            || start_upper.starts_with("SUBSCRIBE ")
            || start_upper.starts_with("PUBLISH ")
            || start_upper.starts_with("MESSAGE ");

        // SIP responses
        let is_sip_response = start_upper.starts_with("SIP/2.0");

        // More lenient checks for SIP headers (check anywhere in first 200 bytes)
        let has_sip_headers = (start_upper.contains("VIA:") && start_upper.contains("SIP/2.0"))
            || (start_upper.contains("FROM:") && start_upper.contains("TO:"))
            || (start_upper.contains("CALL-ID:") || start_upper.contains("CALLID:"))
            || (start_upper.contains("CONTACT:") && start_upper.contains("SIP/2.0"))
            || (start_upper.contains("CSEQ:")
                && (start_upper.contains("REGISTER") || start_upper.contains("INVITE")));

        is_sip_method || is_sip_response || has_sip_headers
    }

    fn is_rtp(data: &[u8]) -> bool {
        if data.len() < 12 {
            return false;
        }

        // RTP header: V(2) P(1) X(1) CC(4) M(1) PT(7) Sequence(16) Timestamp(32) SSRC(32)
        let version = (data[0] >> 6) & 0x03;
        let csrc_count = data[0] & 0x0F;
        let payload_type = data[1] & 0x7F;

        // RTP version must be 2 (RFC 3550 §5.1)
        if version != 2 {
            return false;
        }

        // CC is 4 bits so max 15 — always valid, but verify packet is long enough for CSRC list
        let min_header = 12 + (csrc_count as usize) * 4;
        if data.len() < min_header {
            return false;
        }

        // Payload type: RFC 3551 defines 0-34 (static audio/video) and 96-127 (dynamic).
        // PTs 35-71 are "unassigned" and 72-76 are reserved for RTCP conflict avoidance (RFC 3550 §5.2).
        // PTs 77-95 are "unassigned". Accept all of 0-34 and 96-127 as likely RTP.
        // Also accept 35-95 but with lower confidence — these are uncommon but valid.
        if payload_type > 127 {
            return false; // impossible with 7-bit field, but defensive
        }
        // Reject PTs in the RTCP conflict range (72-76) per RFC 3550 §5.2
        if payload_type >= 72 && payload_type <= 76 {
            return false;
        }

        // Extract SSRC for validation (bytes 8-11)
        let ssrc = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
        // SSRC 0xFFFFFFFF is invalid; 0 is unusual but valid for the first packet
        if ssrc == 0xFFFFFFFF {
            return false;
        }

        true
    }

    fn is_rtcp(data: &[u8]) -> bool {
        if data.len() < 8 {
            return false;
        }

        // RTCP header: V(2) P(1) RC(5) PT(8) Length(16)
        let version = (data[0] >> 6) & 0x03;
        let packet_type = data[1];

        // RTCP version must be 2
        if version != 2 {
            return false;
        }

        // RTCP packet types: 200-211
        matches!(packet_type, 200..=211)
    }

    /// Content-based T.38/UDPTL detection - no port restrictions
    fn is_fax_content_based(data: &[u8]) -> bool {
        if data.len() < 5 {
            return false;
        }
        // UDPTL type 0: [0][seq 2B BE][primary_len 2B BE][primary...]
        // This is the primary UDPTL structure detection
        if data[0] == 0 {
            let primary_len = u16::from_be_bytes([data[3], data[4]]);
            // Validate: primary_len should be reasonable and consistent with packet size
            if primary_len <= 4096 && data.len() >= 5 {
                return true; // UDPTL-shaped
            }
        }
        // Additional UDPTL detection: check for valid IFP structure
        // IFP (Internet Facsimile Protocol) type byte patterns
        if data.len() >= 8 {
            let type_byte = data[0];
            // Common IFP type bytes: 0x00-0x0F (data types), 0x80 (T30_INDICATOR)
            if type_byte <= 0x0F || type_byte == 0x80 {
                // Validate sequence number is reasonable (bytes 1-2)
                let _seq = u16::from_be_bytes([data[1], data[2]]);
                // Sequence numbers wrap at 65535, any value is valid
                // But check for reasonable primary length
                if data.len() >= 5 {
                    let primary_len = u16::from_be_bytes([data[3], data[4]]);
                    if primary_len <= 4096 {
                        return true;
                    }
                }
            }
        }
        false
    }
}

#[derive(Debug, Clone)]
pub struct PacketInfo {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub src_ip: IpAddr,
    pub dst_ip: IpAddr,
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: Protocol,
    /// Application payload size (e.g. UDP payload length).
    pub size: usize,
    /// Full captured frame length (wire/caplen).
    pub frame_length: usize,
    /// Full captured frame bytes when available (authoritative for pcap writes).
    pub raw_frame: Option<Vec<u8>>,
    pub data: Vec<u8>,
    pub decoded: Option<crate::packet_capture::DecodedPacket>,
    /// Whether this packet is authoritative capture data or simulated/inferred.
    pub fidelity: PacketFidelity,
    /// Origin of the packet in the ingestion pipeline.
    pub provenance: PacketProvenance,
}

impl PacketInfo {
    pub fn can_write_authoritative_pcap(&self) -> bool {
        self.fidelity == PacketFidelity::Authoritative && self.raw_frame.is_some()
    }

    pub fn summary(&self) -> String {
        // Use decoded application layer data if available
        if let Some(ref decoded) = self.decoded {
            match &decoded.application {
                crate::packet_capture::ApplicationLayer::Sip(sip) => {
                    // Use parsed SIP data
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
                crate::packet_capture::ApplicationLayer::Rtp(rtp) => {
                    if let Some(ref dtmf) = rtp.dtmf_event {
                        format!(
                            "RTP DTMF '{}' {} PT:{} SSRC:0x{:08x} {}:{} -> {}:{}",
                            dtmf.digit,
                            if dtmf.end_of_event { "(end)" } else { "" },
                            rtp.payload_type,
                            rtp.ssrc,
                            self.src_ip,
                            self.src_port,
                            self.dst_ip,
                            self.dst_port
                        )
                    } else {
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
                }
                crate::packet_capture::ApplicationLayer::Srtp(rtp) => {
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
                crate::packet_capture::ApplicationLayer::Rtcp(rtcp) => {
                    // Show RTCP type(s) and SSRC from first packet
                    if let Some(first) = rtcp.packets.first() {
                        let type_name = match first.packet_type {
                            200 => "SR",
                            201 => "RR",
                            202 => "SDES",
                            203 => "BYE",
                            204 => "APP",
                            205 => "RTPFB",
                            206 => "PSFB",
                            207 => "XR",
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
                crate::packet_capture::ApplicationLayer::Dns(dns) => {
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
                crate::packet_capture::ApplicationLayer::T38(t38) => {
                    let ifp = t38.ifp_type.as_deref().unwrap_or("UDPTL");
                    format!(
                        "T.38 {} seq {} {}:{} -> {}:{}",
                        ifp, t38.seq, self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                }
                crate::packet_capture::ApplicationLayer::SipOverWs { sip, .. } => {
                    // SIP over WebSocket
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
                crate::packet_capture::ApplicationLayer::WebSocket(ws) => {
                    format!(
                        "WebSocket {} {}:{} -> {}:{}",
                        ws.opcode_name, self.src_ip, self.src_port, self.dst_ip, self.dst_port
                    )
                }
                crate::packet_capture::ApplicationLayer::Unknown(_) => {
                    // For Unknown, just show protocol and addresses - never try to display binary data
                    self.safe_protocol_summary()
                }
            }
        } else {
            // No decoded data, use safe protocol-based summary
            self.safe_protocol_summary()
        }
    }

    fn safe_protocol_summary(&self) -> String {
        // Always show protocol and addresses, never try to display binary data
        match self.protocol {
            Protocol::SIP => {
                format!(
                    "SIP {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::RTP => {
                format!(
                    "RTP {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::SRTP => {
                format!(
                    "SRTP {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::RTCP => {
                format!(
                    "RTCP {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::FAX => {
                format!(
                    "FAX {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::TCP => {
                format!(
                    "TCP {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::UDP => {
                format!(
                    "UDP {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::HTTP => {
                format!(
                    "HTTP {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::HTTPS => {
                format!(
                    "HTTPS {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::DNS => {
                format!(
                    "DNS {}:{} -> {}:{}",
                    self.src_ip, self.src_port, self.dst_ip, self.dst_port
                )
            }
            Protocol::ICMP => {
                format!("ICMP {} -> {}", self.src_ip, self.dst_ip)
            }
            Protocol::ARP => {
                format!("ARP {} -> {}", self.src_ip, self.dst_ip)
            }
            Protocol::Other => {
                format!("IP {} -> {}", self.src_ip, self.dst_ip)
            }
        }
    }
}
