//! RTCP (Real-time Transport Control Protocol) parser per RFC 3550.
//!
//! Supports:
//! - Sender Report (SR, type 200)
//! - Receiver Report (RR, type 201)
//! - Source Description (SDES, type 202)
//! - BYE (type 203)
//! - APP (type 204)

use anyhow::Result;

/// RTCP packet type constants per RFC 3550
pub const RTCP_SR: u8 = 200;   // Sender Report
pub const RTCP_RR: u8 = 201;   // Receiver Report
pub const RTCP_SDES: u8 = 202; // Source Description
pub const RTCP_BYE: u8 = 203;  // Goodbye
pub const RTCP_APP: u8 = 204;  // Application-defined
pub const RTCP_XR: u8 = 207;   // Extended Report (RFC 3611)

/// SDES item type constants
pub const SDES_END: u8 = 0;
pub const SDES_CNAME: u8 = 1;
pub const SDES_NAME: u8 = 2;
pub const SDES_EMAIL: u8 = 3;
pub const SDES_PHONE: u8 = 4;
pub const SDES_LOC: u8 = 5;
pub const SDES_TOOL: u8 = 6;
pub const SDES_NOTE: u8 = 7;
pub const SDES_PRIV: u8 = 8;

/// A compound RTCP packet can contain multiple RTCP sub-packets.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RtcpCompoundPacket {
    /// Individual RTCP packets within this compound packet
    pub packets: Vec<RtcpPacket>,
}

/// A single RTCP packet (SR, RR, SDES, BYE, or APP).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RtcpPacket {
    /// Version (should be 2)
    pub version: u8,
    /// Padding flag
    pub padding: bool,
    /// Reception report count (RC) or source count (SC)
    pub count: u8,
    /// Packet type: 200=SR, 201=RR, 202=SDES, 203=BYE, 204=APP
    pub packet_type: u8,
    /// Length in 32-bit words minus 1
    pub length: u16,
    /// SSRC of sender (for SR/RR) or first SSRC (for BYE)
    pub ssrc: u32,
    /// Sender report data (if packet_type == 200)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_report: Option<SenderReport>,
    /// Receiver reports (for SR and RR packets)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub receiver_reports: Vec<ReceiverReport>,
    /// SDES items (if packet_type == 202)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sdes_items: Vec<SdesItem>,
    /// BYE reason (if packet_type == 203)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bye_reason: Option<String>,
    /// List of SSRCs leaving (for BYE)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bye_ssrcs: Vec<u32>,
    /// VoIP Metrics from RTCP-XR (type 207, block type 7)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voip_metrics: Option<VoipMetricsBlock>,
}

/// Sender Report data (for SR packets, type 200).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderReport {
    /// NTP timestamp (64-bit, seconds since 1900)
    pub ntp_timestamp: u64,
    /// RTP timestamp corresponding to NTP timestamp
    pub rtp_timestamp: u32,
    /// Total packets sent
    pub packet_count: u32,
    /// Total bytes (octets) sent
    pub octet_count: u32,
}

/// Receiver Report block (used in both SR and RR packets).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverReport {
    /// SSRC of the source being reported
    pub ssrc: u32,
    /// Fraction of packets lost (0-255, representing 0.0-1.0)
    pub fraction_lost: u8,
    /// Cumulative packets lost (24-bit signed integer)
    pub cumulative_lost: i32,
    /// Extended highest sequence number received
    pub highest_seq: u32,
    /// Interarrival jitter estimate
    pub jitter: u32,
    /// Last SR timestamp (middle 32 bits of NTP timestamp)
    pub lsr: u32,
    /// Delay since last SR (in 1/65536 seconds)
    pub dlsr: u32,
}

/// SDES (Source Description) item.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdesItem {
    /// SSRC this item describes
    pub ssrc: u32,
    /// Item type (1=CNAME, 2=NAME, etc.)
    pub item_type: u8,
    /// Item type name for display
    pub item_type_name: String,
    /// Item value
    pub value: String,
}

/// RTCP-XR VoIP Metrics Report Block (RFC 3611 §4.7, block type 7).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoipMetricsBlock {
    pub ssrc_source: u32,
    pub loss_rate: u8,
    pub discard_rate: u8,
    pub burst_density: u8,
    pub gap_density: u8,
    pub burst_duration: u16,
    pub gap_duration: u16,
    pub round_trip_delay: u16,
    pub end_system_delay: u16,
    pub signal_level: i8,
    pub noise_level: i8,
    pub rerl: u8,
    pub gmin: u8,
    pub r_factor: u8,
    pub ext_r_factor: u8,
    pub mos_lq: u8,
    pub mos_cq: u8,
    pub rx_config: u8,
    pub jb_nominal: u16,
    pub jb_maximum: u16,
    pub jb_abs_max: u16,
}

impl RtcpPacket {
    /// Get a human-readable name for the packet type.
    pub fn packet_type_name(&self) -> &'static str {
        match self.packet_type {
            RTCP_SR => "Sender Report",
            RTCP_RR => "Receiver Report",
            RTCP_SDES => "Source Description",
            RTCP_BYE => "Goodbye",
            RTCP_APP => "Application",
            RTCP_XR => "Extended Report",
            _ => "Unknown",
        }
    }
}

fn sdes_type_name(item_type: u8) -> &'static str {
    match item_type {
        SDES_CNAME => "CNAME",
        SDES_NAME => "NAME",
        SDES_EMAIL => "EMAIL",
        SDES_PHONE => "PHONE",
        SDES_LOC => "LOC",
        SDES_TOOL => "TOOL",
        SDES_NOTE => "NOTE",
        SDES_PRIV => "PRIV",
        _ => "UNKNOWN",
    }
}

/// Parse an RTCP compound packet from raw bytes.
/// RTCP packets are often sent as compound packets (multiple RTCP packets concatenated).
pub fn parse_rtcp_compound(data: &[u8]) -> Result<RtcpCompoundPacket> {
    let mut packets = Vec::new();
    let mut offset = 0;

    while offset + 4 <= data.len() {
        match parse_rtcp_packet(&data[offset..]) {
            Ok((packet, consumed)) => {
                packets.push(packet);
                offset += consumed;
            }
            Err(e) => {
                // If we've parsed at least one packet, return what we have
                if !packets.is_empty() {
                    break;
                }
                return Err(e);
            }
        }
    }

    if packets.is_empty() {
        anyhow::bail!("No valid RTCP packets found");
    }

    Ok(RtcpCompoundPacket { packets })
}

/// Parse a single RTCP packet and return bytes consumed.
fn parse_rtcp_packet(data: &[u8]) -> Result<(RtcpPacket, usize)> {
    if data.len() < 8 {
        anyhow::bail!("RTCP packet too short: {} bytes", data.len());
    }

    // First byte: V(2) P(1) RC/SC(5)
    let first_byte = data[0];
    let version = (first_byte >> 6) & 0x03;
    let padding = (first_byte & 0x20) != 0;
    let count = first_byte & 0x1F;

    if version != 2 {
        anyhow::bail!("Invalid RTCP version: {} (expected 2)", version);
    }

    let packet_type = data[1];
    let length = u16::from_be_bytes([data[2], data[3]]);
    
    // Length is in 32-bit words minus 1, so total packet size is (length + 1) * 4
    let packet_size = ((length as usize) + 1) * 4;
    
    if data.len() < packet_size {
        anyhow::bail!("RTCP packet truncated: expected {} bytes, got {}", packet_size, data.len());
    }

    // SSRC is at bytes 4-7
    let ssrc = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);

    let mut packet = RtcpPacket {
        version,
        padding,
        count,
        packet_type,
        length,
        ssrc,
        sender_report: None,
        receiver_reports: Vec::new(),
        sdes_items: Vec::new(),
        bye_reason: None,
        bye_ssrcs: Vec::new(),
        voip_metrics: None,
    };

    match packet_type {
        RTCP_SR => {
            // Sender Report: sender info starts at byte 8
            if packet_size >= 28 {
                let ntp_hi = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
                let ntp_lo = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
                let ntp_timestamp = ((ntp_hi as u64) << 32) | (ntp_lo as u64);
                let rtp_timestamp = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
                let packet_count = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
                let octet_count = u32::from_be_bytes([data[24], data[25], data[26], data[27]]);

                packet.sender_report = Some(SenderReport {
                    ntp_timestamp,
                    rtp_timestamp,
                    packet_count,
                    octet_count,
                });

                // Receiver report blocks start at byte 28
                let mut rr_offset = 28;
                for _ in 0..count {
                    if rr_offset + 24 > packet_size {
                        break;
                    }
                    if let Some(rr) = parse_receiver_report(&data[rr_offset..]) {
                        packet.receiver_reports.push(rr);
                    }
                    rr_offset += 24;
                }
            }
        }
        RTCP_RR => {
            // Receiver Report: RR blocks start at byte 8
            let mut rr_offset = 8;
            for _ in 0..count {
                if rr_offset + 24 > packet_size {
                    break;
                }
                if let Some(rr) = parse_receiver_report(&data[rr_offset..]) {
                    packet.receiver_reports.push(rr);
                }
                rr_offset += 24;
            }
        }
        RTCP_SDES => {
            // SDES: chunks start at byte 4 (no common SSRC header in SDES)
            let mut offset = 4;
            for _ in 0..count {
                if offset + 4 > packet_size {
                    break;
                }
                // Each chunk starts with SSRC
                let chunk_ssrc = u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
                offset += 4;

                // Parse SDES items until END (type 0)
                while offset < packet_size {
                    let item_type = data[offset];
                    if item_type == SDES_END {
                        offset += 1;
                        // Pad to 32-bit boundary
                        while offset % 4 != 0 && offset < packet_size {
                            offset += 1;
                        }
                        break;
                    }
                    if offset + 2 > packet_size {
                        break;
                    }
                    let item_len = data[offset + 1] as usize;
                    if offset + 2 + item_len > packet_size {
                        break;
                    }
                    let value = String::from_utf8_lossy(&data[offset + 2..offset + 2 + item_len]).to_string();
                    packet.sdes_items.push(SdesItem {
                        ssrc: chunk_ssrc,
                        item_type,
                        item_type_name: sdes_type_name(item_type).to_string(),
                        value,
                    });
                    offset += 2 + item_len;
                }
            }
        }
        RTCP_BYE => {
            // BYE: list of SSRCs followed by optional reason
            let mut offset = 4;
            for _ in 0..count {
                if offset + 4 > packet_size {
                    break;
                }
                let bye_ssrc = u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
                packet.bye_ssrcs.push(bye_ssrc);
                offset += 4;
            }
            // Check for reason string
            if offset < packet_size {
                let reason_len = data[offset] as usize;
                if offset + 1 + reason_len <= packet_size {
                    packet.bye_reason = Some(String::from_utf8_lossy(&data[offset + 1..offset + 1 + reason_len]).to_string());
                }
            }
        }
        RTCP_APP => {
            // APP packets - just parse header, skip content
        }
        RTCP_XR => {
            let mut xr_offset = 8;
            while xr_offset + 4 <= packet_size {
                let block_type = data[xr_offset];
                let block_length = u16::from_be_bytes([data[xr_offset + 2], data[xr_offset + 3]]) as usize * 4 + 4;
                if block_type == 7 && xr_offset + 36 <= packet_size {
                    let d = &data[xr_offset..];
                    packet.voip_metrics = Some(VoipMetricsBlock {
                        ssrc_source: u32::from_be_bytes([d[4], d[5], d[6], d[7]]),
                        loss_rate: d[8],
                        discard_rate: d[9],
                        burst_density: d[10],
                        gap_density: d[11],
                        burst_duration: u16::from_be_bytes([d[12], d[13]]),
                        gap_duration: u16::from_be_bytes([d[14], d[15]]),
                        round_trip_delay: u16::from_be_bytes([d[16], d[17]]),
                        end_system_delay: u16::from_be_bytes([d[18], d[19]]),
                        signal_level: d[20] as i8,
                        noise_level: d[21] as i8,
                        rerl: d[22],
                        gmin: d[23],
                        r_factor: d[24],
                        ext_r_factor: d[25],
                        mos_lq: d[26],
                        mos_cq: d[27],
                        rx_config: d[28],
                        jb_nominal: u16::from_be_bytes([d[30], d[31]]),
                        jb_maximum: u16::from_be_bytes([d[32], d[33]]),
                        jb_abs_max: u16::from_be_bytes([d[34], d[35]]),
                    });
                }
                xr_offset += block_length;
            }
        }
        _ => {
            // Unknown packet type - skip
        }
    }

    Ok((packet, packet_size))
}

fn parse_receiver_report(data: &[u8]) -> Option<ReceiverReport> {
    if data.len() < 24 {
        return None;
    }

    let ssrc = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
    let fraction_lost = data[4];
    // Cumulative lost is 24-bit signed
    let cumulative_lost = {
        let raw = ((data[5] as i32) << 16) | ((data[6] as i32) << 8) | (data[7] as i32);
        // Sign extend if negative
        if raw & 0x800000 != 0 {
            raw | !0xFFFFFF
        } else {
            raw
        }
    };
    let highest_seq = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
    let jitter = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
    let lsr = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    let dlsr = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);

    Some(ReceiverReport {
        ssrc,
        fraction_lost,
        cumulative_lost,
        highest_seq,
        jitter,
        lsr,
        dlsr,
    })
}

/// Check if data appears to be an RTCP packet.
pub fn is_rtcp(data: &[u8]) -> bool {
    if data.len() < 4 {
        return false;
    }
    let version = (data[0] >> 6) & 0x03;
    let packet_type = data[1];
    version == 2 && matches!(packet_type, 200..=211)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_rtcp() {
        // Valid SR packet start
        let sr = [0x80, 200, 0x00, 0x06];
        assert!(is_rtcp(&sr));

        // Valid RR packet start
        let rr = [0x81, 201, 0x00, 0x07];
        assert!(is_rtcp(&rr));

        // Not RTCP (RTP packet)
        let rtp = [0x80, 0x00, 0x00, 0x01];
        assert!(!is_rtcp(&rtp));

        // Too short
        assert!(!is_rtcp(&[0x80, 200]));
    }
}
